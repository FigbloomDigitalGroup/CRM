/**
 * Picks the file's column for each import field by name, so a sheet whose headers say "School Name", "Email Address" and "Phone Number"
 * is mapped without anyone choosing from a list. Two passes: an exact match on the field's key, label or one of its synonyms, then a header
 * that CONTAINS one of those names (at least four letters, so "no" or "id" never match by accident), preferring the longest match and the
 * leftmost column. A column is used for one field only. Whatever stays unmapped is left for the person to set, or to add later.
 */
export interface GuessField {
  key: string;
  label: string;
  synonyms?: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function guessMapping(fields: readonly GuessField[], header: readonly string[]): Record<string, string> {
  const cols = header.map((h) => ({ h, n: norm(h) })).filter((c) => c.n);
  const names = (f: GuessField) => [f.key, f.label, ...(f.synonyms ?? [])].map(norm).filter(Boolean);
  const out: Record<string, string> = {};
  const used = new Set<string>();

  for (const f of fields) {
    const wanted = names(f);
    const hit = cols.find((c) => !used.has(c.h) && wanted.includes(c.n));
    if (hit) {
      out[f.key] = hit.h;
      used.add(hit.h);
    }
  }
  for (const f of fields) {
    if (out[f.key]) continue;
    const wanted = names(f).filter((n) => n.length >= 4);
    let best: { h: string; len: number } | null = null;
    for (const c of cols) {
      if (used.has(c.h)) continue;
      const len = Math.max(0, ...wanted.filter((n) => c.n.includes(n)).map((n) => n.length));
      if (len > 0 && (!best || len > best.len)) best = { h: c.h, len };
    }
    if (best) {
      out[f.key] = best.h;
      used.add(best.h);
    }
  }
  return out;
}
