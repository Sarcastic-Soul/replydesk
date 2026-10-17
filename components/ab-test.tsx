"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveVoteAction } from "@/app/actions";
import { stars } from "@/lib/format";
import type { BlindPair } from "@/lib/ab";

type Vote = { pairId: string; choice: "a" | "b" | "same"; order: BlindPair["order"] };

const NEEDED = 10;

export function AbTest({ pairs }: { pairs: BlindPair[] }) {
  const router = useRouter();
  const [votes, setVotes] = useState<Vote[]>([]);
  const i = votes.length;
  const pair = pairs[i];

  function vote(choice: Vote["choice"]) {
    const v = { pairId: pair.id, choice, order: pair.order };
    setVotes((x) => [...x, v]);
    void saveVoteAction(v);
  }
  function again() {
    setVotes([]);
    router.refresh();
  }

  if (!pairs.length) return <p>No pairs to compare yet.</p>;

  if (!pair) {
    const side = (v: Vote) => (v.choice === "same" ? "same" : (v.choice === "a") === (v.order === "base-first") ? "base" : "tuned");
    const tuned = votes.filter((v) => side(v) === "tuned").length;
    const base = votes.filter((v) => side(v) === "base").length;
    const same = votes.length - tuned - base;
    const showTally = votes.length >= NEEDED;
    return (
      <div>
        <h2 style={{ font: "600 26px var(--font-fraunces), serif", margin: "0 0 6px" }}>That was the last pair.</h2>
        {showTally ? (
          <div className="tally" role="group" aria-label="Your votes">
            <div><b>{tuned}</b><span>picked the fine-tuned reply (v4)</span></div>
            <div><b>{base}</b><span>picked the long-prompt model</span></div>
            <div><b>{same}</b><span>about the same</span></div>
          </div>
        ) : (
          <p className="lede" style={{ margin: "0 0 22px" }}>
            Totals show after {NEEDED} votes, so a few picks do not look like a result. You have {votes.length}.
          </p>
        )}
        <h3 style={{ font: "600 18px var(--font-fraunces), serif", margin: "0 0 10px" }}>Which side was which</h3>
        <ol className="reveal">
          {pairs.map((p, n) => {
            const v = votes[n];
            const tunedLabel = p.order === "tuned-first" ? "A" : "B";
            return (
              <li key={p.id}>
                <span>{p.author} · {p.rating}/5: “{p.reviewText.length > 70 ? p.reviewText.slice(0, 70) + "…" : p.reviewText}”</span>
                <span>
                  Fine-tuned was <em>Reply {tunedLabel}</em>.{" "}
                  {v ? (v.choice === "same" ? "You said about the same." : `You picked Reply ${v.choice.toUpperCase()}.`) : ""}
                </span>
              </li>
            );
          })}
        </ol>
        <button className="btn primary" onClick={again}>Go again in a new order</button>
      </div>
    );
  }

  return (
    <div>
      <div className="ab-head">
        <span>Pair {i + 1} of {pairs.length}</span>
        <span className="ab-progress" aria-hidden="true">
          {pairs.map((p, n) => <i key={p.id} className={n < i ? "done" : n === i ? "now" : ""} />)}
        </span>
      </div>
      <div className="meta">
        <span className="stars" aria-label={`${pair.rating} out of 5 stars`}>{stars(pair.rating)}</span>
        <span>Google review</span>
      </div>
      <blockquote className="quote">“{pair.reviewText}”</blockquote>
      <div className="by">— {pair.author}</div>

      <div className="ab-pair" key={pair.id}>
        <section className="slip l" aria-labelledby="ra">
          <div className="label"><span id="ra">Reply A</span></div>
          <p className="txt">{pair.a}</p>
          <button className="btn" onClick={() => vote("a")}>A is better</button>
        </section>
        <section className="slip r" aria-labelledby="rb">
          <div className="label"><span id="rb">Reply B</span></div>
          <p className="txt">{pair.b}</p>
          <button className="btn" onClick={() => vote("b")}>B is better</button>
        </section>
      </div>
      <div className="ab-same">
        <button className="btn" onClick={() => vote("same")}>About the same</button>
      </div>
    </div>
  );
}
