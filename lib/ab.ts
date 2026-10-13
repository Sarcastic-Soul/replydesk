import type { AbPair } from "./types";

export type BlindPair = {
  id: string; author: string; rating: number; reviewText: string;
  a: string; b: string; order: "base-first" | "tuned-first";
};

/** Puts the tuned reply on a random side for each pair (A or B). */
export function shuffleSides(pairs: AbPair[]): BlindPair[] {
  return pairs.map((p) => {
    const tunedFirst = Math.random() < 0.5;
    return {
      id: p.id, author: p.author, rating: p.rating, reviewText: p.reviewText,
      a: tunedFirst ? p.tuned : p.base, b: tunedFirst ? p.base : p.tuned,
      order: tunedFirst ? "tuned-first" : "base-first",
    };
  });
}
