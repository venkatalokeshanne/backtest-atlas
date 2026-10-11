export function num(v: number | null | undefined, d = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}
export function int(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : Math.round(v).toLocaleString("en-US");
}
export function pct(v: number | null | undefined, d = 2): string {
  return v === null || v === undefined ? "—" : `${v > 0 ? "+" : ""}${num(v, d)}%`;
}
/** Tailwind text colour for a signed value. */
export function tone(v: number | null | undefined): string {
  if (v === null || v === undefined || v === 0) return "text-ink-dim";
  return v > 0 ? "text-gain" : "text-loss";
}
/** Score chip colours: 70+ strong, 50+ fair, below weak. */
export function scoreTone(s: number | null): string {
  if (s === null) return "bg-loss/15 text-loss";
  if (s >= 70) return "bg-gain/15 text-gain";
  if (s >= 50) return "bg-signal/15 text-signal";
  return "bg-panel-2 text-ink-dim";
}
