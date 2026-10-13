export function timeAgo(iso: string, now = Date.now()) {
  const diff = now - new Date(iso).getTime();
  const h = diff / 3600_000;
  if (h < 1) return "just now";
  if (h < 24) return `${Math.floor(h)}h ago`;
  if (h < 48) return "yesterday";
  const d = new Date(iso);
  if (h < 24 * 7) return d.toLocaleDateString("en-US", { weekday: "short" });
  return d.toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

export function stars(n: number) {
  return "★".repeat(n) + "☆".repeat(5 - n);
}
