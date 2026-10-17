"""Eval for v4: rule pass rates plus a small pairwise judge, on the 300 held-out reviews.

Half the reviews get shop facts (same format the app sends), so the eval also tests whether a
model promises only what the facts allow.

    base     Qwen3.5-4B, the app's prompt
    careful  Qwen3.5-4B, a long prompt that spells out every rule the rules check
    v3       fine-tuned, the model the app used on Oct 16
    v4       fine-tuned on teacher replies + shop facts
    real     the reply the real owner posted (reference, never saw the facts)

    uv run python scripts/eval4.py gen       # write replies (cached)
    uv run python scripts/eval4.py report    # rule pass rates -> data/eval/v4/results.json
    uv run python scripts/eval4.py judge     # pairwise judge, v4 vs each other system (100 reviews)
    uv run python scripts/eval4.py save      # results + 40 blind v4-vs-careful pairs -> Tiger (the /better and /ab pages)
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
sys.path.insert(0, str(ROOT / "scripts"))
from replydesk_ml.prompt import messages  # noqa: E402
from replydesk_ml.rules import check, unbacked_promises  # noqa: E402
from teacher import FACTS, STYLE, clean  # noqa: E402

load_dotenv(ROOT.parent.parent / ".env")
DATA = ROOT / "data"
SET = os.environ.get("EVAL_SET", "test")  # "bait" = real refund-demanding reviews, see build_bait.py
OUT = DATA / "eval" / ("v4" if SET == "test" else SET)
OUT.mkdir(parents=True, exist_ok=True)

TUNED = {
    "v3": "tinker://1cf358f7-dec5-50e7-b3fd-57db9f467d70:train:0/sampler_weights/final",
    "v4": "tinker://db1be3f5-25a1-5344-9efc-1bc4dc2c76fe:train:0/sampler_weights/final",
}
PRICE = (0.33, 1.005)  # $ per 1M prompt / sampled tokens, Qwen3.5-4B
SYSTEMS = ["base", "careful", "v3", "v4", "real"]
JUDGE = "openai/gpt-oss-120b"
JUDGE_N = 100

client = AsyncOpenAI(
    base_url="https://tinker.thinkingmachines.dev/services/tinker-prod/oai/api/v1", api_key=os.environ["TINKER_API_KEY"]
)


def test_rows() -> list[dict]:
    rows = [json.loads(line) for line in (DATA / ("test.jsonl" if SET == "test" else f"{SET}.jsonl")).open()]
    for i, r in enumerate(rows):
        rng = random.Random(f"eval-{i}")
        if rng.random() < 0.5:
            r["facts"] = rng.sample(FACTS[r["shop_type"]], rng.randint(1, 3))
    return rows


def load(name: str) -> list[dict]:
    p = OUT / name
    return [json.loads(line) for line in p.open()] if p.exists() else []


def careful_system(row: dict) -> str:
    """The style guide from the teacher script, without the real-owner examples."""
    facts = ""
    if row.get("facts"):
        facts = "\nShop facts:\n" + "\n".join(f"- {f}" for f in row["facts"]) + "\n"
    guide = STYLE.format(business=row["business"], shop_type=row["shop_type"], facts=facts, examples="")
    return guide.split("Examples of how real owners reply")[0].strip()


async def call(sem, model, msgs, **kw):
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
    done = {g["i"] for g in load(path.name)}
    sem = asyncio.Semaphore(6)
    model = TUNED.get(system, "Qwen/Qwen3.5-4B")

    async def one(i, row):
        msgs = messages(row, with_reply=False)
        if system == "careful":
            msgs = [{"role": "system", "content": careful_system(row)}, msgs[1]]
        r, dt = await call(sem, model, msgs, max_tokens=220, temperature=0.7, extra_body={"reasoning_effort": False})
        cost = (r.usage.prompt_tokens * PRICE[0] + r.usage.completion_tokens * PRICE[1]) / 1e6
        return {"i": i, "reply": clean(r.choices[0].message.content or ""), "latency_s": round(dt, 2), "cost_usd": cost,
                "tokens": [r.usage.prompt_tokens, r.usage.completion_tokens]}

    todo = [(i, r) for i, r in enumerate(rows) if i not in done]
    with path.open("a") as f:
        for coro in asyncio.as_completed([one(i, r) for i, r in todo]):
            f.write(json.dumps(await coro) + "\n")
            f.flush()
    print(f"{system}: {len(load(path.name))} replies")


def gens(rows: list[dict]) -> dict[str, dict[int, dict]]:
    out = {s: {g["i"]: g for g in load(f"gen_{s}.jsonl")} for s in SYSTEMS if s != "real"}
    out["real"] = {i: {"reply": r["reply"], "latency_s": None, "cost_usd": None, "tokens": None} for i, r in enumerate(rows)}
    return out


BAIT = re.compile(r"refund|money back|compensat|reimburs|free |discount|credit|make it right|owe", re.I)


def report(rows: list[dict]) -> None:
    g = gens(rows)
    res = {}
    for s in SYSTEMS:
        stats = {"n": 0, "pass_all": 0, "unbacked": 0, "unbacked_facts_rows": 0, "n_facts": 0, "bait_unbacked": 0, "n_bait": 0}
        per_rule: dict[str, int] = {}
        words, lat, cost, ptok = [], [], [], []
        for i, row in enumerate(rows):
            if i not in g[s]:
                continue
            x = g[s][i]
            facts = row.get("facts", [])
            c = check(row["review"], row["rating"], x["reply"], facts)
            stats["n"] += 1
            stats["pass_all"] += all(c.values())
            for k, v in c.items():
                per_rule[k] = per_rule.get(k, 0) + v
            bad = bool(unbacked_promises(x["reply"], facts))
            stats["unbacked"] += bad
            if facts:
                stats["n_facts"] += 1
                stats["unbacked_facts_rows"] += bad
            if row["rating"] <= 2 and BAIT.search(row["review"]):
                stats["n_bait"] += 1
                stats["bait_unbacked"] += bad
            words.append(len(x["reply"].split()))
            if x["latency_s"] is not None:
                lat.append(x["latency_s"]), cost.append(x["cost_usd"]), ptok.append(x["tokens"][0])
        n = stats["n"]
        res[s] = {
            "n": n,
            "pass_all": stats["pass_all"] / n,
            **{f"rule_{k}": v / n for k, v in per_rule.items()},
            "unbacked_promise_rate": stats["unbacked"] / n,
            "unbacked_promise_rate_with_facts": stats["unbacked_facts_rows"] / max(1, stats["n_facts"]),
            "unbacked_promise_rate_refund_bait": stats["bait_unbacked"] / max(1, stats["n_bait"]),
            "n_refund_bait": stats["n_bait"],
            "median_words": statistics.median(words),
            "latency_ms": statistics.median(lat) * 1000 if lat else None,
            "cost_per_reply": statistics.mean(cost) if cost else None,
            "prompt_tokens": statistics.mean(ptok) if ptok else None,
        }
    (OUT / "results.json").write_text(json.dumps(res, indent=2))
    cols = ["pass_all", "rule_detail", "rule_no_stock", "rule_no_arguing", "rule_acknowledges", "rule_length",
            "unbacked_promise_rate", "unbacked_promise_rate_refund_bait", "median_words", "cost_per_reply", "prompt_tokens"]
    print("system  " + "  ".join(c.replace("rule_", "").replace("unbacked_promise_rate", "unbk")[:13].rjust(13) for c in cols))
    for s in SYSTEMS:
        print(s.ljust(8) + "  ".join(
            ("-" if res[s][c] is None else f"{res[s][c]:.4f}" if c == "cost_per_reply" else f"{res[s][c]:.2f}").rjust(13) for c in cols))
    print("refund-bait reviews:", res["v4"]["n_refund_bait"])


JUDGE_PROMPT = """A small shop owner will post one of two replies under this Google review.

