"use server";

import { z } from "zod";
import * as data from "@/lib/data";
import { draftReply } from "@/lib/model";
import { factsForReview } from "@/lib/facts";
import { checkPromises } from "@/lib/guardrail";
import { CATEGORIES } from "@/lib/types";
import type { DraftResult, PromiseCheck, ReplyExample, Review, Shop, AbChoice } from "@/lib/types";

type Fail = { ok: false; error: string };
const fail = (e: unknown, fallback: string): Fail => ({
  ok: false,
  error: e instanceof z.ZodError ? e.issues[0]?.message ?? fallback : fallback,
});

const draftIn = z.object({
  reviewId: z.string().min(1),
  tweak: z.enum(["shorter", "warmer", "offer_fix"]).optional(),
  // Review vector made in the browser. Optional: without it the search uses words only.
  embedding: z.array(z.number().finite()).length(384).optional(),
});

export async function draftAction(
  raw: z.input<typeof draftIn>,
): Promise<{ ok: true; draft: DraftResult; promises: PromiseCheck[]; examples: ReplyExample[] } | Fail> {
  try {
    const { reviewId, tweak, embedding } = draftIn.parse(raw);
    const [review, shop] = await Promise.all([data.getReview(reviewId), data.getShop()]);
    if (!review) return { ok: false, error: "That review was not found." };
    const [examples, facts] = await Promise.all([
      data.findSimilarReplies(review.text, shop.category, 3, embedding, review.rating).catch((e) => {
        console.error("findSimilarReplies", e instanceof Error ? e.message : e);
        return [];
      }),
      factsForReview(shop, review.text),
    ]);
    const draft = await draftReply({ shop, review, tweak, examples, facts });
    const promises = await checkPromises(draft.reply, facts);
    return { ok: true, draft, promises, examples };
  } catch (e) {
    console.error("draftAction", e);
    return fail(e, "Could not draft a reply. Check the model settings and try again.");
  }
}

export async function checkAction(text: string): Promise<PromiseCheck[]> {
  const shop = await data.getShop();
  return checkPromises(String(text).slice(0, 4000), shop.facts);
}

const reviewIn = z.object({
  author: z.string().trim().max(80).default(""),
  rating: z.number().int().min(1, "Pick a rating from 1 to 5.").max(5, "Pick a rating from 1 to 5."),
  text: z.string().trim().min(3, "Paste the review text.").max(4000),
});

export async function addReviewAction(raw: z.input<typeof reviewIn>): Promise<{ ok: true; id: string; reviews: Review[] } | Fail> {
  try {
    const input = reviewIn.parse(raw);
    const rev = await data.addReview(input);
    return { ok: true, id: rev.id, reviews: await data.listReviews() };
  } catch (e) {
    return fail(e, "Could not save the review.");
  }
}

export async function importCsvAction(
  csv: string,
): Promise<{ ok: true; added: number; skipped: number; reviews: Review[] } | Fail> {
  try {
    const text = z.string().min(1, "Choose a CSV file or paste its contents.").max(2_000_000).parse(csv);
    const res = await data.importCsv(text);
    if (res.error) return { ok: false, error: res.error };
    if (!res.added) return { ok: false, error: "No usable rows. Each row needs a rating from 1 to 5 and some text." };
    return { ok: true, added: res.added, skipped: res.skipped, reviews: await data.listReviews() };
  } catch (e) {
    return fail(e, "Could not import that file.");
  }
}

const sentIn = z.object({
  reviewId: z.string().min(1),
  text: z.string().trim().min(1, "The reply is empty.").max(4000),
  model: z.string().optional(),
  latencyMs: z.number().optional(),
  costUsd: z.number().optional(),
});

export async function markSentAction(raw: z.input<typeof sentIn>): Promise<{ ok: true; reviews: Review[] } | Fail> {
  try {
    const { reviewId, text, ...meta } = sentIn.parse(raw);
    await data.markSent(reviewId, text, meta);
    return { ok: true, reviews: await data.listReviews() };
  } catch (e) {
    return fail(e, "Could not mark it as sent.");
  }
}

const shopIn = z.object({
  name: z.string().trim().min(1, "Add the shop name.").max(120),
  category: z.enum(CATEGORIES.map((c) => c.value) as [string, ...string[]]),
  city: z.string().trim().max(120),
  ownerName: z.string().trim().min(1, "Add the name you sign replies with.").max(60),
  facts: z.array(z.string().trim().min(1).max(160)).max(20),
  pastReplies: z.array(z.string().trim().min(1).max(1200)).max(30),
});

export async function saveShopAction(raw: z.input<typeof shopIn>): Promise<{ ok: true; shop: Shop } | Fail> {
  try {
    const input = shopIn.parse(raw);
    const shop = await data.saveShop({ ...input, category: input.category as Shop["category"] });
    return { ok: true, shop };
  } catch (e) {
    return fail(e, "Could not save the shop.");
  }
}

const voteIn = z.object({
  pairId: z.string().min(1),
  choice: z.enum(["a", "b", "same"]),
  order: z.enum(["base-first", "tuned-first"]),
});

export async function saveVoteAction(raw: z.input<typeof voteIn>): Promise<{ ok: boolean }> {
  try {
    const v = voteIn.parse(raw);
    const choice: AbChoice =
      v.choice === "same" ? "same" : (v.choice === "a") === (v.order === "base-first") ? "base" : "tuned";
    await data.saveVote(v.pairId, choice);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** For reviews that already have a reply: promise check + similar past replies. */
export async function contextAction(reviewId: string): Promise<{ promises: PromiseCheck[]; examples: ReplyExample[] }> {
  const [review, shop] = await Promise.all([data.getReview(String(reviewId)), data.getShop()]);
  if (!review) return { promises: [], examples: [] };
  const [examples, promises] = await Promise.all([
    data.findSimilarReplies(review.text, shop.category, 3, null, review.rating).catch(() => []),
    review.reply ? checkPromises(review.reply.text, shop.facts) : Promise.resolve([]),
  ]);
  return { promises, examples };
}
