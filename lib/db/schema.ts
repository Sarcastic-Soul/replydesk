import { sql } from "drizzle-orm";
import {
  doublePrecision,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

export const shops = pgTable("shops", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  city: text("city").notNull().default(""),
  ownerName: text("owner_name").notNull(),
  backboardAssistantId: text("backboard_assistant_id"), // Backboard memory assistant for this shop
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const shopFacts = pgTable("shop_facts", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  position: integer("position").notNull().default(0),
});

export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id").notNull().references(() => shops.id, { onDelete: "cascade" }),
    author: text("author").notNull(),
    rating: smallint("rating").notNull(),
    text: text("text").notNull(),
    source: text("source").notNull().default("paste"), // paste | csv | sample
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    status: text("status").notNull().default("needs_reply"), // needs_reply | replied
  },
  (t) => [
    index("reviews_shop_created_idx").on(t.shopId, t.createdAt),
    index("reviews_text_fts_idx").using("gin", sql`to_tsvector('english', ${t.text})`),
  ],
);

export const replies = pgTable("replies", {
  id: uuid("id").primaryKey().defaultRandom(),
  reviewId: uuid("review_id").notNull().references(() => reviews.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  model: text("model"),
  latencyMs: integer("latency_ms"),
  costUsd: doublePrecision("cost_usd"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
});

export const replyExamples = pgTable(
  "reply_examples",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id").references(() => shops.id, { onDelete: "cascade" }), // null = curated example
    category: text("category").notNull(),
    reviewText: text("review_text").notNull(),
    replyText: text("reply_text").notNull(),
    rating: smallint("rating"),
    embedding: vector("embedding", { dimensions: 384 }),
  },
  (t) => [
    index("reply_examples_embedding_idx").using("diskann", t.embedding.op("vector_cosine_ops")),
    // The BM25 index (reply_examples_bm25_idx, pg_textsearch) is created in db/schema.sql only.
    // Drizzle has no builder for it, and the search query in lib/data-db.ts is raw SQL anyway.
  ],
);

export const evalResults = pgTable("eval_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  system: text("system").notNull(), // base | tuned | big | real
  metric: text("metric").notNull(),
  value: doublePrecision("value").notNull(),
  n: integer("n").notNull(),
  runId: text("run_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const abVotes = pgTable("ab_votes", {
  id: uuid("id").primaryKey().defaultRandom(),
  pairId: text("pair_id").notNull(),
  choice: text("choice").notNull(), // base | tuned | same
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  shopId: uuid("shop_id").references(() => shops.id, { onDelete: "set null" }),
});

export const abPairs = pgTable("ab_pairs", {
  id: text("id").primaryKey(),
  category: text("category").notNull(),
  rating: smallint("rating").notNull(),
  reviewText: text("review_text").notNull(),
  baseReply: text("base_reply").notNull(),
  tunedReply: text("tuned_reply").notNull(),
});
