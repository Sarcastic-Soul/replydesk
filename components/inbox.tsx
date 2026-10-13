"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowsInSimple, Check, ClockCounterClockwise, Copy, HandHeart, Plus, SealCheck, UploadSimple, Warning, Wrench,
} from "@phosphor-icons/react/ssr";
import { useEmbedder } from "@/lib/use-embedder";
import { checkAction, contextAction, draftAction, markSentAction } from "@/app/actions";
import { stars, timeAgo } from "@/lib/format";
import type { DraftResult, PromiseCheck, ReplyExample, Review, Shop, Tweak } from "@/lib/types";
import { AddReviewDialog } from "./add-review-dialog";

type Slot = {
  status: "loading" | "ready" | "error";
  text: string;
  checkedText: string;
  promises: PromiseCheck[];
  examples: ReplyExample[];
  meta: Pick<DraftResult, "model" | "latencyMs" | "costUsd"> | null;
  error?: string;
};

const GENERIC =
  "“Dear Valued Customer, thank you for taking the time to share your feedback. We sincerely apologize for any inconvenience…”";

export function Inbox({ shop, initialReviews }: { shop: Shop; initialReviews: Review[] }) {
  const [reviews, setReviews] = useState(initialReviews);
  const [selectedId, setSelectedId] = useState<string | null>(initialReviews[0]?.id ?? null);
  const [slots, setSlots] = useState<Record<string, Slot>>({});
  const [dialog, setDialog] = useState<null | "paste" | "csv">(null);
  const [copied, setCopied] = useState(false);
  const [sending, startSend] = useTransition();
  const [sendError, setSendError] = useState("");
  const requested = useRef(new Set<string>());
  const embed = useEmbedder();

  const review = reviews.find((r) => r.id === selectedId) ?? reviews[0] ?? null;
  const slot = review ? slots[review.id] : undefined;
  const todo = reviews.filter((r) => r.status === "needs_reply").length;

  const patch = useCallback((id: string, p: Partial<Slot>) => {
    setSlots((s) => ({ ...s, [id]: { ...(s[id] ?? blank()), ...p } }));
  }, []);

  const runDraft = useCallback(
    async (id: string, tweak?: Tweak) => {
      patch(id, { status: "loading", error: undefined });
      const text = reviews.find((r) => r.id === id)?.text ?? "";
      const embedding = (await embed(text)) ?? undefined;
      const res = await draftAction({ reviewId: id, tweak, embedding });
      if (!res.ok) return patch(id, { status: "error", error: res.error });
      patch(id, {
        status: "ready", text: res.draft.reply, checkedText: res.draft.reply, promises: res.promises,
        examples: res.examples, meta: { model: res.draft.model, latencyMs: res.draft.latencyMs, costUsd: res.draft.costUsd },
      });
    },
    [patch, embed, reviews],
  );

  // Draft automatically the first time an unanswered review is opened.
  useEffect(() => {
    if (!review || requested.current.has(review.id)) return;
    requested.current.add(review.id);
    if (review.status === "needs_reply") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- kicks off an async server action
      void runDraft(review.id);
    } else if (review.reply) {
      const id = review.id;
      const text = review.reply.text;
      patch(id, { status: "ready", text, checkedText: text });
      void contextAction(id).then((c) => patch(id, { promises: c.promises, examples: c.examples }));
    }
  }, [review, runDraft, patch]);

  async function recheck() {
    if (!review || !slot || slot.text === slot.checkedText) return;
    const id = review.id;
    const text = slot.text;
    patch(id, { checkedText: text });
    patch(id, { promises: await checkAction(text) });
  }

  async function copy() {
    if (!slot?.text) return;
    try {
      await navigator.clipboard.writeText(slot.text);
    } catch {
      const t = document.createElement("textarea");
      t.value = slot.text; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  function markSent() {
    if (!review || !slot) return;
    setSendError("");
    startSend(async () => {
      const res = await markSentAction({
        reviewId: review.id, text: slot.text, model: slot.meta?.model, latencyMs: slot.meta?.latencyMs, costUsd: slot.meta?.costUsd,
      });
      if (!res.ok) return setSendError(res.error);
      setReviews(res.reviews);
      const next = res.reviews.find((r) => r.status === "needs_reply" && r.id !== review.id);
      if (next) setSelectedId(next.id);
    });
  }

  function onAdded(list: Review[], selectId?: string) {
    setReviews(list);
    if (selectId) setSelectedId(selectId);
    else if (!selectedId) setSelectedId(list[0]?.id ?? null);
  }

  const sent = review?.status === "replied";
  const loading = slot?.status === "loading" || (!slot && !!review);

  return (
    <div className="shell">
      <aside className="ledger-wrap" aria-label="Reviews">
        <div className="ledger-head">
          <h2>Reviews</h2>
          <span>{todo ? `${todo} to answer` : reviews.length ? "All answered" : "None yet"}</span>
        </div>
        <div className="shopline"><b>{shop.name}</b>{shop.city ? ` · ${shop.city}` : ""}</div>
        {reviews.length ? (
          <ul className="ledger">
            {reviews.map((r) => (
              <li key={r.id}>
                <button className="row" aria-current={r.id === review?.id} onClick={() => setSelectedId(r.id)}>
                  <div className="num">{r.rating}<small>/5</small><span className="sr-only"> stars</span></div>
                  <div>
                    <div className="who">{r.author} <em suppressHydrationWarning>{timeAgo(r.createdAt)}</em></div>
                    <p>{r.text}</p>
                    <span className={`tag ${r.status === "replied" ? "done" : "todo"}`}>
                      {r.status === "replied" ? "Replied" : "Needs reply"}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ledger-empty">Reviews you add show up here, newest first.</p>
        )}
        <div className="foot">
          <button className="btn" onClick={() => setDialog("paste")}><Plus size={16} />Paste a review</button>
          <button className="btn" onClick={() => setDialog("csv")}><UploadSimple size={16} />Import CSV</button>
          <Link href="/setup">Shop facts</Link>
        </div>
      </aside>

      <main className="main">
        {!review ? (
          <div className="empty">
            <h2>No reviews yet.</h2>
            <p>Paste your first Google review and ReplyDesk will write a reply in your voice. Or import a CSV with name, rating, text and date.</p>
            <div className="actions" style={{ marginTop: 0 }}>
              <button className="btn primary" onClick={() => setDialog("paste")}><Plus size={17} />Paste your first review</button>
              <button className="btn" onClick={() => setDialog("csv")}><UploadSimple size={17} />Import CSV</button>
            </div>
          </div>
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={review.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18, ease: "easeOut" }}>
              <div className="meta">
                <span className="stars" aria-label={`${review.rating} out of 5 stars`}>{stars(review.rating)}</span>
                <span suppressHydrationWarning>Google review · {timeAgo(review.createdAt)}</span>
              </div>
              <blockquote className="quote">“{review.text}”</blockquote>
              <div className="by">— {review.author}</div>

              <section className="slip" aria-label="Reply draft">
                <div className="label">
                  <span>{sent ? "Your reply · sent" : "Your reply · draft"}</span>
                  {loading ? <span className="stamp quiet">Drafting</span>
                    : slot?.status === "error" ? <span className="stamp">Failed</span>
                    : sent ? <span className="stamp quiet">Sent</span>
                    : slot?.promises?.some((p) => !p.ok) ? <span className="stamp">Check</span>
                    : <span className="stamp">Ready</span>}
                </div>

                {loading ? (
                  <div className="reply-skel" role="status" aria-label="Drafting a reply"><i /><i /><i /></div>
                ) : slot?.status === "error" ? (
                  <div className="reply-error" role="alert">
                    <p>{slot.error}</p>
                    <button className="btn" onClick={() => runDraft(review.id)}>Try again</button>
                  </div>
                ) : (
                  <AutoTextarea value={slot?.text ?? ""} onChange={(v) => patch(review.id, { text: v })} onBlur={recheck} />
                )}

                <div className="actions">
                  <button className="btn primary" onClick={copy} disabled={loading || slot?.status === "error"}>
                    {copied ? <Check size={17} /> : <Copy size={17} />}{copied ? "Copied" : "Copy reply"}
                  </button>
                  {!sent && (
                    <>
                      <button className="btn" onClick={() => runDraft(review.id, "shorter")} disabled={loading}><ArrowsInSimple size={17} />Shorter</button>
                      <button className="btn" onClick={() => runDraft(review.id, "warmer")} disabled={loading}><HandHeart size={17} />Warmer</button>
                      <button className="btn" onClick={() => runDraft(review.id, "offer_fix")} disabled={loading}><Wrench size={17} />Offer to fix</button>
                      <span className="spacer" />
                      <button className="btn" onClick={markSent} disabled={loading || slot?.status === "error" || sending}><Check size={17} />{sending ? "Saving…" : "Mark sent"}</button>
                    </>
                  )}
                </div>
                <div className="meter" aria-live="polite">
                  {copied ? "Copied. Paste it into Google Business Profile." : sendError ? <span className="form-error">{sendError}</span> : null}
                </div>
              </section>

              <div className="notes">
                <section>
                  <h3><SealCheck size={20} />Promises check</h3>
                  {slot?.promises?.length ? (
                    <ul>
                      {slot.promises.map((p, i) => (
                        <li key={i} className={p.ok ? "" : "bad"}>
                          {p.ok ? <Check size={16} /> : <Warning size={16} />}
                          <span>{p.note ? <>“{p.text}” {p.ok ? "" : "— "}{p.note}</> : p.text}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>{loading ? "Checking…" : "Nothing to check yet."}</p>
                  )}
                </section>
                <section>
                  <h3><ClockCounterClockwise size={20} />How you replied before</h3>
                  {slot?.examples?.length ? (
                    slot.examples.map((e, i) => (
                      <div key={i}>
                        <p>{e.own ? "Your own past reply:" : e.reviewText ? `How a similar shop replied to “${trim(e.reviewText)}”` : "How a similar shop replied:"}</p>
                        <p className="past">“{e.replyText}”</p>
                      </div>
                    ))
                  ) : (
                    <p>{loading ? "Looking…" : <>No similar past reply yet. <Link href="/setup" style={{ textDecoration: "underline" }}>Paste some in Shop setup</Link>.</>}</p>
                  )}
                </section>
              </div>

              <div className="vs">
                <b>A generic AI says</b><s>{GENERIC}</s>
                <b>Model</b>
                <span>
                  {slot?.meta && slot.meta.model !== "offline-sample"
                    ? `${slot.meta.model} · ${Math.round(slot.meta.latencyMs)} ms · $${slot.meta.costUsd.toFixed(5)} for this reply`
                    : "Offline sample reply. Set TINKER_MODEL_PATH to use Qwen3.5-4B, fine-tuned on real owner replies (about $0.0003 per reply, from token prices). Eval numbers pending."}
                </span>
              </div>
            </motion.div>
          </AnimatePresence>
        )}
      </main>

      <AddReviewDialog open={dialog !== null} initialTab={dialog ?? "paste"} onClose={() => setDialog(null)} onAdded={onAdded} />
    </div>
  );
}

function blank(): Slot {
  return { status: "loading", text: "", checkedText: "", promises: [], examples: [], meta: null };
}
const trim = (s: string) => (s.length > 90 ? s.slice(0, 90).trimEnd() + "…" : s);

function AutoTextarea({ value, onChange, onBlur }: { value: string; onChange: (v: string) => void; onBlur: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.max(120, Math.ceil(el.scrollHeight / 30) * 30) + "px";
  }, []);
  useLayoutEffect(fit, [value, fit]);
  useEffect(() => {
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [fit]);
  return (
    <textarea ref={ref} className="reply" value={value} aria-label="Reply text, you can edit it" spellCheck
      onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />
  );
}
