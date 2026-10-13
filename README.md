# ReplyDesk

Short, warm replies to Google reviews, written in the shop owner's voice by a small open model (Qwen3.5-4B) fine-tuned on real owner replies. Built for the Hacktoberfest 2026 DEV challenge ("Side Hustle").

## Running the app

Needs [bun](https://bun.sh) 1.4+ and Node 22+.

```bash
bun install
cp .env.example .env.local   # optional, the app runs without it
bun dev                      # http://localhost:3000
bun run build && bun run lint
```

With no env vars the app runs offline: sample reviews, an in-memory store, and a deterministic mock reply instead of the model. Each service below switches on by itself when its variable is set, and the app falls back when a call fails.

| Variable | What it does |
|---|---|
| `TINKER_MODEL_PATH` | `tinker://...` path of the fine-tuned model. Unset means mock replies. |
| `TINKER_API_KEY` | Tinker key. |
| `TINKER_BASE_URL` | Defaults to Tinker's OpenAI-compatible endpoint. |
| `DATABASE_URL` | Postgres (Tiger Cloud). Unset means the in-memory store. Apply `db/schema.sql` first, then `bun --env-file=.env.local scripts/seed.ts` for the demo shop. |
| `BACKBOARD_API_KEY` | Backboard memory for shop facts. Unset means every saved fact is used. |
| `GROQ_API_KEY` | Groq, for the promise check. Unset means a simple keyword check. |

## How it works

1. **Setup.** The owner picks a shop type (one of the six the model was trained on), adds shop facts and, if they like, past replies. Facts are also saved to Backboard memory (one assistant per shop, only new facts are added and removed ones deleted). Past replies go into `reply_examples` so they can be found later.
2. **Draft.** The fine-tuned Qwen3.5-4B on Tinker writes the reply. The prompt (`lib/prompt.ts`) matches the training prompt exactly: no past-reply examples in it. Thinking is off (`reasoning_effort: false`). The app adds the sign-off itself.
3. **Facts for this review.** Backboard memory search returns the facts that match the review. If Backboard fails, all saved facts are used.
4. **Similar replies.** Shown beside the draft, never sent to the model. The search runs in one SQL statement on Postgres: BM25 (`pg_textsearch`) and DiskANN (`vectorscale`) each give their top 20 for the shop's type, and reciprocal rank fusion (k = 60) merges them. The owner's own past replies come first when they match. The review is embedded in your browser (`@huggingface/transformers`, `Xenova/bge-small-en-v1.5`, in a Web Worker), so there is no embedding server to run. If the model has not finished loading, the search uses BM25 only. Drafting never waits for it.
5. **Promise check.** Groq (`openai/gpt-oss-20b`) lists every promise in the reply and marks whether the facts back it. Anything not backed turns the slip stamp to "Check". If Groq fails, a keyword check runs instead.
6. **Pages.** `/better` reads `eval_results` and `/ab` reads `ab_pairs`. Both show a pending note or sample pairs until the eval run fills them.

Where things live: `lib/prompt.ts`, `lib/model.ts` (draft a reply), `lib/backboard.ts` and `lib/facts.ts` (memory), `lib/guardrail.ts` (promise check), `lib/embed-worker.ts` and `lib/use-embedder.ts` (browser embeddings), `lib/data.ts` (one switch between `data-mock.ts` and `data-db.ts`), `lib/db/schema.ts` and `db/schema.sql` (tables), `app/actions.ts` (server actions).

## Notes

- TypeScript is pinned to 6.0.3, not 7.x. `typescript-eslint` (used by `eslint-config-next`) refuses to load on TS 7, so `bun run lint` fails there. Move to 7 when typescript-eslint supports it.
- The `/better` page shows no numbers until `eval_results` has a run. The `/ab` page uses hand-written sample pairs until real pairs exist.
