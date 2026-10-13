import type { Metadata } from "next";
import Link from "next/link";
import { getEvalResults } from "@/lib/data";
import type { EvalMetric, EvalSystem } from "@/lib/types";

export const metadata: Metadata = { title: "Is it better?" };
export const dynamic = "force-dynamic";

const SYSTEMS: { id: EvalSystem; label: string }[] = [
  { id: "base", label: "Qwen3.5-4B, prompted" },
  { id: "tuned", label: "ReplyDesk (Qwen3.5-4B, fine-tuned)" },
  { id: "big", label: "Qwen3.8-27B, prompted" },
  { id: "real", label: "Real owner reply" },
];

const pct = (v: number) => `${Math.round(v * 100)}%`;
const METRICS: { id: EvalMetric; label: string; help: string; fmt: (v: number) => string }[] = [
  { id: "median_words", label: "Median words", help: "Shorter is closer to how owners write.", fmt: (v) => String(Math.round(v)) },
  { id: "cliche_rate", label: "Cliché rate", help: "Replies with stock phrases like “we value your feedback”. Lower is better.", fmt: pct },
  { id: "mentions_detail", label: "Mentions a detail", help: "Reply points to something the customer actually said. Higher is better.", fmt: pct },
  { id: "made_up_promises", label: "Made-up promises", help: "Offers something not in the shop facts. Lower is better.", fmt: pct },
  { id: "win_rate_vs_base", label: "Win rate vs base", help: "Blind pairwise judge, random order, judge never sees which system wrote what.", fmt: pct },
  { id: "cost_per_reply", label: "Cost per reply", help: "Tokens in and out at the provider's price.", fmt: (v) => `$${v.toFixed(4)}` },
  { id: "latency_ms", label: "Latency", help: "Time to a full reply.", fmt: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`) },
];

export default async function BetterPage() {
  const results = await getEvalResults();
  return (
    <div className="page">
      <h1>Is it better?</h1>
      <p className="lede">
        The fine-tuned model against the same model with a careful prompt, a much bigger open model, and what real owners wrote. Same held-out reviews for all four.
      </p>

      {results ? (
        <p className="note-sample" style={{ marginBottom: 18 }}>
          Run {results.runId} · {results.n} held-out reviews · {new Date(results.createdAt).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}
        </p>
      ) : (
        <div className="pending">
          <span className="stamp">Pending</span>
          <div>
            <h2>Eval running, numbers land here.</h2>
            <p>Nothing is filled in yet on purpose. This table reads straight from the eval results, so what you see later is what was measured.</p>
          </div>
        </div>
      )}

      <div className="table-wrap">
        <table className="eval">
          <caption className="sr-only">Eval results by system and metric</caption>
          <thead>
            <tr>
              <th scope="col">Metric</th>
              {SYSTEMS.map((s) => (
                <th key={s.id} scope="col" className={s.id === "tuned" ? "tuned" : undefined}>{s.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {METRICS.map((m) => (
              <tr key={m.id}>
                <th scope="row">{m.label}<small>{m.help}</small></th>
                {SYSTEMS.map((s) => {
                  const v = results?.values[s.id]?.[m.id];
                  return (
                    <td key={s.id} className={s.id === "tuned" ? "tuned" : undefined}>
                      {v == null ? <span className="dash" aria-label="not measured">—</span> : m.fmt(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="lede" style={{ marginTop: 22, fontSize: 14 }}>
        A dash means that number has not been measured. For the human check, owners can vote on blind pairs on the <Link href="/ab" style={{ textDecoration: "underline" }}>Blind test</Link> page.
      </p>
    </div>
  );
}
