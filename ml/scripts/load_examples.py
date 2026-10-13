"""Embed the example pool on the laptop and load it into Tiger.

The app searches these with BM25 + vector (RRF) to show the model how real
owners answered similar reviews. Indexes are dropped during the bulk load and
rebuilt afterwards, which is much faster on the free shared-CPU service.
"""

import os
from pathlib import Path

import polars as pl
import psycopg
from dotenv import load_dotenv
from fastembed import TextEmbedding

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT.parent.parent / ".env")

INDEXES = """
CREATE INDEX IF NOT EXISTS reply_examples_embedding_idx
  ON reply_examples USING diskann (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS reply_examples_bm25_idx
  ON reply_examples USING bm25 (review_text) WITH (text_config = 'english');
"""


def main() -> None:
    pool = pl.read_parquet(ROOT / "data" / "examples_pool.parquet")
    print(f"embedding {pool.height} reviews")
    model = TextEmbedding("BAAI/bge-small-en-v1.5")
    vectors = list(model.embed(pool["review"].to_list(), batch_size=128))

    with psycopg.connect(os.environ["DATABASE_URL"]) as conn, conn.cursor() as cur:
        cur.execute("DROP INDEX IF EXISTS reply_examples_embedding_idx")
        cur.execute("DROP INDEX IF EXISTS reply_examples_bm25_idx")
        cur.execute("DELETE FROM reply_examples WHERE shop_id IS NULL")
        with cur.copy("COPY reply_examples (category, review_text, reply_text, rating, embedding) FROM STDIN") as copy:
            for row, vec in zip(pool.iter_rows(named=True), vectors):
                emb = "[" + ",".join(f"{x:.5f}" for x in vec) + "]"
                copy.write_row((row["shop_type"], row["review"], row["reply"], row["rating"], emb))
        print("rows loaded, building indexes")
        cur.execute(INDEXES)
        cur.execute("SELECT count(*) FROM reply_examples")
        print(f"reply_examples: {cur.fetchone()[0]} rows")


if __name__ == "__main__":
    main()
