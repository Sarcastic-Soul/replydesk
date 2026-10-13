// `value` is the exact shop type the model was trained with. Do not rename.
export const CATEGORIES = [
  { value: "auto repair", label: "Auto repair or garage" },
  { value: "salon", label: "Salon or spa" },
  { value: "dentist", label: "Clinic / dentist / vet" },
  { value: "cafe/restaurant", label: "Café or restaurant" },
  { value: "home services", label: "Home services" },
  { value: "retail", label: "Shop or retail" },
] as const;

export type Category = (typeof CATEGORIES)[number]["value"];

export type Shop = {
  id: string;
  name: string;
  category: Category;
  city: string;
  ownerName: string;
  facts: string[];
  exampleCount: number;
  backboardAssistantId?: string | null;
};

export type Tweak = "shorter" | "warmer" | "offer_fix";

export type Review = {
  id: string;
  shopId: string;
  author: string;
  rating: number;
  text: string;
  source: "paste" | "csv" | "sample";
  createdAt: string; // ISO
  status: "needs_reply" | "replied";
  reply: { text: string; model: string | null; sentAt: string | null } | null;
};

export type ReplyExample = {
  reviewText: string;
  replyText: string;
  rating: number | null;
  category: string;
  own: boolean; // true when it came from this shop's owner
};

export type DraftResult = {
  reply: string;
  model: string;
  latencyMs: number;
  costUsd: number;
};

export type PromiseCheck = { text: string; ok: boolean; note: string };

export type EvalSystem = "base" | "tuned" | "big" | "real";
export type EvalMetric =
  | "median_words"
  | "cliche_rate"
  | "mentions_detail"
  | "made_up_promises"
  | "template_rate"
  | "ranked_first"
  | "win_rate_vs_base"
  | "cost_per_reply"
  | "latency_ms";

export type EvalResults = {
  runId: string;
  createdAt: string;
  n: number;
  // values[system][metric]; missing means "not measured"
  values: Partial<Record<EvalSystem, Partial<Record<EvalMetric, number>>>>;
};

export type AbPair = {
  id: string;
  reviewText: string;
  author: string;
  rating: number;
  base: string;
  tuned: string;
};

export type AbChoice = "base" | "tuned" | "same";
export type AbTally = Record<AbChoice, number>;

export type ShopInput = {
  name: string;
  category: Category;
  city: string;
  ownerName: string;
  facts: string[];
  pastReplies: string[];
};
