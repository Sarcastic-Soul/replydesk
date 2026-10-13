"""Pull review + owner-reply pairs out of the raw Google Local files.

Streams each review-<State>.json.gz, keeps reviews that have both text and an
owner reply of a usable length, joins business name and category from the
matching meta file, and writes data/pairs.parquet.
"""

import gzip
import json
import sys
from pathlib import Path

import polars as pl

RAW = Path(__file__).resolve().parent.parent / "data" / "raw"
OUT = Path(__file__).resolve().parent.parent / "data" / "pairs.parquet"


def load_meta(state: str) -> dict[str, tuple[str, list[str]]]:
    meta = {}
    with gzip.open(RAW / f"meta-{state}.json.gz", "rt") as f:
        for line in f:
            m = json.loads(line)
            meta[m["gmap_id"]] = (m.get("name") or "", m.get("category") or [])
    return meta


def pairs(state: str):
    meta = load_meta(state)
    with gzip.open(RAW / f"review-{state}.json.gz", "rt") as f:
        for line in f:
            r = json.loads(line)
            resp = r.get("resp") or {}
            text, reply = r.get("text"), resp.get("text")
            if not text or not reply:
                continue
            if not (40 <= len(text) <= 1500 and 40 <= len(reply) <= 600):
                continue
            name, cats = meta.get(r["gmap_id"], ("", []))
            yield {
                "state": state,
                "gmap_id": r["gmap_id"],
                "business": name,
                "categories": "|".join(cats),
                "author": r.get("name") or "",
                "rating": int(r.get("rating") or 0),
                "review": text,
                "reply": reply,
                "review_time": r.get("time"),
                "reply_time": resp.get("time"),
            }


def main(states: list[str]) -> None:
    frames = []
    for s in states:
        df = pl.DataFrame(list(pairs(s)))
        print(f"{s}: {df.height} pairs", flush=True)
        frames.append(df)
    out = pl.concat(frames)
    out.write_parquet(OUT)
    print(f"total {out.height} pairs -> {OUT}")


if __name__ == "__main__":
    main(sys.argv[1:] or ["Wyoming", "Vermont", "Montana", "Idaho"])
