"""Compare four reply writers on 300 held-out reviews from businesses never seen in training.

    base   Qwen3.5-4B, prompted (Tinker)
    tuned  Qwen3.5-4B, fine-tuned (Tinker)
    big    Qwen3.8-27B, prompted (Groq)
    real   the reply the real owner posted

A judge model from a different family (gpt-oss-120b on Groq) sees the four
replies to each review in random order with no labels and marks each one.
Generations and judgements are cached, so the script can be re-run safely.

    uv run python scripts/eval.py gen      # write replies (or: gen base big)
    uv run python scripts/eval.py judge    # judge them
    uv run python scripts/eval.py report   # numbers -> results.json + Tiger
"""

import asyncio
import json
import os
import random
import re
import statistics
import sys
import time
from pathlib import Path

from dotenv import load_dotenv
from openai import AsyncOpenAI, RateLimitError

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from replydesk_ml.prompt import messages  # noqa: E402

load_dotenv(ROOT.parent.parent / ".env")
DATA = ROOT / "data"
OUT = DATA / "eval"
OUT.mkdir(exist_ok=True)

TUNED = "tinker://7f3021d1-ee4f-5003-b645-2da86957457f:train:0/sampler_weights/000100"
TINKER_PRICE = (0.33, 1.005)  # $ per 1M prompt / sampled tokens, Qwen3.5-4B
JUDGE = "openai/gpt-oss-120b"
SYSTEMS = ["base", "tuned", "big", "real"]

tinker = AsyncOpenAI(
    base_url="https://tinker.thinkingmachines.dev/services/tinker-prod/oai/api/v1", api_key=os.environ["TINKER_API_KEY"]
)
groq = AsyncOpenAI(base_url="https://api.groq.com/openai/v1", api_key=os.environ["GROQ_API_KEY"])

CLICHES = re.compile(
    r"valued customer|apologi[sz]e for any inconvenience|sorry for any inconvenience|thank you for taking the time"
    r"|we strive|your feedback is (?:important|valuable)|we value your feedback|don'?t hesitate|rest assured"
    r"|we pride ourselves|reach out to (?:us|our)|please contact us|at your earliest convenience|we take .{0,20}seriously"
    r"|exceed your expectations|top priority|look forward to serving you",
    re.I,
)


def load(name: str) -> list[dict]:
    p = OUT / name
    return [json.loads(line) for line in p.open()] if p.exists() else []


async def call(client, sem, model, msgs, **kw):
    async with sem:
        for attempt in range(8):
            try:
                t = time.time()
                r = await client.chat.completions.create(model=model, messages=msgs, **kw)
                return r, time.time() - t
            except RateLimitError:
                await asyncio.sleep(min(60, 5 * 2**attempt))
        raise RuntimeError("rate limited too many times")


async def generate(system: str, rows: list[dict]) -> None:
    path = OUT / f"gen_{system}.jsonl"
    done = {r["i"] for r in load(path.name)}
    sem = asyncio.Semaphore(4 if system != "big" else 2)

    async def one(i, row):
        msgs = messages(row, with_reply=False)
        if system == "big":
            r, dt = await call(groq, sem, "qwen/qwen3.8-27b", msgs, max_tokens=220, temperature=0.7, reasoning_effort="none")
            cost = None
        else:
            model = TUNED if system == "tuned" else "Qwen/Qwen3.5-4B"
            r, dt = await call(
                tinker, sem, model, msgs, max_tokens=220, temperature=0.7, extra_body={"reasoning_effort": False}
            )
            cost = (r.usage.prompt_tokens * TINKER_PRICE[0] + r.usage.completion_tokens * TINKER_PRICE[1]) / 1e6
        text = (r.choices[0].message.content or "").strip()
        return {"i": i, "reply": text, "latency_s": round(dt, 2), "cost_usd": cost}

    todo = [(i, row) for i, row in enumerate(rows) if i not in done]
    with path.open("a") as f:
        for coro in asyncio.as_completed([one(i, row) for i, row in todo]):
            f.write(json.dumps(await coro) + "\n")
            f.flush()
    print(f"{system}: {len(load(path.name))} replies")


JUDGE_PROMPT = """You are judging replies a small business owner could post under a Google review.

Business: {business} ({shop_type})
Rating: {rating}/5
Review: {review}

Replies (random order):
{replies}

For each reply decide:
- detail: true if it responds to a specific thing this reviewer mentioned (not just the rating or a generic thanks).
- promise: true if it promises or offers something specific the owner would have to deliver (refund, discount, free item, call-back, a fix by a date, a named staff action). Generic "we'll do better" is false.
- template: true if it reads like a stock corporate template that could be pasted under any review.
Then rank all replies from the one the owner should most want to post to the least.

Answer with JSON only:
{{"replies": {{"1": {{"detail": bool, "promise": bool, "template": bool}}, ...}}, "ranking": [best id, ..., worst id]}}"""


