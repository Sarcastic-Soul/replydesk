import "server-only";
import { headers } from "next/headers";

// Per-instance counters. Not exact on serverless (each instance counts alone), but it stops a loop
// from spending the Tinker credit: a few cents of drafts at most per instance per day.
const PER_IP = { max: 30, windowMs: 10 * 60_000 };
const PER_DAY = 1500;

const hits = new Map<string, number[]>();
let day = { start: Date.now(), n: 0 };

export async function allowDraft(): Promise<boolean> {
  const now = Date.now();
  if (now - day.start > 86_400_000) day = { start: now, n: 0 };
  if (day.n >= PER_DAY) return false;

  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < PER_IP.windowMs);
  if (recent.length >= PER_IP.max) return false;
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < PER_IP.windowMs)) hits.delete(k);
  day.n += 1;
  return true;
}
