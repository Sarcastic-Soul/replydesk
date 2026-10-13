import type { Metadata } from "next";
import Link from "next/link";
import { getAbTally, getEvalResults } from "@/lib/data";
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
  { id: "made_up_promises", label: "Specific promises", help: "Offers a refund, discount, call-back or fix the owner would have to deliver. Lower is safer.", fmt: pct },
  { id: "template_rate", label: "Reads like a template", help: "Could be pasted under any review. Lower is better.", fmt: pct },
  { id: "ranked_first", label: "Judge's first pick", help: "Share of reviews where the judge ranked this reply best of the four.", fmt: pct },
  { id: "win_rate_vs_base", label: "Beats the prompted 4B", help: "Judge ranked it above the prompted base model.", fmt: pct },
  { id: "cost_per_reply", label: "Cost per reply", help: "Tokens in and out at Tinker's price. The 27B price is not public, so it is left out.", fmt: (v) => `$${v.toFixed(5)}` },
  { id: "latency_ms", label: "Latency", help: "Time to a full reply.", fmt: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`) },
];

export default async function BetterPage() {
  const [results, tally] = await Promise.all([getEvalResults(), getAbTally()]);
  const votes = tally.base + tally.tuned + tally.same;
  return (
    <div className="page">
      <h1>Is it better?</h1>
      <p className="lede">
        The fine-tuned model against the same model with a careful prompt, a much bigger open model, and what real owners wrote. Same held-out reviews from businesses the model never saw in training. A judge model from a different family (gpt-oss-120b) saw the four replies in random order with no labels.
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

      {results && (
        <section className="reading">
          <h2>What the numbers say</h2>
          <p>
            Fine-tuning did what it was trained to do: the replies now sound like real owners. They are about the same length,
            use far fewer stock phrases, and make fewer specific promises the owner would have to keep.
          </p>
          <p>
            The judge model still prefers the prompted models. Their replies are longer and almost always name a detail
            from the review, and judges tend to reward that. Real owner replies lose to them by the same margin, so the judge
            is measuring polish, not whether a shop owner would post it.
          </p>
          <p>
            That question goes to people. On the <Link href="/ab">Blind test</Link> page you see one reply from each 4B model
            side by side and pick the one you would send.
            {votes > 0 && (
              <> So far: {tally.tuned} for the fine-tuned reply, {tally.base} for the prompted one, {tally.same} “about the same” ({votes} votes).</>
            )}
          </p>
        </section>
      )}

      <p className="lede" style={{ marginTop: 22, fontSize: 14 }}>
        A dash means that number has not been measured.
      </p>
    </div>
  );
}
