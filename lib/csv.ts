/** Small CSV parser: quoted fields, escaped quotes, newlines inside quotes. */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = input.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows;
}

export type CsvReview = { author: string; rating: number; text: string; createdAt: string | null };

/** Expects a header row with: name, rating, text, date (date optional). */
export function csvToReviews(input: string): { reviews: CsvReview[]; skipped: number; error?: string } {
  const rows = parseCsv(input);
  if (!rows.length) return { reviews: [], skipped: 0, error: "The file is empty." };
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (names: string[]) => head.findIndex((h) => names.includes(h));
  const iName = idx(["name", "author", "reviewer"]);
  const iRating = idx(["rating", "stars"]);
  const iText = idx(["text", "review", "comment"]);
  const iDate = idx(["date", "time", "created_at"]);
  if (iRating < 0 || iText < 0) {
    return { reviews: [], skipped: 0, error: "Header row needs at least: name, rating, text, date. Missing rating or text." };
  }
  const reviews: CsvReview[] = [];
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const rating = Math.round(Number((r[iRating] ?? "").replace(/[^\d.]/g, "")));
    const text = (r[iText] ?? "").trim();
    if (!text || !(rating >= 1 && rating <= 5)) { skipped++; continue; }
    const d = iDate >= 0 ? new Date((r[iDate] ?? "").trim()) : null;
    reviews.push({
      author: (iName >= 0 ? r[iName] : "").trim() || "Anonymous",
      rating,
      text,
      createdAt: d && !isNaN(d.getTime()) ? d.toISOString() : null,
    });
  }
  return { reviews, skipped };
}
