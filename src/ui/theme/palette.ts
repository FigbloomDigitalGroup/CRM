import { contrastRatio } from "@/preferences/contrast";
import { ensureContrast, isDarkColour, mix, readableOn } from "./color";

/**
 * Turns one theme (sidebar, accent, highlight) and one page colour into every colour token the app paints with, for one scheme
 * (light or dark). The design's own values are the starting point; wherever a pairing would read below WCAG AA the colour is moved
 * until it does (F1.01: "contrast of every token pair passes AA"), so a theme or page colour can never produce unreadable text.
 * Pure and dependency-free; `tests/components/ui/palette.test.ts` checks `TOKEN_PAIRS` for every theme and page colour.
 */

export interface SchemeLook {
  sidebar: string;
  accent: string;
  highlight: string;
  /** The page colour for this scheme. */
  pageHex: string;
  dark: boolean;
}

/** WCAG AA for normal text, and for the parts of the interface that are not text (focus ring, borders that carry meaning). */
export const AA_TEXT = 4.5;
export const AA_UI = 3;

const BASE = {
  light: {
    text: "#1B1D1A",
    surface: "#FFFFFF",
    red: "#C0403B",
    orange: "#A95A06",
    blue: "#3A69A8",
    purple: "#7650B0",
    overlay: "rgba(24,30,25,.38)",
    shadowSm: "0 1px 2px rgba(25,35,27,.04),0 1px 3px rgba(25,35,27,.05)",
    shadowMd: "0 10px 30px rgba(25,35,27,.08),0 2px 6px rgba(25,35,27,.04)",
    shadowLg: "0 30px 80px rgba(25,35,27,.22)",
  },
  dark: {
    text: "#EDF1EC",
    surface: "",
    red: "#EC8580",
    orange: "#F4B062",
    blue: "#8DB0E3",
    purple: "#B99AE6",
    overlay: "rgba(0,0,0,.55)",
    shadowSm: "0 1px 2px rgba(0,0,0,.3)",
    shadowMd: "0 10px 30px rgba(0,0,0,.35)",
    shadowLg: "0 30px 80px rgba(0,0,0,.6)",
  },
} as const;

/**
 * Moves `start` toward `toward` (the page colour) in tenths until every `inks` colour reads on it at AA. It always can: each ink already reads on the
 * page, and the walk ends on the page.
 */
function soften(start: string, toward: string, inks: readonly string[]): string {
  let colour = start;
  for (let t = 0.1; inks.some((ink) => contrastRatio(ink, colour) < AA_TEXT) && t <= 1.0001; t += 0.1) colour = mix(start, toward, t);
  return colour;
}

export function buildPalette(look: SchemeLook): Record<string, string> {
  const bg = look.pageHex;
  // The scheme follows the page colour itself, so a mid-tone colour is never paired with the wrong text.
  const dark = isDarkColour(bg);
  const base = BASE[dark ? "dark" : "light"];

  // The design's text colour, moved toward black or white only as far as this page colour needs; every surface is then kept readable under it.
  const text = ensureContrast(base.text, [bg, dark ? bg : "#FFFFFF"], AA_TEXT);
  const surface = soften(dark ? mix(bg, "#FFFFFF", 0.05) : base.surface, bg, [text]);
  const surface2 = soften(dark ? mix(bg, "#FFFFFF", 0.08) : mix(surface, text, 0.03), bg, [text]);
  const surface3 = soften(dark ? mix(bg, "#FFFFFF", 0.12) : mix(surface, text, 0.06), bg, [text]);
  const surfaces = [bg, surface, surface2, surface3];

  const border = dark ? mix(bg, "#FFFFFF", 0.14) : mix(bg, text, 0.1);
  const borderStrong = dark ? mix(bg, "#FFFFFF", 0.22) : mix(bg, text, 0.18);
  const text2 = ensureContrast(mix(text, bg, 0.35), surfaces, AA_TEXT);
  const text3 = ensureContrast(mix(text, bg, 0.5), surfaces, AA_TEXT);

  const side = look.sidebar;
  const sideText = ensureContrast(readableOn(side), [side], AA_TEXT);
  // A slightly lifted sidebar for hover and nested rows, kept readable against the sidebar text.
  const side2 = ensureContrast(mix(side, sideText, 0.08), [sideText], AA_TEXT);

  // The accent as a button fill (white text on it), as text and links, and as the highlight behind selected rows (which text and links sit on).
  const primaryBtn = ensureContrast(look.accent, ["#FFFFFF"], AA_TEXT);
  const primaryHover = mix(primaryBtn, "#000000", 0.12);
  const primaryText = ensureContrast(look.accent, [bg, surface], AA_TEXT);
  const primarySoft = soften(dark ? mix(bg, look.accent, 0.22) : look.highlight, bg, [text, primaryText]);
  const primary = ensureContrast(look.accent, [bg, surface], AA_UI);

  // Each status colour: text that reads on the page and the card, and a soft tint from the card colour that the text reads on too.
  const tone = (fgBase: string, tint: string) => {
    const fg = ensureContrast(fgBase, [bg, surface], AA_TEXT);
    return { fg, soft: soften(mix(surface, tint, dark ? 0.16 : 0.1), bg, [fg]) };
  };
  const red = tone(base.red, base.red);
  const orange = tone(base.orange, "#FF9400");
  const blue = tone(base.blue, base.blue);
  const purple = tone(base.purple, base.purple);

  return {
    "--bg": bg,
    "--surface": surface,
    "--surface-2": surface2,
    "--surface-3": surface3,
    "--border": border,
    "--border-strong": borderStrong,
    "--text": text,
    "--text-2": text2,
    "--text-3": text3,
    "--side": side,
    "--side-2": side2,
    "--side-text": sideText,
    "--primary": primary,
    "--primary-btn": primaryBtn,
    "--primary-hover": primaryHover,
    "--primary-soft": primarySoft,
    "--primary-text": primaryText,
    "--on-primary": "#FFFFFF",
    "--orange": "#FF9400",
    "--orange-text": orange.fg,
    "--orange-soft": orange.soft,
    "--red": red.fg,
    "--red-soft": red.soft,
    "--blue": blue.fg,
    "--blue-soft": blue.soft,
    "--purple": purple.fg,
    "--purple-soft": purple.soft,
    // The design's orange focus ring, darkened (or lightened) until it is visible on this page: 3:1 for a UI component.
    "--focus": ensureContrast("#FF9400", [bg, surface], AA_UI),
    "--overlay": base.overlay,
    "--shadow-sm": base.shadowSm,
    "--shadow-md": base.shadowMd,
    "--shadow-lg": base.shadowLg,
    "--skel": surface3,
    "--skel-2": surface2,
  };
}

