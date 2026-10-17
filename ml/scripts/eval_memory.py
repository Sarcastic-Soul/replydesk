"""Does Backboard memory pick the shop facts a reply needs?

One throwaway Backboard assistant per shop type holds that type's facts (the same fact bank the training data
uses). For 20 held-out reviews per type we ask memory search for facts, with a high limit so every score
comes back. A judge model, who sees only the review and the fact list, marks which facts the owner would
need when replying. Then we compare ways of choosing facts from the search result.

    uv run python scripts/eval_memory.py run     # search + judge -> data/eval/memory/memory.json
    uv run python scripts/eval_memory.py report
    uv run python scripts/eval_memory.py save    # numbers -> Tiger eval_results (latest v4 run, system = strategy)
"""

import asyncio
import json
import os
import random
import re
import sys
import time
import urllib.request
from pathlib import Path

import psycopg
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
os.environ.setdefault("EVAL_SET", "test")
from eval4 import JUDGE, call as llm  # noqa: E402
from teacher import FACTS  # noqa: E402

load_dotenv(ROOT.parent.parent / ".env")
OUT = ROOT / "data" / "eval" / "memory"
OUT.mkdir(parents=True, exist_ok=True)
BASE = "https://app.backboard.io/api"
PER_TYPE = 20


def bb(path, method="GET", body=None):
    req = urllib.request.Request(
        BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None,
        headers={"X-API-Key": os.environ["BACKBOARD_API_KEY"], "Content-Type": "application/json"},
    )
    return json.loads(urllib.request.urlopen(req, timeout=30).read() or b"{}")


PROMPT = """A shop owner is replying to a Google review. These are the facts the owner saved about the shop:
{facts}

Review ({rating} stars): {review}

Which saved facts would the owner actually need to use or mention in a good reply to this review? Only count a fact if the review touches it (for example a review about a long wait touches "we send an update when a job is delayed"; a review that only praises the staff touches none). It is fine to pick none.
Answer with JSON only, using the fact numbers, like {{"needed": [2, 5]}} or {{"needed": []}}"""


async def run() -> None:
    rows = [json.loads(line) for line in (ROOT / "data" / "test.jsonl").open()]
    rng = random.Random(9)
    queries = []
    for t in FACTS:
        pool = [r for r in rows if r["shop_type"] == t]
        queries += rng.sample(pool, min(PER_TYPE, len(pool)))
    made = {}
    try:
        for t, facts in FACTS.items():
            aid = bb("/assistants", "POST", {"name": f"ReplyDesk eval {t}"})["assistant_id"]
            made[t] = aid
            for f in facts:
                bb(f"/assistants/{aid}/memories", "POST", {"content": f})
        time.sleep(5)
        searched = []
        for q in queries:
            r = bb(f"/assistants/{made[q['shop_type']]}/memories/search", "POST", {"query": q["review"], "limit": 10})
            searched.append([(m["content"], m.get("score") or 0.0) for m in r.get("memories", [])])
    finally:
        for aid in made.values():
            try:
                bb(f"/assistants/{aid}", "DELETE")
            except Exception as e:  # noqa: BLE001
                print("could not delete", aid, e)

    sem = asyncio.Semaphore(6)

    async def label(q):
        facts = FACTS[q["shop_type"]]
        msg = PROMPT.format(facts="\n".join(f"{i + 1}. {f}" for i, f in enumerate(facts)), rating=q["rating"], review=q["review"][:900])
        for _ in range(3):
            r, _ = await llm(sem, JUDGE, [{"role": "user", "content": msg}], max_tokens=1200, temperature=0,
                             extra_body={"reasoning_effort": "low"})
            m = re.search(r'"needed"\s*:\s*\[([^\]]*)\]', r.choices[0].message.content or "")
            if m:
                return [facts[int(x) - 1] for x in re.findall(r"\d+", m.group(1)) if 0 < int(x) <= len(facts)]
        return None

    labels = await asyncio.gather(*(label(q) for q in queries))
    out = [{"review": q["review"], "shop_type": q["shop_type"], "needed": n, "search": s}
           for q, n, s in zip(queries, labels, searched) if n is not None]
    (OUT / "memory.json").write_text(json.dumps(out))
    print(f"{len(out)} reviews labelled, {sum(bool(o['needed']) for o in out)} need at least one fact")


def strategies(o) -> dict[str, list[str]]:
    facts = FACTS[o["shop_type"]]
    # The score is a distance: lower means closer to the review.
    ranked = [c for c, _ in sorted(o["search"], key=lambda x: x[1])]
    return {
        "all facts": list(facts),
        "memory, first 5 (what the app did)": [c for c, _ in o["search"]][:5],
        "memory, closest 3": ranked[:3],
        "memory, closest 2": ranked[:2],
        "memory, distance <= 0.78, at most 3": [c for c, s in sorted(o["search"], key=lambda x: x[1]) if s <= 0.78][:3],
    }


def stats() -> dict:
    data = json.loads((OUT / "memory.json").read_text())
    names = list(strategies(data[0]))
    out = {}
    for name in names:
        rec, prec, size, miss = [], [], [], 0
        needy = [o for o in data if o["needed"]]
        for o in needy:
            got = set(strategies(o)[name])
            rec.append(len(got & set(o["needed"])) / len(o["needed"]))
            prec.append(len(got & set(o["needed"])) / len(got) if got else 0.0)
        for o in data:
            size.append(len(strategies(o)[name]))
        out[name] = {"recall": sum(rec) / len(rec), "precision": sum(prec) / len(prec), "facts_sent": sum(size) / len(size),
                     "n": len(needy)}
    return out


def report() -> None:
    for name, s in stats().items():
        print(f"{name:38} recall {s['recall']:.2f}  precision {s['precision']:.2f}  facts per reply {s['facts_sent']:.1f}  (n={s['n']} reviews that need a fact)")


def save() -> None:
    s = stats()
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn, conn.cursor() as cur:
        cur.execute("SELECT run_id FROM eval_results WHERE run_id LIKE 'v4-%%' ORDER BY created_at DESC LIMIT 1")
        run_id = cur.fetchone()[0]
        cur.execute("DELETE FROM eval_results WHERE run_id = %s AND metric LIKE 'memory_%%'", (run_id,))
        for name, v in s.items():
            for k in ("recall", "precision", "facts_sent"):
                cur.execute("INSERT INTO eval_results (system, metric, value, n, run_id) VALUES (%s,%s,%s,%s,%s)",
                            (name, "memory_" + k, v[k], v["n"], run_id))
    print("saved to", run_id)


if __name__ == "__main__":
    step = sys.argv[1]
    if step == "run":
        asyncio.run(run())
    if step == "report":
        report()
    if step == "save":
        save()
