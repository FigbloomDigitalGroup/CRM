import { contrastRatio, hexToRgb } from "@/preferences/contrast";

/**
 * Colour helpers for the theme engine (F1.01). Everything works on `#RRGGBB` strings and uses the WCAG maths already shared with
 * the server-side validation in `src/preferences/contrast.ts`, so a colour the server accepts is judged the same way here.
 */

const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

/** `t` of the way from `a` to `b` (0 = a, 1 = b). */
export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex(x.r + (y.r - x.r) * t, x.g + (y.g - x.g) * t, x.b + (y.b - x.b) * t);
}

export function isDarkColour(hex: string): boolean {
  return contrastRatio(hex, "#FFFFFF") > contrastRatio(hex, "#000000");
}

/**
 * Moves `fg` toward black or white, in small steps, until it reads at `min`:1 against every background in `against`. The hue is kept as
 * long as possible, so an accent stays recognisably the accent. Falls back to pure black or white (which always passes against
 * a background that is itself not mid-grey). Returns `fg` untouched when it already passes.
 */
export function ensureContrast(fg: string, against: readonly string[], min: number): string {
  const ok = (c: string) => against.every((bg) => contrastRatio(c, bg) >= min);
  if (ok(fg)) return fg;
  // Darken when the backgrounds are mostly light, lighten when mostly dark.
  const meanLight = against.filter((bg) => !isDarkColour(bg)).length >= against.length / 2;
  const target = meanLight ? "#000000" : "#FFFFFF";
  for (let step = 1; step <= 50; step++) {
    const candidate = mix(fg, target, step / 50);
    if (ok(candidate)) return candidate;
  }
  return target;
}

/** The text colour (white or near-black) that reads best on `bg`. */
export function readableOn(bg: string): string {
  return contrastRatio("#FFFFFF", bg) >= contrastRatio("#111827", bg) ? "#FFFFFF" : "#111827";
}
