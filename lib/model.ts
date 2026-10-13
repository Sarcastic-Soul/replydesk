import { buildPrompt, type PromptInput } from "./prompt";
import type { DraftResult, ReplyExample } from "./types";

const DEFAULT_BASE_URL = "https://tinker.thinkingmachines.dev/services/tinker-prod/oai/api/v1";

// Tinker prices per million tokens (Qwen3.5-4B): prefill $0.33, sample $1.005.
const PREFILL_PER_TOKEN = 0.33 / 1e6;
const SAMPLE_PER_TOKEN = 1.005 / 1e6;

export type DraftInput = PromptInput & {
  // Shown in the UI only. Never sent to the model.
  examples?: ReplyExample[];
};

export function modelIsConfigured() {
  return Boolean(process.env.TINKER_MODEL_PATH);
}

export async function draftReply(input: DraftInput): Promise<DraftResult> {
  const started = Date.now();
  const modelPath = process.env.TINKER_MODEL_PATH;

  if (!modelPath) {
    return { reply: mockReply(input), model: "offline-sample", latencyMs: Date.now() - started + 40, costUsd: 0 };
  }

  const { system, user } = buildPrompt(input);
  const base = (process.env.TINKER_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.TINKER_API_KEY ?? ""}` },
    body: JSON.stringify({
      model: modelPath,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: 0.7,
      max_tokens: 220,
      // Qwen3.5 is a hybrid thinking model. Tinker wants the boolean false, not "none".
      reasoning_effort: false,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Tinker returned ${res.status}`);
  const json = (await res.json()) as {
    choices?: { message?: { content?: string | null } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = json.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Tinker returned an empty reply");

  const inTok = json.usage?.prompt_tokens ?? 0;
  const outTok = json.usage?.completion_tokens ?? 0;
  return {
    reply: `${text} — ${input.shop.ownerName}`,
    model: modelPath.startsWith("tinker://") ? "Qwen3.5-4B (fine-tuned)" : modelPath,
    latencyMs: Date.now() - started,
    costUsd: inTok * PREFILL_PER_TOKEN + outTok * SAMPLE_PER_TOKEN,
  };
}

/* ---------- offline mock: deterministic, no network ---------- */

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function firstName(a: string) {
  return a.trim().split(/\s+/)[0] || "there";
}

function mockReply({ shop, review, tweak, facts }: DraftInput) {
  const name = firstName(review.author);
  const sign = `— ${shop.ownerName}`;
  const pick = <T,>(arr: T[]) => arr[hash(review.text) % arr.length];
  const fact = (re: RegExp) => facts?.find((f) => re.test(f));
  const recheck = fact(/re-?check|redo|fix/i);
  const update = fact(/whatsapp|update|call/i);
  const desk = fact(/ask for/i);

  let parts: string[];
  if (review.rating <= 2) {
    parts = [
      pick([`${name}, you're right, and I'm sorry.`, `${name}, fair point. We should have done better.`]),
      "Thanks for telling us what went wrong.",
      update ? `${update}.` : "We will keep you in the loop next time.",
      desk ? `${desk}.` : "Please ask for me directly.",
    ];
  } else if (review.rating === 3 || review.rating === 4) {
    parts = [
      `Thanks ${name}, glad the main work went well.`,
      pick(["We'll look at the point you raised.", "Your note is useful and we're acting on it."]),
      "See you next time.",
    ];
  } else {
    parts = [
      pick([`Thank you ${name}, that made our day.`, `Thanks ${name}, really good to hear.`]),
      "We'll pass it on to the team.",
      "See you again soon.",
    ];
  }

  if (tweak === "shorter") parts = parts.slice(0, 2);
  if (tweak === "warmer") parts.splice(1, 0, "It means a lot to us that you took the time to write.");
  if (tweak === "offer_fix") {
    parts.splice(
      parts.length - 1,
      0,
      recheck ? `${recheck.replace(/\.$/, "")}, just ask.` : "Call me and we will sort it out together.",
    );
  }
  return `${parts.join(" ")} ${sign}`;
}
