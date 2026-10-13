"use client";
import { useState, useTransition } from "react";
import { Check, Plus, Trash } from "@phosphor-icons/react/ssr";
import { saveShopAction } from "@/app/actions";
import { CATEGORIES, type Category, type Shop } from "@/lib/types";

export function SetupForm({ shop }: { shop: Shop }) {
  const [name, setName] = useState(shop.name);
  const [category, setCategory] = useState<Category>(shop.category);
  const [city, setCity] = useState(shop.city);
  const [ownerName, setOwnerName] = useState(shop.ownerName);
  const [facts, setFacts] = useState(shop.facts);
  const [newFact, setNewFact] = useState("");
  const [past, setPast] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  function addFact() {
    const f = newFact.trim();
    if (!f) return;
    setFacts((x) => [...x, f]);
    setNewFact("");
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const pastReplies = past.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
    const pendingFact = newFact.trim();
    const allFacts = pendingFact ? [...facts, pendingFact] : facts;
    start(async () => {
      const res = await saveShopAction({ name, category, city, ownerName, facts: allFacts, pastReplies });
      if (!res.ok) return setMsg({ ok: false, text: res.error });
      setFacts(allFacts); setNewFact(""); setPast("");
      setMsg({ ok: true, text: pastReplies.length ? `Saved. ${pastReplies.length} past ${pastReplies.length === 1 ? "reply" : "replies"} added.` : "Saved." });
    });
  }

  return (
    <form onSubmit={save}>
      <div className="paper">
        <h2>The shop</h2>
        <div style={{ display: "grid", gap: 18 }}>
          <div className="field">
            <label htmlFor="s-name">Shop name</label>
            <input id="s-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="grid2">
            <div className="field">
              <label htmlFor="s-cat">Category</label>
              <select id="s-cat" className="input" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
                {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="s-city">City or area</label>
              <input id="s-city" className="input" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Kothrud, Pune" />
            </div>
          </div>
          <div className="field">
            <label htmlFor="s-owner">Sign replies as</label>
            <input id="s-owner" className="input" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} required style={{ maxWidth: 320 }} />
          </div>
        </div>
      </div>

      <div className="paper">
        <h2>Shop facts</h2>
        <p className="hint" style={{ margin: "-8px 0 14px", color: "var(--ink-2)" }}>
          One short line each. A reply may only promise what is listed here. No fact, no refund or discount.
        </p>
        {facts.length > 0 && (
          <ul className="facts">
            {facts.map((f, i) => (
              <li key={i}>
                <span>{f}</span>
                <button type="button" className="icon-btn" aria-label={`Remove: ${f}`} onClick={() => setFacts((x) => x.filter((_, j) => j !== i))}>
                  <Trash size={17} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="add-row">
          <label htmlFor="s-fact" className="sr-only">New shop fact</label>
          <input id="s-fact" className="input" value={newFact} onChange={(e) => setNewFact(e.target.value)} placeholder="Open Sundays till 2 pm"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addFact(); } }} />
          <button type="button" className="btn" onClick={addFact}><Plus size={17} />Add</button>
        </div>
      </div>

      <div className="paper">
        <h2>Your past replies <span style={{ fontWeight: 500, fontSize: 14, color: "var(--ink-2)" }}>· optional</span></h2>
        <div className="field">
          <label htmlFor="s-past">Paste 5 to 20 replies you wrote</label>
          <textarea id="s-past" className="input" style={{ minHeight: 200 }} value={past} onChange={(e) => setPast(e.target.value)}
            placeholder={"Thanks Priya, I'll tell Ramesh.\n\nFair point, we should have called. Sorry about that. — Ganesh"} />
          <p className="hint">Leave a blank line between replies. They are shown beside each draft so you can compare.{shop.exampleCount ? ` You have ${shop.exampleCount} saved.` : ""}</p>
        </div>
      </div>

      <div className="row-actions" style={{ marginTop: 24 }}>
        <button className="btn primary" disabled={pending}><Check size={17} />{pending ? "Saving…" : "Save shop"}</button>
        <span aria-live="polite">
          {msg && <span className={msg.ok ? "form-ok" : "form-error"} role={msg.ok ? "status" : "alert"}>{msg.text}</span>}
        </span>
      </div>
    </form>
  );
}
