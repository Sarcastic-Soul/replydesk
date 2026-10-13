-- ReplyDesk schema for Tiger Cloud (Postgres + pgvector).
-- Mirrors lib/db/schema.ts. Apply with: psql "$DATABASE_URL" -f db/schema.sql

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS vectorscale;    -- DiskANN index
CREATE EXTENSION IF NOT EXISTS pg_textsearch;  -- BM25 ranking

CREATE TABLE IF NOT EXISTS shops (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  category    text NOT NULL,
  city        text NOT NULL DEFAULT '',
  owner_name  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE shops ADD COLUMN IF NOT EXISTS backboard_assistant_id text;  -- Backboard memory assistant

CREATE TABLE IF NOT EXISTS shop_facts (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id   uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  text      text NOT NULL,
  position  integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reviews (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  author      text NOT NULL,
  rating      smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text        text NOT NULL,
  source      text NOT NULL DEFAULT 'paste',        -- paste | csv | sample
  created_at  timestamptz NOT NULL DEFAULT now(),
  status      text NOT NULL DEFAULT 'needs_reply'   -- needs_reply | replied
);
CREATE INDEX IF NOT EXISTS reviews_shop_created_idx ON reviews (shop_id, created_at);
CREATE INDEX IF NOT EXISTS reviews_text_fts_idx ON reviews USING gin (to_tsvector('english', text));

CREATE TABLE IF NOT EXISTS replies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id   uuid NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  text        text NOT NULL,
  model       text,
  latency_ms  integer,
  cost_usd    double precision,
  sent_at     timestamptz
);

CREATE TABLE IF NOT EXISTS reply_examples (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id      uuid REFERENCES shops(id) ON DELETE CASCADE,  -- NULL = curated example
  category     text NOT NULL,
  review_text  text NOT NULL,
  reply_text   text NOT NULL,
  rating       smallint,
  embedding    vector(384)                                   -- BAAI/bge-small-en-v1.5
);
-- Hybrid search: BM25 for exact words, DiskANN for meaning, merged with RRF.
CREATE INDEX IF NOT EXISTS reply_examples_embedding_idx
  ON reply_examples USING diskann (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS reply_examples_bm25_idx
  ON reply_examples USING bm25 (review_text) WITH (text_config = 'english');

CREATE TABLE IF NOT EXISTS eval_results (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  system      text NOT NULL,            -- base | tuned | big | real
  metric      text NOT NULL,            -- median_words | cliche_rate | mentions_detail | made_up_promises | win_rate_vs_base | cost_per_reply | latency_ms
  value       double precision NOT NULL,
  n           integer NOT NULL,
  run_id      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ab_votes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id     text NOT NULL,
  choice      text NOT NULL,            -- base | tuned | same
  created_at  timestamptz NOT NULL DEFAULT now(),
  shop_id     uuid REFERENCES shops(id) ON DELETE SET NULL
);

-- Blind A/B pairs drawn from the eval set (base vs tuned reply to the same review).
CREATE TABLE IF NOT EXISTS ab_pairs (
  id           text PRIMARY KEY,
  category     text NOT NULL,
  rating       smallint NOT NULL,
  review_text  text NOT NULL,
  base_reply   text NOT NULL,
  tuned_reply  text NOT NULL
);
