/**
 * The Figbloom CRM logo: the same mark as Figbloom HR (leaf, ring and a single smile) with the HR typeface treatment, a semibold
 * "Figbloom" and the product name in a light weight beside it. The leaf and "CRM" take the brand orange (option B, approved).
 * Presentational only; the wordmark is real text set in the logo font (see `--font-logo` in the root layout).
 */

const ORANGE = "#FF9400";

/** Just the mark. `ring` colours the ring and the smile; the leaf is always the brand orange. */
export function FigbloomMark({ height = 32, ring = "#fff", className }: { height?: number; ring?: string; className?: string }) {
  return (
    <svg className={className} width={(height * 227) / 351} height={height} viewBox="-2 -2 227 351" aria-hidden="true" focusable="false">
      <path d="M118 69 C117 33 148 8 193 4 C191 42 163 67 118 69 Z" fill={ORANGE} />
      <circle cx="110" cy="180" r="67" fill="none" stroke={ring} strokeWidth="46" />
      <path d="M22.5 298.3 A179 179 0 0 0 197.5 298.3" fill="none" stroke={ring} strokeWidth="48" strokeLinecap="round" />
    </svg>
  );
}

/** The full lockup. `size` is the wordmark's font size in px; the mark and the gap scale with it, as in the HR logo. */
export function FigbloomLogo({ size = 24, tone = "dark", className }: { size?: number; tone?: "dark" | "light"; className?: string }) {
  const ring = tone === "dark" ? "#fff" : "#203E2A";
  return (
    <span className={["fb-logo", className].filter(Boolean).join(" ")} style={{ fontSize: size, color: ring }} role="img" aria-label="Figbloom CRM">
      <FigbloomMark height={Math.round(size * 1.372)} ring={ring} className="fb-logo__mark" />
      <span className="fb-logo__word" aria-hidden="true">
        <b>Figbloom</b>
        <i>CRM</i>
      </span>
    </span>
  );
}