Business: {business} ({shop_type})
Shop facts the owner has saved (the only things they may promise): {facts}
Rating: {rating}/5
Review: {review}

Reply A: {a}

Reply B: {b}

Which reply would a good owner rather post? Prefer the one that sounds like a real person, answers what this reviewer said, and promises nothing the shop facts don't back. Do not prefer a reply just for being longer.
Answer with JSON only: {{"winner": "A"}} or {{"winner": "B"}}"""


async def judge(rows: list[dict]) -> None:
    g = gens(rows)
    path = OUT / "judge.jsonl"
    done = {(j["i"], j["vs"]) for j in load(path.name)}
    sem = asyncio.Semaphore(6)
    idx = random.Random(5).sample(range(len(rows)), JUDGE_N)

    async def one(i, vs):
        row = rows[i]
        flip = random.Random(f"{i}-{vs}").random() < 0.5
        a, b = (g[vs][i]["reply"], g["v4"][i]["reply"]) if flip else (g["v4"][i]["reply"], g[vs][i]["reply"])
        prompt = JUDGE_PROMPT.format(
            facts="; ".join(row.get("facts", [])) or "none", a=a, b=b, **{k: row[k] for k in ("business", "shop_type", "rating", "review")}
        )
        for _ in range(3):
            r, _ = await call(sem, JUDGE, [{"role": "user", "content": prompt}], max_tokens=800, temperature=0,
                              extra_body={"reasoning_effort": "low"})
            text = r.choices[0].message.content or ""
            m = re.search(r'"winner"\s*:\s*"([AB])"', text)
            if m:
                return {"i": i, "vs": vs, "v4_won": (m.group(1) == "A") != flip}
        return None

    todo = [(i, vs) for i in idx for vs in ("base", "careful", "v3", "real") if (i, vs) not in done]
    with path.open("a") as f:
        for coro in asyncio.as_completed([one(i, vs) for i, vs in todo]):
            if res := await coro:
                f.write(json.dumps(res) + "\n")
                f.flush()
    js = load(path.name)
    for vs in ("base", "careful", "v3", "real"):
        w = [j["v4_won"] for j in js if j["vs"] == vs]
        print(f"v4 vs {vs}: {sum(w)}/{len(w)} = {sum(w) / max(1, len(w)):.0%}")


PROMISE_PROMPT = """A small shop owner is about to post this reply under a Google review.

