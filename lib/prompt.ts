import type { Review, Shop, Tweak } from "./types";

// This prompt must match the training prompt exactly (fine-tuned Qwen3.5-4B).
// Do not add past-reply examples here. The model never saw them in training.

export type PromptInput = {
  shop: Pick<Shop, "name" | "category" | "ownerName">;
  review: Pick<Review, "rating" | "text" | "author">;
  tweak?: Tweak;
  facts?: string[];
};

const TWEAK_LINE: Record<Tweak, string> = {
  shorter: "(Make it shorter.)",
  warmer: "(Make it warmer.)",
  offer_fix: "(Offer to fix it.)",
};

/** First word of the author name, only if it is all letters and longer than 1 char. */
export function reviewerFirstName(author: string): string | null {
  const first = author.trim().split(/\s+/)[0] ?? "";
  return /^\p{L}{2,}$/u.test(first) ? first : null;
}

export function buildPrompt({ shop, review, tweak, facts }: PromptInput) {
  let system = `You reply to Google reviews for ${shop.name}, a ${shop.category}. Write like the owner: short, warm, specific. Answer what the reviewer actually said. Never promise refunds, discounts or anything the owner hasn't offered. Don't sign off with a name.`;
  if (facts?.length) {
    system += `\n\nShop facts (only promise what is listed here):\n${facts.map((f) => `- ${f}`).join("\n")}`;
  }
  const name = reviewerFirstName(review.author);
  let user = `Rating: ${review.rating}/5\n${name ? `Reviewer: ${name}\n` : ""}Review: ${review.text}`;
  if (tweak) user += `\n${TWEAK_LINE[tweak]}`;
  return { system, user };
}