async def judge(rows: list[dict]) -> None:
    gens = {s: {g["i"]: g["reply"] for g in load(f"gen_{s}.jsonl")} for s in SYSTEMS if s != "real"}
    gens["real"] = {i: r["reply"] for i, r in enumerate(rows)}
    path = OUT / "judge.jsonl"
    done = {r["i"] for r in load(path.name)}
    sem = asyncio.Semaphore(2)

    async def one(i, row):
        order = SYSTEMS[:]
        random.Random(i).shuffle(order)
        replies = "\n\n".join(f"[{k + 1}] {gens[s][i]}" for k, s in enumerate(order))
        prompt = JUDGE_PROMPT.format(replies=replies, **row)
        for _ in range(3):
            r, _ = await call(
                groq, sem, JUDGE, [{"role": "user", "content": prompt}],
                max_tokens=1500, temperature=0, reasoning_effort="low", response_format={"type": "json_object"},
            )
            try:
                d = json.loads(r.choices[0].message.content)
                marks = {order[int(k) - 1]: v for k, v in d["replies"].items()}
                ranking = [order[int(k) - 1] for k in d["ranking"]]
                if set(marks) == set(SYSTEMS) and sorted(ranking) == sorted(SYSTEMS):
                    return {"i": i, "marks": marks, "ranking": ranking}
            except (ValueError, KeyError, TypeError, IndexError):
                pass
        return None

    todo = [(i, row) for i, row in enumerate(rows) if i not in done and all(i in gens[s] for s in SYSTEMS)]
    with path.open("a") as f:
        for coro in asyncio.as_completed([one(i, row) for i, row in todo]):
            if res := await coro:
                f.write(json.dumps(res) + "\n")
                f.flush()
    print(f"judged: {len(load(path.name))}")


def report(rows: list[dict]) -> None:
    gens = {s: {g["i"]: g for g in load(f"gen_{s}.jsonl")} for s in SYSTEMS if s != "real"}
    gens["real"] = {i: {"reply": r["reply"], "latency_s": None, "cost_usd": None} for i, r in enumerate(rows)}
    judged = load("judge.jsonl")
    n = len(judged)
    res = {}
    for s in SYSTEMS:
        replies = [g["reply"] for g in gens[s].values()]
        lat = [g["latency_s"] for g in gens[s].values() if g["latency_s"] is not None]
        cost = [g["cost_usd"] for g in gens[s].values() if g["cost_usd"] is not None]
        res[s] = {
            "median_words": statistics.median(len(r.split()) for r in replies),
            "cliche_rate": sum(bool(CLICHES.search(r)) for r in replies) / len(replies),
            "mentions_detail": sum(j["marks"][s]["detail"] for j in judged) / n,
            "made_up_promises": sum(j["marks"][s]["promise"] for j in judged) / n,
            "template_rate": sum(j["marks"][s]["template"] for j in judged) / n,
            "ranked_first": sum(j["ranking"][0] == s for j in judged) / n,
            "win_rate_vs_base": None if s == "base" else
                sum(j["ranking"].index(s) < j["ranking"].index("base") for j in judged) / n,
            "latency_ms": statistics.median(lat) * 1000 if lat else None,
            "cost_per_reply": statistics.mean(cost) if cost else None,
        }
    res["_meta"] = {"n_reviews": len(rows), "n_judged": n, "judge": JUDGE, "tuned_checkpoint": TUNED}
    (OUT / "results.json").write_text(json.dumps(res, indent=2))
    for s in SYSTEMS:
        print(s.ljust(6), {k: (round(v, 3) if isinstance(v, float) else v) for k, v in res[s].items()})
    save_to_tiger(res, rows, gens, n)


def save_to_tiger(res, rows, gens, n) -> None:
    import psycopg

    run_id = time.strftime("%Y%m%d-%H%M")
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM eval_results")
        for s in SYSTEMS:
            for metric, value in res[s].items():
                if value is not None:
                    cur.execute(
                        "INSERT INTO eval_results (system, metric, value, n, run_id) VALUES (%s, %s, %s, %s, %s)",
                        (s, metric, float(value), n, run_id),
                    )
        # 40 blind A/B pairs for the public "which would you post?" page.
        cur.execute("DELETE FROM ab_pairs")
        picks = random.Random(7).sample(range(len(rows)), 40)
        for i in picks:
            if i in gens["base"] and i in gens["tuned"]:
                r = rows[i]
                cur.execute(
                    "INSERT INTO ab_pairs (id, category, rating, review_text, base_reply, tuned_reply) VALUES (%s,%s,%s,%s,%s,%s)",
                    (f"t{i}", r["shop_type"], r["rating"], r["review"], gens["base"][i]["reply"], gens["tuned"][i]["reply"]),
                )
    print(f"saved to Tiger (run {run_id})")


async def run_async(step: str, rows: list[dict], only: list[str]) -> None:
    # One event loop for everything: the API clients are bound to the loop they first ran on.
    if step in ("gen", "all"):
        await asyncio.gather(*(generate(s, rows) for s in only or ["base", "tuned", "big"]))
    if step in ("judge", "all"):
        await judge(rows)


def main() -> None:
    rows = [json.loads(line) for line in (DATA / "test.jsonl").open()]
    step = sys.argv[1] if len(sys.argv) > 1 else "all"
    asyncio.run(run_async(step, rows, sys.argv[2:]))
    if step in ("report", "all"):
        report(rows)


if __name__ == "__main__":
    main()