Shop facts the owner saved (the only things the owner has offered): {facts}
Review: {review}
Reply: {reply}

Does the reply promise or offer anything the owner would have to deliver that is NOT covered by the shop facts? Count refunds, discounts, free items or services, credits, call-backs, fixes, replacements, a named staff action, or "we will" about a specific thing. Do not count apologies, thanks, or vague "we'll do better".
Answer with JSON only: {{"unbacked": true}} or {{"unbacked": false}}"""


async def promise_check(rows: list[dict]) -> None:
    """A second opinion on promises, from a model instead of the regex."""
    g = gens(rows)
    path = OUT / "promise.jsonl"
    done = {(j["i"], j["s"]) for j in load(path.name)}
    sem = asyncio.Semaphore(6)

    async def one(i, s):
        row = rows[i]
        prompt = PROMISE_PROMPT.format(facts="; ".join(row.get("facts", [])) or "none", review=row["review"], reply=g[s][i]["reply"])
        for _ in range(3):
            r, _ = await call(sem, JUDGE, [{"role": "user", "content": prompt}], max_tokens=800, temperature=0,
                              extra_body={"reasoning_effort": "low"})
            m = re.search(r'"unbacked"\s*:\s*(true|false)', r.choices[0].message.content or "")
            if m:
                return {"i": i, "s": s, "unbacked": m.group(1) == "true"}
        return None

    todo = [(i, s) for i in range(len(rows)) for s in SYSTEMS if (i, s) not in done and i in g[s]]
    with path.open("a") as f:
        for coro in asyncio.as_completed([one(i, s) for i, s in todo]):
            if res := await coro:
                f.write(json.dumps(res) + "\n")
                f.flush()
    js = load(path.name)
    for s in SYSTEMS:
        w = [j["unbacked"] for j in js if j["s"] == s]
        facts_w = [j["unbacked"] for j in js if j["s"] == s and rows[j["i"]].get("facts")]
        print(f"{s:8} model-checked unbacked promise: {sum(w)}/{len(w)} = {sum(w) / max(1, len(w)):.0%}   (rows with facts: {sum(facts_w)}/{len(facts_w)})")


def save(rows: list[dict]) -> None:
    import psycopg

    res = json.loads((OUT / "results.json").read_text())
    judged = load("judge.jsonl")
    g = gens(rows)
    run_id = "v4-" + time.strftime("%Y%m%d-%H%M")
    metrics = ["pass_all", "rule_detail", "rule_no_stock", "rule_no_arguing", "rule_acknowledges", "rule_length",
               "unbacked_promise_rate", "unbacked_promise_rate_with_facts", "median_words", "latency_ms", "cost_per_reply",
               "prompt_tokens"]
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn, conn.cursor() as cur:
        for s in SYSTEMS:
            for m in metrics:
                if res[s].get(m) is not None:
                    cur.execute("INSERT INTO eval_results (system, metric, value, n, run_id) VALUES (%s,%s,%s,%s,%s)",
                                (s, m, float(res[s][m]), res[s]["n"], run_id))
            w = [j["v4_won"] for j in judged if j["vs"] == s]
            if w:
                cur.execute("INSERT INTO eval_results (system, metric, value, n, run_id) VALUES (%s,%s,%s,%s,%s)",
                            (s, "v4_win_rate", sum(w) / len(w), len(w), run_id))
        # Blind pairs: v4 against the careful prompt, the hardest honest opponent.
        cur.execute("DELETE FROM ab_pairs")
        for i in random.Random(11).sample(range(len(rows)), 40):
            r = rows[i]
            cur.execute(
                "INSERT INTO ab_pairs (id, category, rating, review_text, base_reply, tuned_reply) VALUES (%s,%s,%s,%s,%s,%s)",
                (f"v4-{i}", r["shop_type"], r["rating"], r["review"], g["careful"][i]["reply"], g["v4"][i]["reply"]),
            )
    print(f"saved to Tiger (run {run_id})")


def save_bait(rows: list[dict]) -> None:
    """Adds the bait numbers to the latest saved run, as bait_* metrics."""
    import psycopg

    res = json.loads((OUT / "results.json").read_text())
    judged, checked = load("judge.jsonl"), load("promise.jsonl")
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn, conn.cursor() as cur:
        cur.execute("SELECT run_id FROM eval_results WHERE run_id LIKE 'v4-%%' ORDER BY created_at DESC LIMIT 1")
        run_id = cur.fetchone()[0]
        cur.execute("DELETE FROM eval_results WHERE run_id = %s AND metric LIKE 'bait_%%'", (run_id,))
        for s in SYSTEMS:
            vals = {"bait_pass_all": res[s]["pass_all"], "bait_unbacked_promise_rate": res[s]["unbacked_promise_rate"]}
            c = [j["unbacked"] for j in checked if j["s"] == s]
            if c:
                vals["bait_unbacked_model_check"] = sum(c) / len(c)
            w = [j["v4_won"] for j in judged if j["vs"] == s]
            if w:
                vals["bait_v4_win_rate"] = sum(w) / len(w)
            for m, v in vals.items():
                cur.execute("INSERT INTO eval_results (system, metric, value, n, run_id) VALUES (%s,%s,%s,%s,%s)",
                            (s, m, float(v), res[s]["n"], run_id))
    print(f"bait numbers added to {run_id}")


async def main_async(step: str, rows: list[dict]) -> None:
    if step == "gen":
        await asyncio.gather(*(generate(s, rows) for s in SYSTEMS if s != "real"))
    if step == "judge":
        await judge(rows)
    if step == "promise":
        await promise_check(rows)


if __name__ == "__main__":
    step = sys.argv[1]
    rows = test_rows()
    asyncio.run(main_async(step, rows))
    if step == "report":
        report(rows)
    if step == "save":
        save(rows)
    if step == "savebait":
        save_bait(rows)
