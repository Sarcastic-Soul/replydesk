import { csvToReviews } from "./csv";
import { SAMPLE_AB_PAIRS } from "./ab-sample";
import type { AbChoice, AbPair, AbTally, EvalResults, Review, ReplyExample, Shop, ShopInput } from "./types";

const H = 3600_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

type Store = {
  shop: Shop;
  reviews: Review[];
  examples: ReplyExample[];
  votes: { pairId: string; choice: AbChoice; at: string }[];
};

function seed(): Store {
  const shopId = "demo-shop";
  const r = (id: string, author: string, rating: number, text: string, age: number, replied?: string): Review => ({
    id, shopId, author, rating, text, source: "sample", createdAt: ago(age),
    status: replied ? "replied" : "needs_reply",
    reply: replied ? { text: replied, model: null, sentAt: ago(age - H) } : null,
  });
  return {
    shop: {
      id: shopId,
      name: "Shree Ganesh Auto Garage",
      category: "auto repair",
      city: "Kothrud, Pune",
      ownerName: "Ganesh",
      facts: [
        "Same-day WhatsApp update when a job is delayed",
        "Ask for Ramesh at the front desk",
        "Free re-check within 7 days",
      ],
      exampleCount: 1,
    },
    reviews: [
      r("r1", "Rohan M.", 2, "Car was ready a day late and nobody called to tell me. Work itself was fine, brakes feel good now, but I had to take leave twice.", 2 * H),
      r("r2", "Ankit P.", 1, "Charged ₹800 for a check that took five minutes.", 26 * H),
      r("r3", "Meera K.", 4, "Good service, the waiting area could be cleaner.", 28 * H),
      r("r4", "Priya S.", 5, "Ramesh bhai fixed the AC in under an hour. Honest price, showed me the old part.", 72 * H, "Thank you Priya, I'll tell Ramesh. See you next time. — Ganesh"),
      r("r5", "David L.", 5, "Got me back on the road on a Sunday. Lifesavers.", 96 * H, "Glad we could help, David. Drive safe. — Ganesh"),
    ],
    examples: [
      {
        reviewText: "Vehicle was late and I was never informed, had to keep calling.",
        replyText: "Fair point, we dropped the ball on calling you. Ramesh will WhatsApp you next time.",
        rating: 2, category: "auto repair", own: true,
      },
    ],
    votes: [],
  };
}

const g = globalThis as unknown as { __rdStore?: Store };
const store = () => (g.__rdStore ??= seed());

const byNewest = (a: Review, b: Review) => +new Date(b.createdAt) - +new Date(a.createdAt);

export async function listReviews(): Promise<Review[]> {
  return [...store().reviews].sort(byNewest);
}
export async function getReview(id: string) {
  return store().reviews.find((x) => x.id === id) ?? null;
}
export async function addReview(input: { author: string; rating: number; text: string; createdAt?: string | null }) {
  const s = store();
  const rev: Review = {
    id: crypto.randomUUID(), shopId: s.shop.id, author: input.author || "Anonymous", rating: input.rating,
    text: input.text, source: "paste", createdAt: input.createdAt ?? new Date().toISOString(),
    status: "needs_reply", reply: null,
  };
  s.reviews.push(rev);
  return rev;
}
export async function importCsv(csv: string) {
  const parsed = csvToReviews(csv);
  if (parsed.error) return { added: 0, skipped: 0, error: parsed.error };
  const s = store();
  for (const p of parsed.reviews) {
    s.reviews.push({
      id: crypto.randomUUID(), shopId: s.shop.id, author: p.author, rating: p.rating, text: p.text,
      source: "csv", createdAt: p.createdAt ?? new Date().toISOString(), status: "needs_reply", reply: null,
    });
  }
  return { added: parsed.reviews.length, skipped: parsed.skipped };
}
export async function markSent(reviewId: string, text: string, meta: { model?: string; latencyMs?: number; costUsd?: number } = {}) {
  const rev = store().reviews.find((x) => x.id === reviewId);
  if (!rev) return null;
  rev.status = "replied";
  rev.reply = { text, model: meta.model ?? null, sentAt: new Date().toISOString() };
  return rev;
}
export async function getShop(): Promise<Shop> {
  const s = store();
  return { ...s.shop, exampleCount: s.examples.filter((e) => e.own).length };
}
export async function saveShop(input: ShopInput): Promise<Shop> {
  const s = store();
  s.shop = { ...s.shop, name: input.name, category: input.category, city: input.city, ownerName: input.ownerName, facts: input.facts };
  for (const reply of input.pastReplies) {
    s.examples.push({ reviewText: "", replyText: reply, rating: null, category: input.category, own: true });
  }
  return getShop();
}

const tokens = (t: string) => new Set(t.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- same signature as data-db.ts
export async function findSimilarReplies(reviewText: string, _shopType: string, limit = 3, _embedding?: number[] | null, _rating?: number): Promise<ReplyExample[]> {
  // Offline stand-in for the hybrid search in data-db.ts: ranks by shared words.
  const q = tokens(reviewText);
  return store().examples
    .map((e) => {
      const t = tokens(e.reviewText + " " + e.replyText);
      let hit = 0;
      q.forEach((w) => t.has(w) && hit++);
      return { e, score: hit + (e.own ? 0.5 : 0) };
    })
    .filter((x) => x.score >= 1)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.e);
}

export async function getEvalResults(): Promise<EvalResults | null> {
  return null; // real numbers land from the eval run; never invent them
}
export async function getAbPairs(): Promise<{ pairs: AbPair[]; isSample: boolean }> {
  return { pairs: SAMPLE_AB_PAIRS, isSample: true };
}
export async function getAbTally(): Promise<AbTally> {
  const tally: AbTally = { base: 0, tuned: 0, same: 0 };
  for (const v of store().votes) tally[v.choice] += 1;
  return tally;
}
export async function saveVote(pairId: string, choice: AbChoice) {
  store().votes.push({ pairId, choice, at: new Date().toISOString() });
}
