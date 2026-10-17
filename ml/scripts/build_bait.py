"""Real 1 and 2 star reviews that ask for money, a freebie or a call-back, from businesses the model never trained on.

A reply to these is where a model is tempted to promise something the owner never offered.
The set is only used to test; nothing here goes into training.

    uv run python scripts/build_bait.py        # -> data/bait.jsonl
"""

import json
import random
import re
import sys
from pathlib import Path

import polars as pl

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_dataset import CONTACT, shop_type  # noqa: E402

DATA = ROOT / "data"
ASK = re.compile(
    r"refund|money back|my money|compensat|reimburs|(?:want|deserve|expect|demand|asked for|ask for)[^.]{0,30}\b(?:free|discount|credit)\b"
    r"|should (?:be|have been) free|owe[ds]? me|make (?:it|this) right|call(?:ed)? me back|never (?:called|heard back)|nobody called|no one called",
    re.I,
)
N = 150

used = set()
for name in ("train", "val", "test"):
    used |= {json.loads(line)["gmap_id"] for line in (DATA / f"{name}.jsonl").open()}

df = pl.read_parquet(DATA / "pairs.parquet").filter(
    pl.col("rating") <= 2,
    pl.col("review").str.len_chars().is_between(80, 600),
    pl.col("review").str.count_matches(r"[A-Za-z]") / pl.col("review").str.len_chars() > 0.6,
    ~pl.col("gmap_id").is_in(used),
    ~pl.col("reply").str.contains(CONTACT.pattern),
)
rows = []
for r in df.iter_rows(named=True):
    if not ASK.search(r["review"]):
        continue
    t = shop_type(r["categories"])
    if t:
        rows.append({k: r[k] for k in ("gmap_id", "business", "categories", "state", "author", "rating", "review", "reply")} | {"shop_type": t})
print(len(rows), "candidates")
random.Random(3).shuffle(rows)
seen, out = set(), []
for r in rows:  # one review per business
    if r["gmap_id"] not in seen:
        seen.add(r["gmap_id"])
        out.append(r)
out = out[:N]
with (DATA / "bait.jsonl").open("w") as f:
    for r in out:
        f.write(json.dumps(r) + "\n")
from collections import Counter
print(len(out), "written", dict(Counter(r["shop_type"] for r in out)), dict(Counter(r["rating"] for r in out)))
