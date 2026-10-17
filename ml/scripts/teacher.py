"""Build the v4 training set: replies written by a bigger model, kept only if they pass the rules.

v3 learned the owner's length but not the owner's habit of saying one specific thing back
to the reviewer. v4 trains on replies that have both, and on prompts that carry shop facts
(the format the app already sends), so the model learns to promise only what the facts say.

    uv run python scripts/teacher.py pilot qwen3.6-35b 30   # 30 reviews, prints cost + pass rate
    uv run python scripts/teacher.py gen qwen3.6-35b 2500   # candidates -> data/v4/teacher_raw.jsonl
    uv run python scripts/teacher.py build                  # filter -> data/v4/train_chat.jsonl

Generations are cached, so the script can be re-run safely.
"""

import asyncio
import json
import os
import random
import re
import statistics
import sys
from collections import Counter
from pathlib import Path

from dotenv import load_dotenv
from openai import AsyncOpenAI, RateLimitError

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from replydesk_ml.prompt import messages, system_prompt  # noqa: E402
from replydesk_ml.rules import check, passes  # noqa: E402

load_dotenv(ROOT.parent.parent / ".env")
DATA = ROOT / "data"
OUT = DATA / "v4"
OUT.mkdir(exist_ok=True)
RAW = OUT / "teacher_raw.jsonl"
SEED = 26
CANDIDATES = 2

# model name on Tinker -> ($ per 1M prompt tokens, $ per 1M sampled tokens, extra request body)
TEACHERS = {
    "qwen3.6-35b": ("Qwen/Qwen3.6-35B-A3B", 0.45, 1.335, {"reasoning_effort": False}),
    "gpt-oss-120b": ("openai/gpt-oss-120b", 0.33, 0.84, {"reasoning_effort": "low"}),
    "gpt-oss-20b": ("openai/gpt-oss-20b", 0.18, 0.45, {"reasoning_effort": "low"}),
    "qwen3.8-27b": ("Qwen/Qwen3.8-27B", 0.6975, 5.595, {"reasoning_effort": False}),
}

# Facts an owner might save in setup. Training prompts get 1 to 3 of them on half the examples,
# picked at random, so the model learns to use a fact only when it fits the review.
FACTS = {
    "cafe/restaurant": [
        "Free refill on drip coffee",
        "We remake any drink that is not right, just tell the person at the counter",
        "Vegan and gluten-free options are on the menu every day",
        "The kitchen closes 30 minutes before we do",
        "Large orders: call a day ahead",
        "Ask for the owner at the counter if anything went wrong",
        "Free parking behind the building",
    ],
    "retail": [
        "Returns within 14 days with a receipt",
        "Free gift wrapping on request",
        "We can special order anything not on the shelf, usually 3 to 5 days",
        "Ask the owner at the front desk if anything went wrong",
        "Store credit for returns without a receipt",
        "Free repairs on anything we sold within 30 days",
    ],
    "home services": [
        "Free estimates, no obligation",
        "We come back within 7 days for free if the problem returns",
        "We answer calls Monday to Saturday, 8 to 5",
        "Ask for the owner by name if anything went wrong",
        "Emergency visits the same day when we can",
        "We clean up the work area before we leave",
    ],
    "dentist": [
        "Same-week appointments for pain",
        "We call to check in after bigger procedures",
        "Ask for the office manager if anything went wrong",
        "We explain costs before any treatment starts",
        "Free re-check within 30 days for any treatment we did",
        "We offer payment plans",
    ],
    "auto repair": [
        "Free re-check within 7 days of any repair",
        "Written estimate before any work starts",
        "12 month, 12,000 mile warranty on repairs",
        "Ask for the owner at the front desk if anything went wrong",
        "We call before doing anything not on the estimate",
        "Free tire rotation with every oil change",
    ],
    "salon": [
        "Free fix within 7 days if you are not happy with a cut or color",
        "Ask for the owner at the front desk if anything went wrong",
        "Walk-ins welcome on weekdays",
        "We do a color consultation before every color service",
        "Cancel up to 24 hours ahead with no fee",
        "Gift cards available",
    ],
}

