import type { Metadata } from "next";
import Link from "next/link";
import { getAbTally, getEvalResults } from "@/lib/data";
import type { EvalMetric, EvalSystem } from "@/lib/types";

export const metadata: Metadata = { title: "Is it better?" };
export const dynamic = "force-dynamic";

const SYSTEMS: { id: EvalSystem; label: string }[] = [
  { id: "base", label: "Qwen3.5-4B, short prompt" },
  { id: "careful", label: "Qwen3.5-4B, long rulebook prompt" },
  { id: "v3", label: "Earlier tune (v3)" },
  { id: "v4", label: "ReplyDesk (v4, fine-tuned)" },
  { id: "real", label: "Real owner reply" },
];

const pct = (v: number) => `${Math.round(v * 100)}%`;
const METRICS: { id: EvalMetric; label: string; help: string; fmt: (v: number) => string }[] = [
  { id: "pass_all", label: "Passes every rule", help: "Short, answers the review, no stock phrase, no arguing, an apology on low stars, no unbacked promise. Higher is better.", fmt: pct },
  { id: "rule_detail", label: "Mentions a detail", help: "Reply repeats something the customer actually said. Higher is better.", fmt: pct },
  { id: "unbacked_promise_rate_with_facts", label: "Promises beyond the shop facts", help: "On reviews where the shop saved facts: refunds, discounts or call-backs the facts do not back. Lower is safer.", fmt: pct },
  { id: "median_words", label: "Median words", help: "Real owners write about 34.", fmt: (v) => String(Math.round(v)) },
  { id: "prompt_tokens", label: "Prompt size", help: "Tokens sent with every request. The tuned model needs no rulebook in the prompt.", fmt: (v) => String(Math.round(v)) },
  { id: "cost_per_reply", label: "Cost per reply", help: "Tokens in and out at Tinker's price for Qwen3.5-4B.", fmt: (v) => `$${v.toFixed(5)}` },
  { id: "latency_ms", label: "Latency", help: "Time to a full reply.", fmt: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`) },
  { id: "v4_win_rate", label: "v4 wins head to head", help: "Judge (gpt-oss-120b) picked v4's reply over this column's, 100 reviews. 50% is a tie.", fmt: pct },
];

const BAIT: { id: EvalMetric; label: string; help: string }[] = [
  { id: "bait_pass_all", label: "Passes every rule", help: "Same rules as above. Higher is better." },
  { id: "bait_unbacked_promise_rate", label: "Promises beyond the facts (code check)", help: "Refunds, discounts, free items or call-backs the shop never offered. Lower is safer." },
  { id: "bait_unbacked_model_check", label: "Promises beyond the facts (model check)", help: "A second opinion from gpt-oss-120b, which reads each reply and the facts. Lower is safer." },
  { id: "bait_v4_win_rate", label: "v4 wins head to head", help: "Judge picked v4's reply over this column's, 100 reviews. 50% is a tie." },
];

const RETRIEVAL = [
  { id: "bm25", label: "BM25 only (words)" },
  { id: "vector", label: "Vector only (meaning)" },
  { id: "fused", label: "Both, fused (what the app does)" },
];
const MEMORY = [
  { id: "all facts", label: "Send every fact" },
  { id: "memory, first 5 (what the app did)", label: "Memory, first 5 (the first version of the app)" },
  { id: "memory, closest 3", label: "Memory, closest 3 (what the app does now)" },
  { id: "memory, closest 2", label: "Memory, closest 2" },
];

export default async function BetterPage() {
  const [results, tally] = await Promise.all([getEvalResults(), getAbTally()]);
  const votes = tally.base + tally.tuned + tally.same;
  return (
    <div className="page">
      <h1>Is it better?</h1>
      <p className="lede">
        v4 against the same model with a short prompt, the same model with a long rulebook prompt, the earlier tune, and what real owners wrote.
        300 held-out reviews from businesses the model never saw in training. Half of them come with shop facts, the way the app sends them.
        The rule rows are plain code, not a model. The head-to-head row is a judge model from a different family.
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
                <th key={s.id} scope="col" className={s.id === "v4" ? "tuned" : undefined}>{s.label}</th>
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
                    <td key={s.id} className={s.id === "v4" ? "tuned" : undefined}>
                      {v == null ? <span className="dash" aria-label="not measured">—</span> : m.fmt(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {results?.values.v4?.bait_pass_all != null && (
        <section className="reading wide">
          <h2>The hard test: reviews that ask for money</h2>
          <p>
            150 real 1 and 2 star reviews that demand a refund, a freebie or a call-back, from shops the model never saw
            (none were in training, validation or the test above). About half of them come with shop facts that do not offer any of that.
            This is where a made-up promise costs a shop real money.
          </p>
          <div className="table-wrap">
            <table className="eval">
              <caption className="sr-only">Results on reviews that ask for money</caption>
              <thead>
                <tr>
                  <th scope="col">Metric</th>
                  {SYSTEMS.map((s) => (
                    <th key={s.id} scope="col" className={s.id === "v4" ? "tuned" : undefined}>{s.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {BAIT.map((m) => (
                  <tr key={m.id}>
                    <th scope="row">{m.label}<small>{m.help}</small></th>
                    {SYSTEMS.map((s) => {
                      const v = results.values[s.id]?.[m.id];
                      return (
                        <td key={s.id} className={s.id === "v4" ? "tuned" : undefined}>
                          {v == null ? <span className="dash" aria-label="not measured">—</span> : pct(v)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Here v4 does what the long prompt could not: it promises beyond the facts about half as often (14% against 31%),
            and the judge picks it over the long-prompt model 79 times out of 100. Both checks put v4 lowest, but both are still
            models and code, not shop owners.
          </p>
        </section>
      )}

      {results && (() => {
        const v = results.values as Record<string, Record<string, number | undefined>>;
        if (v.fused?.retrieval_precision_at_3 == null && v["memory, closest 3"]?.memory_recall == null) return null;
        return (
          <section className="reading wide">
            <h2>The parts around the model</h2>
            {v.fused?.retrieval_precision_at_3 != null && (
              <>
                <p>
                  <strong>Tiger Data search.</strong> For 120 held-out reviews, each search returned its top 3 past reviews from the same trade.
                  A judge model, not told which search found which, marked whether each past review was the same kind of situation.
                </p>
                <div className="table-wrap">
                  <table className="eval small">
                    <caption className="sr-only">Search quality by method</caption>
                    <thead><tr><th scope="col">Search</th><th scope="col">Relevant in top 3</th><th scope="col">At least one relevant</th></tr></thead>
                    <tbody>
                      {RETRIEVAL.map((m) => (
                        <tr key={m.id}>
                          <th scope="row">{m.label}</th>
                          <td className={m.id === "fused" ? "tuned" : undefined}>{pct(v[m.id]?.retrieval_precision_at_3 ?? 0)}</td>
                          <td className={m.id === "fused" ? "tuned" : undefined}>{pct(v[m.id]?.retrieval_hit_at_3 ?? 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p>
                  Fusing is the best of the three, but only by a point over vectors alone, which is inside the noise of 120 reviews.
                  Words alone are clearly weaker. So the fusion earns its place mostly by never being the worst.
                </p>
              </>
            )}
            {v["memory, closest 3"]?.memory_recall != null && (
              <>
                <p>
                  <strong>Backboard memory.</strong> 120 held-out reviews across the six shop types, 46 of which need a saved fact
                  (a judge model marked which facts a good reply would use). Recall is how many of the needed facts reach the model.
                  Precision is how many of the facts sent were needed.
                </p>
                <div className="table-wrap">
                  <table className="eval small">
                    <caption className="sr-only">Fact choice by method</caption>
                    <thead><tr><th scope="col">Facts sent to the model</th><th scope="col">Needed facts found</th><th scope="col">Facts sent that were needed</th><th scope="col">Facts per reply</th></tr></thead>
                    <tbody>
                      {MEMORY.map((m) => (
                        <tr key={m.id}>
                          <th scope="row">{m.label}</th>
                          <td className={m.id.endsWith("closest 3") ? "tuned" : undefined}>{pct(v[m.id]?.memory_recall ?? 0)}</td>
                          <td className={m.id.endsWith("closest 3") ? "tuned" : undefined}>{pct(v[m.id]?.memory_precision ?? 0)}</td>
                          <td className={m.id.endsWith("closest 3") ? "tuned" : undefined}>{(v[m.id]?.memory_facts_sent ?? 0).toFixed(1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p>
                  This test found a bug in my first version. Backboard&apos;s search hands back every memory up to the limit, in the order they were
                  saved, and its score is a distance. With about 6 facts per shop and a limit of 5, the app was sending almost all facts. Picking the
                  closest 3 by score keeps 89% of the needed facts and sends half as many.
                </p>
              </>
            )}
          </section>
        );
      })()}

      {results && (
        <section className="reading">
          <h2>What the numbers say</h2>
          <p>
            The first tune (v3) copied the length of real owners but often skipped what the reviewer said, and the judge
            preferred the prompted models. v4 was trained on replies that answer the review in 2 or 3 plain sentences,
            with shop facts in the prompt, and it fixes that: it passes the rules about as often as a prompt that spells
            every rule out, and it beats v3 head to head.
          </p>
          <p>
            It does not beat the long-prompt model on quality. The judge calls it a tie. What it saves is the rulebook:
            the same behavior from a prompt about half the size, a cheaper reply, and no instructions to keep up to date.
            The rules were written from the same guide that made the training data, so the rule rows flatter it a little.
            The head-to-head row and the blind test are the independent checks.
          </p>
          <p>
            People get the last word. On the <Link href="/ab">Blind test</Link> page you see v4 against the long-prompt model
            and pick the one you would send.
            {votes > 0 && (
              <> So far: {tally.tuned} for v4, {tally.base} for the long-prompt model, {tally.same} “about the same” ({votes} votes).</>
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
