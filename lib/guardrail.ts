import { z } from "zod";
import type { PromiseCheck } from "./types";

// Words that signal the reply is promising something.
const RISKY = /\b(refund|refunded|discount|free|complimentary|waive|waived|compensat\w*|replace for|on the house|money back|next visit|guarantee\w*)\b|\d+\s?%/i;
const STOP = new Set([
  "the", "a", "an", "and", "or", "to", "of", "in", "on", "for", "with", "you", "your", "we", "our", "is", "are", "it", "at", "by", "will", "be", "when", "if", "from", "that", "this", "ask", "me", "us",
]);

function words(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

function stem(w: string) {
  return w.replace(/(ing|ed|es|s)$/, "");
}

function overlap(a: string, b: string) {
  const bs = new Set(words(b).map(stem));
  return words(a).map(stem).filter((w) => bs.has(w)).length;
}

function sentences(text: string) {
  return text.match(/[^.!?\n]+[.!?]?/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
}

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const llmOut = z.object({
  items: z.array(z.object({ text: z.string(), ok: z.boolean(), note: z.string().default("") })).max(12),
});

const CHECK_SYSTEM = `You check a reply to a Google review before the shop owner sends it.
List every promise, offer or commitment in the reply: refunds, discounts, free work, call-backs, timelines, actions by named staff.
For each one, say whether the shop facts back it up. Only a fact that clearly covers it counts. Do not count apologies, thanks or opinions as promises.
Answer with JSON only: {"items":[{"text":"the promise, quoted or short","ok":true or false,"note":"one short plain sentence"}]}
If the reply makes no promises, answer {"items":[]}.`;

async function llmCheck(reply: string, facts: string[]): Promise<PromiseCheck[]> {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model: "openai/gpt-oss-20b",
      reasoning_effort: "low",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: CHECK_SYSTEM },
        { role: "user", content: `Shop facts:\n${facts.length ? facts.map((f) => `- ${f}`).join("\n") : "(none)"}\n\nReply:\n${reply}` },
      ],
    }),
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`Groq returned ${res.status}`);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const parsed = llmOut.parse(JSON.parse(json.choices?.[0]?.message?.content ?? ""));
  if (!parsed.items.length) return [{ text: "No promises made", ok: true, note: "" }];
  return parsed.items.map((i) => ({ text: i.text, ok: i.ok, note: i.note }));
}

/**
 * Checks the reply against the shop facts. Uses Groq when GROQ_API_KEY is set,
 * and falls back to a keyword check if the call fails or is too slow.
 */
export async function checkPromises(reply: string, facts: string[]): Promise<PromiseCheck[]> {
  if (process.env.GROQ_API_KEY) {
    try {
      return await llmCheck(reply, facts);
    } catch (e) {
      console.error("promise check fell back to keywords:", e instanceof Error ? e.message : e);
    }
  }
  return keywordCheck(reply, facts);
}

function keywordCheck(reply: string, facts: string[]): PromiseCheck[] {
  const out: PromiseCheck[] = [];
  const risky: string[] = [];

  for (const s of sentences(reply)) {
    if (!RISKY.test(s)) continue;
    const backed = facts.find((f) => overlap(s, f) >= 2);
    if (backed) {
      out.push({ text: s, ok: true, note: `matches your fact: “${backed}”` });
    } else {
      out.push({ text: s, ok: false, note: "not in your shop facts. Remove it or add a fact." });
    }
    risky.push(s);
  }

  // Facts the reply leans on, shown as ok lines.
  for (const f of facts) {
    if (out.some((o) => o.note.includes(f))) continue;
    if (sentences(reply).some((s) => !risky.includes(s) && overlap(s, f) >= 2)) {
      out.push({ text: f, ok: true, note: "is in your shop facts" });
    }
  }

  if (!risky.length) {
    out.push({ text: "No refund or discount offered", ok: true, note: "" });
  }
  return out;
}