STYLE = """You are the owner of {business}, a small {shop_type}. You are replying to a Google review in your own voice.

How you write:
- 2 or 3 sentences, 25 to 45 words. Plain, warm speech. You are a person, not a company.
- Repeat back ONE specific thing the reviewer said, in your own words (a dish, a person, a repair, a wait, a price).
- For 1 to 3 star reviews, say sorry for that specific problem in the first sentence. No excuses, no arguing, no blaming the customer.
- Never write: "thank you for taking the time", "valued customer", "we strive", "your feedback", "don't hesitate", "please contact us".
- Promise only what is in the shop facts below. If you use a fact, use it only when it fits this review. With no facts listed, promise nothing: no refunds, discounts, free items or call-backs.
- No sign-off, no name at the end, no phone numbers or links.
- Reply with the reply text only.
{facts}
Examples of how real owners reply (voice only, do not copy):
{examples}"""


def load_rows() -> list[dict]:
    return [json.loads(line) for line in (DATA / "train.jsonl").open()]


def pick_rows(n: int) -> list[dict]:
    """n reviews, about half 1 to 3 stars, each with an index and (on half) shop facts."""
    rng = random.Random(SEED)
    rows = load_rows()
    for i, r in enumerate(rows):
        r["i"] = i
    low = [r for r in rows if r["rating"] <= 3]
    high = [r for r in rows if r["rating"] > 3]
    rng.shuffle(low)
    rng.shuffle(high)
    chosen = low[: n // 2] + high[: n - n // 2]
    rng.shuffle(chosen)
    for r in chosen:
        frng = random.Random(f"{SEED}-{r['i']}")
        if frng.random() < 0.5:
            r["facts"] = frng.sample(FACTS[r["shop_type"]], frng.randint(1, 3))
    return chosen


def style_prompt(row: dict, pool: list[dict]) -> str:
    """The teacher's system prompt: the style guide plus 3 real replies as voice examples."""
    rng = random.Random(f"ex-{row['i']}")
    same = [
        p for p in pool
        if p["shop_type"] == row["shop_type"] and (p["rating"] <= 3) == (row["rating"] <= 3) and p["i"] != row["i"]
        and passes(p["review"], p["rating"], p["reply"], [])
    ]
    shots = rng.sample(same, 3)
    examples = "\n\n".join(f"Review ({s['rating']}/5): {s['review'][:300]}\nReply: {s['reply']}" for s in shots)
    facts = ""
    if row.get("facts"):
        facts = "\nShop facts:\n" + "\n".join(f"- {f}" for f in row["facts"]) + "\n"
    return STYLE.format(business=row["business"], shop_type=row["shop_type"], facts=facts, examples=examples)


async def sample(client, sem, model, extra, msgs, temperature):
    async with sem:
        for attempt in range(8):
            try:
                return await client.chat.completions.create(
                    model=model, messages=msgs, max_tokens=500, temperature=temperature, extra_body=extra
                )
            except RateLimitError:
                await asyncio.sleep(min(60, 5 * 2**attempt))
    raise RuntimeError("rate limited too many times")


def clean(text: str) -> str:
    """Strip a leading label and the typography that gives away a model (curly quotes, em dashes)."""
    text = re.sub(r"^(?:reply|response)\s*:\s*", "", text.strip(), flags=re.I)
    text = text.replace("\u2019", "'").replace("\u2018", "'").replace("\u201c", '"').replace("\u201d", '"')
    text = text.replace("\u2011", "-").replace("\u2010", "-").replace("\u2013", "-")
    text = re.sub(r"\s*\u2014\s*", ", ", text)
    return re.sub(r"\s+", " ", text).strip().strip('"').strip()


async def generate(teachers: str, n: int, path: Path) -> None:
    """teachers: one name, or several joined by commas (candidate k comes from teacher k mod len)."""
    names = teachers.split(",")
    rows = pick_rows(n)
    pool = [dict(r, i=i) for i, r in enumerate(load_rows())]
    done = {(r["i"], r["k"]) for r in map(json.loads, path.open())} if path.exists() else set()
    client = AsyncOpenAI(
        base_url="https://tinker.thinkingmachines.dev/services/tinker-prod/oai/api/v1", api_key=os.environ["TINKER_API_KEY"]
    )
    sem = asyncio.Semaphore(6)

    async def one(row, k):
        teacher = names[k % len(names)]
        model, p_in, p_out, extra = TEACHERS[teacher]
        user = messages(row, with_reply=False)[1]
        msgs = [{"role": "system", "content": style_prompt(row, pool)}, user]
        r = await sample(client, sem, model, extra, msgs, temperature=0.8)
        text = clean(r.choices[0].message.content or "")
        cost = (r.usage.prompt_tokens * p_in + r.usage.completion_tokens * p_out) / 1e6
        facts = row.get("facts", [])
        return {
            "i": row["i"], "k": k, "teacher": teacher, "reply": text, "facts": facts, "cost_usd": cost,
            "tokens": [r.usage.prompt_tokens, r.usage.completion_tokens],
            "checks": check(row["review"], row["rating"], text, facts),
        }

    todo = [(r, k) for r in rows for k in range(CANDIDATES) if (r["i"], k) not in done]
    with path.open("a") as f:
        for coro in asyncio.as_completed([one(r, k) for r, k in todo]):
            f.write(json.dumps(await coro) + "\n")
            f.flush()
    print(f"{teachers}: {len(todo)} new candidates in {path.name}")


def recheck(got: list[dict]) -> list[dict]:
    """Re-run the rules on saved replies, so rule fixes don't need new generations."""
    rows = load_rows()
    for g in got:
        r = rows[g["i"]]
        g["checks"] = check(r["review"], r["rating"], g["reply"], g["facts"])
    return got


def summarise(path: Path) -> None:
    got = recheck([json.loads(line) for line in path.open()])
    ok = [g for g in got if all(g["checks"].values())]
    words = [len(g["reply"].split()) for g in got]
    print("by teacher:", {t: f"{sum(all(g['checks'].values()) for g in got if g['teacher'] == t)}/{sum(g['teacher'] == t for g in got)}" for t in {g['teacher'] for g in got}})
    print(f"{len(got)} candidates, {len(ok)} pass all rules ({len(ok) / len(got):.0%}), median {statistics.median(words)} words")
    fails = Counter(k for g in got for k, v in g["checks"].items() if not v)
    print("fails by rule:", dict(fails))
    print(f"cost ${sum(g['cost_usd'] for g in got):.3f}, ${statistics.mean(g['cost_usd'] for g in got):.5f} per candidate")
    rows = dict(enumerate(load_rows()))
    for g in random.Random(1).sample(ok or got, min(4, len(ok or got))):
        r = rows[g["i"]]
        print(f"\n[{r['rating']}/5 {r['shop_type']}] {r['review'][:200]}\nfacts: {g['facts']}\n-> {g['reply']}")


def build() -> None:
    raw = recheck([json.loads(line) for line in RAW.open()])
    rows = {r["i"]: r for r in pick_rows(10**9)}  # same facts as when generated
    by_review: dict[int, list[dict]] = {}
    for g in raw:
        if all(g["checks"].values()):
            by_review.setdefault(g["i"], []).append(g)
    kept = []
    opening = Counter()
    rng = random.Random(SEED)
    for i, cands in by_review.items():
        g = min(cands, key=lambda c: abs(len(c["reply"].split()) - 35) + rng.random())
        key = " ".join(g["reply"].lower().split()[:3])
        if opening[key] >= 12:  # no single opening may dominate
            continue
        opening[key] += 1
        kept.append(dict(rows[i], reply=g["reply"], source="teacher"))
    used = {g["i"] for g in raw}
    # Real owner replies the teacher didn't see, if they pass the same rules.
    real = [
        dict(r, source="real") for r in (dict(r, i=i) for i, r in enumerate(load_rows()))
        if r["i"] not in used and passes(r["review"], r["rating"], r["reply"], [])
    ]
    rng.shuffle(real)
    real = real[: len(kept) // 2]
    out = kept + real
    rng.shuffle(out)
    with (OUT / "train_chat.jsonl").open("w") as f:
        for r in out:
            f.write(json.dumps({"messages": messages(r)}) + "\n")
    words = [len(r["reply"].split()) for r in out]
    print(f"{len(kept)} teacher + {len(real)} real = {len(out)} examples, median {statistics.median(words)} words,"
          f" {sum(bool(r.get('facts')) for r in out)} with facts, {sum(r['rating'] <= 3 for r in out)} low-star")


def main() -> None:
    cmd = sys.argv[1]
    if cmd == "pilot":
        teacher, n = sys.argv[2], int(sys.argv[3])
        path = OUT / f"pilot_{teacher}.jsonl"
        asyncio.run(generate(teacher, n, path))
        summarise(path)
    elif cmd == "gen":
        asyncio.run(generate(sys.argv[2], int(sys.argv[3]), RAW))
        summarise(RAW)
    elif cmd == "build":
        build()


if __name__ == "__main__":
    main()
