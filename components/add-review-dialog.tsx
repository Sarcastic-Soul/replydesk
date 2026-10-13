"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { UploadSimple, X, Plus } from "@phosphor-icons/react/ssr";
import { addReviewAction, importCsvAction } from "@/app/actions";
import type { Review } from "@/lib/types";

type Props = {
  open: boolean;
  initialTab: "paste" | "csv";
  onClose: () => void;
  onAdded: (reviews: Review[], selectId?: string) => void;
};

export function AddReviewDialog({ open, initialTab, onClose, onAdded }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<"paste" | "csv">(initialTab);
  const [author, setAuthor] = useState("");
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const [csv, setCsv] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setTab(initialTab);
      setError("");
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open, initialTab]);

  function submitPaste(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    start(async () => {
      const res = await addReviewAction({ author, rating, text });
      if (!res.ok) return setError(res.error);
      onAdded(res.reviews, res.id);
      setAuthor(""); setRating(0); setText("");
      onClose();
    });
  }

  function submitCsv(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    start(async () => {
      const res = await importCsvAction(csv);
      if (!res.ok) return setError(res.error);
      onAdded(res.reviews);
      setCsv("");
      onClose();
    });
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) setCsv(await f.text());
  }

  return (
    <dialog ref={ref} className="sheet" aria-labelledby="add-title" onClose={onClose}>
      <div className="sheet-head">
        <h2 id="add-title">Add reviews</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
      </div>
      <div className="sheet-body">
        <div className="tabs" role="tablist" aria-label="How to add">
          <button role="tab" type="button" aria-selected={tab === "paste"} onClick={() => setTab("paste")}>Paste one review</button>
          <button role="tab" type="button" aria-selected={tab === "csv"} onClick={() => setTab("csv")}>Import CSV</button>
        </div>

        {tab === "paste" ? (
          <form onSubmit={submitPaste} style={{ display: "grid", gap: 16 }}>
            <fieldset className="field rating-field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="lbl">Rating</legend>
              <div className="rating" role="radiogroup" aria-label="Rating out of 5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <label key={n}>
                    <input type="radio" name="rating" value={n} checked={rating === n} onChange={() => setRating(n)} aria-label={`${n} out of 5`} />
                    <span aria-hidden="true">{n}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="field">
              <label htmlFor="rv-name">Reviewer name</label>
              <input id="rv-name" className="input" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Rohan M." autoComplete="off" />
            </div>
            <div className="field">
              <label htmlFor="rv-text">Review</label>
              <textarea id="rv-text" className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the review text" required />
            </div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="row-actions">
              <button className="btn primary" disabled={pending || !rating || text.trim().length < 3}><Plus size={17} />{pending ? "Adding…" : "Add review"}</button>
            </div>
          </form>
        ) : (
          <form onSubmit={submitCsv} style={{ display: "grid", gap: 16 }}>
            <p className="hint" style={{ margin: 0, color: "var(--ink-2)", fontSize: 14 }}>
              One review per row. Columns: <b>name, rating, text, date</b>. The date is optional.
            </p>
            <div className="field">
              <label htmlFor="csv-file">CSV file</label>
              <input id="csv-file" type="file" accept=".csv,text/csv" className="input" onChange={onFile} />
            </div>
            <div className="field">
              <label htmlFor="csv-text">Or paste the rows</label>
              <textarea id="csv-text" className="input" value={csv} onChange={(e) => setCsv(e.target.value)}
                placeholder={'name,rating,text,date\nRohan M.,2,"Car was late, nobody called",2026-10-10'} style={{ fontFamily: "ui-monospace, monospace", fontSize: 14 }} />
            </div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="row-actions">
              <button className="btn primary" disabled={pending || !csv.trim()}><UploadSimple size={17} />{pending ? "Importing…" : "Import"}</button>
            </div>
          </form>
        )}
      </div>
    </dialog>
  );
}
