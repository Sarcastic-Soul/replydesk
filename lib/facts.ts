import "server-only";
import { searchFacts } from "./backboard";
import type { Shop } from "./types";

/**
 * The shop facts to use for one review. Asks Backboard memory for the facts that
 * match the review. If that fails (or finds nothing), uses every saved fact.
 */
export async function factsForReview(shop: Shop, reviewText: string): Promise<string[]> {
  if (!shop.backboardAssistantId || !process.env.BACKBOARD_API_KEY || !shop.facts.length) return shop.facts;
  try {
    const found = await searchFacts(shop.backboardAssistantId, reviewText, 3);
    return found.length ? found : shop.facts;
  } catch (e) {
    console.error("backboard search fell back to all facts:", e instanceof Error ? e.message : e);
    return shop.facts;
  }
}
