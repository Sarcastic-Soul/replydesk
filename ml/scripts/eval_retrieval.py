"""Does the hybrid search find better examples than either half alone?

For 120 held-out reviews, run the app's three searches on Tiger (BM25 only, vector only, both fused with
RRF) over the same pool, same shop type and same rating side. A judge model reads each past review next to
the new one, without knowing which search found it, and says whether it is the same kind of situation.

    uv run python scripts/eval_retrieval.py run     # search + judge (cached) -> data/eval/retrieval/
    uv run python scripts/eval_retrieval.py report  # table
    uv run python scripts/eval_retrieval.py save    # numbers -> Tiger eval_results (latest v4 run)
"""

import asyncio
import json
import os
import random
import re
import sys
import time
from pathlib import Path

import psycopg
from dotenv import load_dotenv
from fastembed import TextEmbedding

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
os.environ.setdefault("EVAL_SET", "test")
from eval4 import JUDGE, call  # noqa: E402

load_dotenv(ROOT.parent.parent / ".env")
OUT = ROOT / "data" / "eval" / "retrieval"
OUT.mkdir(parents=True, exist_ok=True)
N, K = 120, 3
METHODS = ["bm25", "vector", "fused"]

BM = """select id, review_text, reply_text from reply_examples
        where shop_id is null and category = %(cat)s and (rating <= 3) = %(low)s
        order by review_text <@> to_bm25query(%(q)s, 'reply_examples_bm25_idx') limit 20"""
VEC = """select id, review_text, reply_text from reply_examples
         where shop_id is null and category = %(cat)s and embedding is not null and (rating <= 3) = %(low)s
         order by embedding <=> %(v)s::vector limit 20"""


def queries() -> list[dict]:
    rows = [json.loads(line) for line in (ROOT / "data" / "test.jsonl").open()]
    rng = random.Random(5)
    return rng.sample(rows, N)


def search(cur, row, vec) -> dict[str, list[dict]]:
    p = {"cat": row["shop_type"], "low": row["rating"] <= 3, "q": row["review"], "v": "[" + ",".join(f"{x:.5f}" for x in vec) + "]"}
    cur.execute(BM, p)
    bm = cur.fetchall()
    cur.execute(VEC, p)
    ve = cur.fetchall()
    score: dict = {}
    for ranked in (bm, ve):
        for rnk, r in enumerate(ranked, 1):
            score[r[0]] = score.get(r[0], 0) + 1.0 / (60 + rnk)
    by_id = {r[0]: r for r in bm + ve}
    fused = sorted(score, key=score.get, reverse=True)
    pick = lambda rs: [{"id": str(r[0]), "review": r[1], "reply": r[2]} for r in rs]  # noqa: E731
    return {"bm25": pick(bm[:K]), "vector": pick(ve[:K]), "fused": pick([by_id[i] for i in fused[:K]])}


PROMPT = """You help check a search tool for shop owners. A customer left a new review. The tool shows past reviews from other shops of the same trade.

New review ({rating} stars): {review}

Past reviews:
{items}

For each past review, decide if it is about the same kind of situation as the new review: the same type of praise or complaint (for example both about slow service, both about a rude staff member, both praise a specific repair). Same trade alone is not enough. Do not judge the replies.
Answer with JSON only, one true or false per past review in order, like {{"relevant": [true, false, true]}}"""


async def run() -> None:
    rows = queries()
    model = TextEmbedding("BAAI/bge-small-en-v1.5")
    vecs = list(model.embed([r["review"] for r in rows]))
    found: list[dict] = []
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn, conn.cursor() as cur:
        for row, v in zip(rows, vecs):
            found.append(search(cur, row, v))
    sem = asyncio.Semaphore(6)

    async def judge(i):
        uniq: dict[str, dict] = {}
        for m in METHODS:
            for c in found[i][m]:
                uniq.setdefault(c["id"], c)
        ids = list(uniq)
        rng = random.Random(i)
        rng.shuffle(ids)
        items = "\n".join(f"{n + 1}. {uniq[x]['review'][:500]}" for n, x in enumerate(ids))
        msg = PROMPT.format(rating=rows[i]["rating"], review=rows[i]["review"][:700], items=items)
        for _ in range(3):
            r, _ = await call(sem, JUDGE, [{"role": "user", "content": msg}], max_tokens=1500, temperature=0,
                              extra_body={"reasoning_effort": "low"})
            m = re.search(r'"relevant"\s*:\s*\[([^\]]*)\]', r.choices[0].message.content or "")
            if m:
                flags = [t.strip() == "true" for t in m.group(1).split(",")]
                if len(flags) == len(ids):
                    return i, dict(zip(ids, flags))
        return i, None

    out = {}
    for coro in asyncio.as_completed([judge(i) for i in range(len(rows))]):
        i, res = await coro
        if res is not None:
            out[i] = res
    results = []
    for i, rel in sorted(out.items()):
        results.append({"i": i, "review": rows[i]["review"], "rating": rows[i]["rating"], "shop_type": rows[i]["shop_type"],
                        "hits": {m: [rel[c["id"]] for c in found[i][m]] for m in METHODS},
                        "found": found[i]})
    (OUT / "retrieval.json").write_text(json.dumps(results))
    print(f"judged {len(results)} of {len(rows)} queries")


def stats() -> dict:
    res = json.loads((OUT / "retrieval.json").read_text())
    out = {}
    for m in METHODS:
        hits = [h for r in res for h in r["hits"][m]]
        out[m] = {
            "precision_at_3": sum(hits) / len(hits),
            "hit_at_3": sum(any(r["hits"][m]) for r in res) / len(res),
            "n": len(res),
        }
    return out


def report() -> None:
    for m, s in stats().items():
        print(f"{m:7} precision@3 {s['precision_at_3']:.2f}   at least one relevant in top 3: {s['hit_at_3']:.2f}   (n={s['n']})")


def save() -> None:
    """Adds retrieval_* metrics to the latest saved v4 run (system = search method)."""
    s = stats()
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn, conn.cursor() as cur:
        cur.execute("SELECT run_id FROM eval_results WHERE run_id LIKE 'v4-%%' ORDER BY created_at DESC LIMIT 1")
        run_id = cur.fetchone()[0]
        cur.execute("DELETE FROM eval_results WHERE run_id = %s AND metric LIKE 'retrieval_%%'", (run_id,))
        for m, v in s.items():
            for k in ("precision_at_3", "hit_at_3"):
                cur.execute("INSERT INTO eval_results (system, metric, value, n, run_id) VALUES (%s,%s,%s,%s,%s)",
                            (m, "retrieval_" + k, v[k], v["n"], run_id))
    print("saved to", run_id)


if __name__ == "__main__":
    step = sys.argv[1]
    if step == "run":
        asyncio.run(run())
    if step == "report":
        report()
    if step == "save":
        save()