/** Every foreground/background pair the interface draws, with the contrast it needs. The CI check walks this for every theme and page colour. */
export const TOKEN_PAIRS: readonly { fg: string; bg: string; min: number; what: string }[] = [
  { fg: "--text", bg: "--bg", min: AA_TEXT, what: "body text on the page" },
  { fg: "--text", bg: "--surface", min: AA_TEXT, what: "body text on cards" },
  { fg: "--text", bg: "--surface-2", min: AA_TEXT, what: "text on table headers and hover rows" },
  { fg: "--text", bg: "--surface-3", min: AA_TEXT, what: "text on chips and wells" },
  { fg: "--text-2", bg: "--bg", min: AA_TEXT, what: "secondary text on the page" },
  { fg: "--text-2", bg: "--surface", min: AA_TEXT, what: "secondary text on cards" },
  { fg: "--text-2", bg: "--surface-3", min: AA_TEXT, what: "secondary text on chips" },
  { fg: "--text-3", bg: "--bg", min: AA_TEXT, what: "hints and placeholders on the page" },
  { fg: "--text-3", bg: "--surface", min: AA_TEXT, what: "hints and placeholders on cards" },
  { fg: "--text-3", bg: "--surface-3", min: AA_TEXT, what: "hints on chips" },
  { fg: "--side-text", bg: "--side", min: AA_TEXT, what: "sidebar text" },
  { fg: "--side-text", bg: "--side-2", min: AA_TEXT, what: "sidebar text on hover" },
  { fg: "--on-primary", bg: "--primary-btn", min: AA_TEXT, what: "primary button label" },
  { fg: "--on-primary", bg: "--primary-hover", min: AA_TEXT, what: "primary button label on hover" },
  { fg: "--primary-text", bg: "--bg", min: AA_TEXT, what: "links on the page" },
  { fg: "--primary-text", bg: "--surface", min: AA_TEXT, what: "links on cards" },
  { fg: "--primary-text", bg: "--primary-soft", min: AA_TEXT, what: "accent text on the highlight" },
  { fg: "--text", bg: "--primary-soft", min: AA_TEXT, what: "text on selected rows" },
  { fg: "--orange-text", bg: "--bg", min: AA_TEXT, what: "warning text on the page" },
  { fg: "--orange-text", bg: "--orange-soft", min: AA_TEXT, what: "warning badge" },
  { fg: "--red", bg: "--bg", min: AA_TEXT, what: "error text on the page" },
  { fg: "--red", bg: "--red-soft", min: AA_TEXT, what: "danger badge" },
  { fg: "--blue", bg: "--blue-soft", min: AA_TEXT, what: "info badge" },
  { fg: "--purple", bg: "--purple-soft", min: AA_TEXT, what: "purple badge" },
  { fg: "--focus", bg: "--bg", min: AA_UI, what: "focus ring on the page" },
  { fg: "--focus", bg: "--surface", min: AA_UI, what: "focus ring on cards" },
  { fg: "--primary", bg: "--bg", min: AA_UI, what: "accent borders and fills on the page" },
];
