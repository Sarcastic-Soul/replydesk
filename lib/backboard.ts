import "server-only";

// Backboard memory, used through plain fetch. Only the memory endpoints are used
// (our credit covers Memory and RAG, not chat).
const BASE = "https://app.backboard.io/api";

export const backboardIsConfigured = () => Boolean(process.env.BACKBOARD_API_KEY);

async function call<T>(path: string, init: { method?: string; body?: unknown } = {}, timeoutMs = 6000): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers: { "X-API-Key": process.env.BACKBOARD_API_KEY ?? "", "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Backboard ${init.method ?? "GET"} ${path} returned ${res.status}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

export async function createAssistant(shopName: string): Promise<string> {
  const r = await call<{ assistant_id?: string; id?: string }>("/assistants", {
    method: "POST",
    body: { name: `ReplyDesk · ${shopName}` },
  });
  const id = r.assistant_id ?? r.id;
  if (!id) throw new Error("Backboard did not return an assistant id");
  return String(id);
}

type Memory = { id: string; content: string; score?: number };

export async function listMemories(assistantId: string): Promise<Memory[]> {
  const r = await call<{ memories?: Memory[] }>(`/assistants/${assistantId}/memories`);
  return r.memories ?? [];
}

/** Adds new facts and deletes removed ones. Unchanged facts cost nothing. */
export async function syncFacts(assistantId: string, facts: string[]) {
  const existing = await listMemories(assistantId);
  const want = new Set(facts);
  const have = new Set(existing.map((m) => m.content));
  const toAdd = facts.filter((f, i) => !have.has(f) && facts.indexOf(f) === i);
  const toDelete = existing.filter((m) => !want.has(m.content));
  for (const f of toAdd) await call(`/assistants/${assistantId}/memories`, { method: "POST", body: { content: f } });
  for (const m of toDelete) await call(`/assistants/${assistantId}/memories/${m.id}`, { method: "DELETE" });
  return { added: toAdd.length, removed: toDelete.length };
}

/**
 * The closest facts to the review. Throws on failure so the caller can fall back.
 * The search returns every memory up to the limit, in the order they were saved, with a score that is
 * a distance (lower is closer), so the closest ones are picked here, not by position.
 */
export async function searchFacts(assistantId: string, query: string, limit = 3): Promise<string[]> {
  const r = await call<{ memories?: Memory[] }>(`/assistants/${assistantId}/memories/search`, {
    method: "POST",
    body: { query, limit: 10 },
  }, 4000);
  return (r.memories ?? [])
    .sort((a, b) => (a.score ?? Infinity) - (b.score ?? Infinity))
    .slice(0, limit)
    .map((m) => m.content);
}
