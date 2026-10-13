import { asc, desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "./db";
import { csvToReviews } from "./csv";
import { SAMPLE_AB_PAIRS } from "./ab-sample";
import { createAssistant, syncFacts } from "./backboard";
import { CATEGORIES, type AbChoice, type AbPair, type AbTally, type Category, EvalMetric, EvalResults, EvalSystem, Review, ReplyExample, Shop, ShopInput } from "./types";

const { shops, shopFacts, reviews, replies, replyExamples, evalResults, abVotes, abPairs } = schema;

const asCategory = (c: string): Category => (CATEGORIES.some((x) => x.value === c) ? (c as Category) : "retail");

const DEFAULT_SHOP = {
  name: "My shop",
  category: "retail",
  city: "",
  ownerName: "Owner",
};

async function shopRow() {
  const db = getDb();
  const [row] = await db.select().from(shops).orderBy(asc(shops.createdAt)).limit(1);
  if (row) return row;
  const [made] = await db.insert(shops).values(DEFAULT_SHOP).returning();
  return made;
}

function toReview(
  r: typeof reviews.$inferSelect,
  rep?: typeof replies.$inferSelect | null,
): Review {
  return {
    id: r.id, shopId: r.shopId, author: r.author, rating: r.rating, text: r.text,
    source: r.source as Review["source"], createdAt: r.createdAt.toISOString(),
    status: r.status as Review["status"],
    reply: rep ? { text: rep.text, model: rep.model, sentAt: rep.sentAt?.toISOString() ?? null } : null,
  };
}

export async function listReviews(): Promise<Review[]> {
  const db = getDb();
  const shop = await shopRow();
  const rows = await db
    .select({ r: reviews, rep: replies })
    .from(reviews)
    .leftJoin(replies, eq(replies.reviewId, reviews.id))
    .where(eq(reviews.shopId, shop.id))
    .orderBy(desc(reviews.createdAt));
  const seen = new Set<string>();
  return rows.filter((x) => (seen.has(x.r.id) ? false : (seen.add(x.r.id), true))).map((x) => toReview(x.r, x.rep));
}

export async function getReview(id: string) {
  const db = getDb();
  const [row] = await db.select({ r: reviews, rep: replies }).from(reviews)
    .leftJoin(replies, eq(replies.reviewId, reviews.id)).where(eq(reviews.id, id)).limit(1);
  return row ? toReview(row.r, row.rep) : null;
}

export async function addReview(input: { author: string; rating: number; text: string; createdAt?: string | null }) {
  const db = getDb();
  const shop = await shopRow();
  const [row] = await db.insert(reviews).values({
    shopId: shop.id, author: input.author || "Anonymous", rating: input.rating, text: input.text,
    source: "paste", ...(input.createdAt ? { createdAt: new Date(input.createdAt) } : {}),
  }).returning();
  return toReview(row);
}

export async function importCsv(csv: string) {
  const parsed = csvToReviews(csv);
  if (parsed.error) return { added: 0, skipped: 0, error: parsed.error };
  if (!parsed.reviews.length) return { added: 0, skipped: parsed.skipped };
  const db = getDb();
  const shop = await shopRow();
  await db.insert(reviews).values(
    parsed.reviews.map((p) => ({
      shopId: shop.id, author: p.author, rating: p.rating, text: p.text, source: "csv",
      ...(p.createdAt ? { createdAt: new Date(p.createdAt) } : {}),
    })),
  );
  return { added: parsed.reviews.length, skipped: parsed.skipped };
}

export async function markSent(reviewId: string, text: string, meta: { model?: string; latencyMs?: number; costUsd?: number } = {}) {
  const db = getDb();
  await db.delete(replies).where(eq(replies.reviewId, reviewId));
  await db.insert(replies).values({
    reviewId, text, model: meta.model ?? null, latencyMs: meta.latencyMs ?? null,
    costUsd: meta.costUsd ?? null, sentAt: new Date(),
  });
  await db.update(reviews).set({ status: "replied" }).where(eq(reviews.id, reviewId));
  return getReview(reviewId);
}

export async function getShop(): Promise<Shop> {
  const db = getDb();
  const s = await shopRow();
  const facts = await db.select().from(shopFacts).where(eq(shopFacts.shopId, s.id)).orderBy(asc(shopFacts.position));
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(replyExamples).where(eq(replyExamples.shopId, s.id));
  return {
    id: s.id, name: s.name, category: asCategory(s.category), city: s.city, ownerName: s.ownerName,
    facts: facts.map((f) => f.text), exampleCount: n, backboardAssistantId: s.backboardAssistantId,
  };
}

export async function saveShop(input: ShopInput): Promise<Shop> {
  const db = getDb();
  const s = await shopRow();
  await db.update(shops).set({ name: input.name, category: input.category, city: input.city, ownerName: input.ownerName }).where(eq(shops.id, s.id));
  await db.delete(shopFacts).where(eq(shopFacts.shopId, s.id));
  if (input.facts.length) {
    await db.insert(shopFacts).values(input.facts.map((text, position) => ({ shopId: s.id, text, position })));
  }
  if (input.pastReplies.length) {
    // No review text and no embedding for these. They are found by their own words in findSimilarReplies.
    await db.insert(replyExamples).values(
      input.pastReplies.map((replyText) => ({ shopId: s.id, category: input.category, reviewText: "", replyText })),
    );
  }
  await syncMemory(s.id, s.backboardAssistantId, input.name, input.facts);
  return getShop();
}

/** Best effort: a Backboard outage must never stop the shop from saving. */
async function syncMemory(shopId: string, assistantId: string | null, shopName: string, facts: string[]) {
  if (!process.env.BACKBOARD_API_KEY) return;
  try {
    let id = assistantId;
    if (!id) {
      id = await createAssistant(shopName);
      await getDb().update(shops).set({ backboardAssistantId: id }).where(eq(shops.id, shopId));
    }
    await syncFacts(id, facts);
  } catch (e) {
    console.error("backboard sync", e instanceof Error ? e.message : e);
  }
}

type ExampleRow = { review_text: string; reply_text: string; rating: number | null; category: string };

const toExample = (r: ExampleRow, own: boolean): ReplyExample => ({
  reviewText: r.review_text, replyText: r.reply_text, rating: r.rating, category: r.category, own,
});

/**
 * Hybrid search over the curated replies of the shop's trade: BM25 (words) and
 * DiskANN (meaning, only when the browser sent a query vector), top 20 of each,
 * merged with reciprocal rank fusion (k = 60) in one statement.
 * The shop's own past replies come first when they share words with the review.
 */
export async function findSimilarReplies(
  reviewText: string,
  shopType: string,
  limit = 3,
  embedding?: number[] | null,
): Promise<ReplyExample[]> {
  const db = getDb();
  const s = await shopRow();
  const out: ReplyExample[] = [];

  // Own replies have no review text, so match on the words of the reply itself.
  const words = [...new Set(reviewText.toLowerCase().match(/[a-z]{4,}/g) ?? [])].slice(0, 30);
  if (words.length) {
    const tsq = words.join(" | ");
    const own = await db.execute(sql`
      select review_text, reply_text, rating, category
      from reply_examples
      where shop_id = ${s.id} and to_tsvector('english', reply_text || ' ' || review_text) @@ to_tsquery('english', ${tsq})
      order by ts_rank(to_tsvector('english', reply_text || ' ' || review_text), to_tsquery('english', ${tsq})) desc
      limit ${Math.min(limit, 2)}`);
    out.push(...(own as unknown as ExampleRow[]).map((r) => toExample(r, true)));
  }

  const vec = embedding?.length === 384 ? `[${embedding.join(",")}]` : null;
  const vecCte = vec
    ? sql`, vec as (
        select id, row_number() over (order by embedding <=> ${vec}::vector) as rnk
        from (select id, embedding from reply_examples
              where shop_id is null and category = ${shopType} and embedding is not null
              order by embedding <=> ${vec}::vector limit 20) v
      )`
    : sql``;
  const vecUnion = vec ? sql`union all select id, 1.0 / (60 + rnk) from vec` : sql``;

  const rows = await db.execute(sql`
    with bm as (
      select id, row_number() over (order by score) as rnk
      from (select id, review_text <@> to_bm25query(${reviewText}, 'reply_examples_bm25_idx') as score
            from reply_examples
            where shop_id is null and category = ${shopType}
            order by review_text <@> to_bm25query(${reviewText}, 'reply_examples_bm25_idx')
            limit 20) b
    )${vecCte}
    , fused as (
      select id, sum(rrf) as score from (
        select id, 1.0 / (60 + rnk) as rrf from bm
        ${vecUnion}
      ) u group by id
    )
    select e.review_text, e.reply_text, e.rating, e.category
    from fused f join reply_examples e on e.id = f.id
    order by f.score desc
    limit ${limit}`);
  out.push(...(rows as unknown as ExampleRow[]).map((r) => toExample(r, false)));
  return out.slice(0, limit);
}

export async function getEvalResults(): Promise<EvalResults | null> {
  const db = getDb();
  const [latest] = await db.select().from(evalResults).orderBy(desc(evalResults.createdAt)).limit(1);
  if (!latest) return null;
  const rows = await db.select().from(evalResults).where(eq(evalResults.runId, latest.runId));
  const values: EvalResults["values"] = {};
  for (const r of rows) {
    const sys = r.system as EvalSystem;
    (values[sys] ??= {})[r.metric as EvalMetric] = r.value;
  }
  return { runId: latest.runId, createdAt: latest.createdAt.toISOString(), n: Math.max(...rows.map((r) => r.n)), values };
}

export async function getAbPairs(): Promise<{ pairs: AbPair[]; isSample: boolean }> {
  const rows = await getDb().select().from(abPairs);
  if (!rows.length) return { pairs: SAMPLE_AB_PAIRS, isSample: true };
  return {
    pairs: rows.map((r) => ({
      id: r.id, author: "A customer", rating: r.rating, reviewText: r.reviewText, base: r.baseReply, tuned: r.tunedReply,
    })),
    isSample: false,
  };
}

export async function getAbTally(): Promise<AbTally> {
  const rows = await getDb()
    .select({ choice: abVotes.choice, n: sql<number>`count(*)::int` })
    .from(abVotes)
    .groupBy(abVotes.choice);
  const tally: AbTally = { base: 0, tuned: 0, same: 0 };
  for (const r of rows) if (r.choice in tally) tally[r.choice as AbChoice] = r.n;
  return tally;
}

export async function saveVote(pairId: string, choice: AbChoice) {
  const db = getDb();
  const s = await shopRow();
  await db.insert(abVotes).values({ pairId, choice, shopId: s.id });
}
