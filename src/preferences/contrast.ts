/**
 * WCAG 2.x contrast maths (B1.08), used to vet colours a member or an
 * organisation chooses. Pure and dependency-free so the same rules can be
 * unit-tested and reused by whichever screen previews a colour.
 */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX6 = /^#[0-9a-f]{6}$/i;

export function isHexColour(value: unknown): value is string {
  return typeof value === "string" && HEX6.test(value);
}

export function normaliseHex(value: string): string {
  return value.toUpperCase();
}

export function hexToRgb(hex: string): Rgb {
  if (!isHexColour(hex)) throw new Error(`Not a #RRGGBB colour: ${hex}`);
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast ratio between two colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Round down to one decimal, so "4.5:1 needed, got 4.5" is never printed for 4.49. */
export function formatRatio(ratio: number): string {
  return `${(Math.floor(ratio * 10) / 10).toFixed(1)}:1`;
}

/** WCAG AA for normal-size text. */
export const AA_TEXT = 4.5;

export const DARK_TEXT = "#111827";
export const LIGHT_TEXT = "#F9FAFB";

/** Whichever of the two text colours the interface would draw on `background`, and how well it reads. */
export function bestTextOn(background: string): { colour: string; ratio: number } {
  const dark = contrastRatio(DARK_TEXT, background);
  const light = contrastRatio(LIGHT_TEXT, background);
  return dark >= light ? { colour: DARK_TEXT, ratio: dark } : { colour: LIGHT_TEXT, ratio: light };
}
