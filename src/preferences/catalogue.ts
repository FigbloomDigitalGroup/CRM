import { bestTextOn, contrastRatio, formatRatio, AA_TEXT, isHexColour, normaliseHex } from "./contrast";

/**
 * The choices behind Preferences > Appearance (B1.08) and the organisation's
 * look (B1.09): ten themes, eleven page colours, density and the date and
 * time options. This is the one place the keys and the colours live, so the
 * API, the validators and (later) the screens agree.
 */

export interface ThemeDef {
  key: string;
  label: string;
  /** Sidebar background, accent (buttons, links) and highlight (selected rows). */
  sidebar: string;
  accent: string;
  highlight: string;
}

export const THEMES: readonly ThemeDef[] = [
  { key: "FOREST", label: "Forest", sidebar: "#203E2A", accent: "#275B3A", highlight: "#E9F1EB" },
  { key: "OCEAN", label: "Ocean", sidebar: "#14365C", accent: "#1F5FA3", highlight: "#E1EEF8" },
  { key: "MIDNIGHT", label: "Midnight", sidebar: "#151A2E", accent: "#4A5BD6", highlight: "#E6E8F7" },
  { key: "AUBERGINE", label: "Aubergine", sidebar: "#3A1F3D", accent: "#7A3E7F", highlight: "#F0E4F1" },
  { key: "TEAL", label: "Teal", sidebar: "#0F3B3E", accent: "#16777A", highlight: "#DFF1EF" },
  { key: "ROSEWOOD", label: "Rosewood", sidebar: "#4A1F24", accent: "#9C3B45", highlight: "#F5E3E7" },
  { key: "CHARCOAL_AMBER", label: "Charcoal and amber", sidebar: "#232323", accent: "#4D4D4D", highlight: "#FBEBD3" },
  { key: "MIST", label: "Mist", sidebar: "#3E4A52", accent: "#4F6B7A", highlight: "#E8EEF5" },
  { key: "SAND", label: "Sand", sidebar: "#5A4632", accent: "#8A6A3F", highlight: "#F3EADB" },
  { key: "SKY", label: "Sky", sidebar: "#1C4E6E", accent: "#2A7BB0", highlight: "#E3F0FA" },
];

export interface PageColourDef {
  key: string;
  label: string;
  /** `null` for "Match my device": the client picks the light or dark side of the member's pair. */
  hex: string | null;
  dark: boolean;
}

export const PAGE_COLOURS: readonly PageColourDef[] = [
  { key: "WHITE", label: "White", hex: "#FAF9F7", dark: false },
  { key: "COOL_GREY", label: "Cool grey", hex: "#F3F5F7", dark: false },
  { key: "WARM_SAND", label: "Warm sand", hex: "#F6F1E8", dark: false },
  { key: "MINT", label: "Mint", hex: "#EFF6F1", dark: false },
  { key: "SKY", label: "Sky", hex: "#EEF4FA", dark: false },
  { key: "LAVENDER", label: "Lavender", hex: "#F3F1FA", dark: false },
  { key: "BLUSH", label: "Blush", hex: "#FAF1F1", dark: false },
  { key: "DARK", label: "Dark", hex: "#0F1512", dark: true },
  { key: "NAVY_NIGHT", label: "Navy night", hex: "#0C1220", dark: true },
  { key: "BLACK", label: "Black", hex: "#000000", dark: true },
  { key: "MATCH_DEVICE", label: "Match my device", hex: null, dark: false },
];

export const DENSITIES = ["COMFORTABLE", "COMPACT"] as const;
export const HOUR_FORMATS = ["H12", "H24"] as const;
export const FIRST_DAYS_OF_WEEK = ["MON", "SUN", "SAT"] as const;
export const DATE_FORMATS = ["DMY", "MDY", "YMD"] as const;

/** The brand defaults: Forest on White (what "Reset" restores, exactly). */
export const BRAND_THEME = "FOREST";
export const BRAND_PAGE_COLOUR = "WHITE";
export const BRAND_TOGGLE_LIGHT = "WHITE";
export const BRAND_TOGGLE_DARK = "DARK";

export function findTheme(key: string): ThemeDef | undefined {
  return THEMES.find((t) => t.key === key);
}
export function findPageColour(key: string): PageColourDef | undefined {
  return PAGE_COLOURS.find((p) => p.key === key);
}
export const THEME_KEYS = THEMES.map((t) => t.key);
export const PAGE_COLOUR_KEYS = PAGE_COLOURS.map((p) => p.key);

// ---------------------------------------------------------------------------
// Own colours (V1.1): validated server side, with the reason spelled out.
// ---------------------------------------------------------------------------

export const OWN_COLOUR_FIELDS = ["sidebar", "accent", "highlight", "page"] as const;
export type OwnColourField = (typeof OWN_COLOUR_FIELDS)[number];
export type OwnColours = Partial<Record<OwnColourField, string>>;

export interface ColourProblem {
  field: OwnColourField;
  code: "COLOUR_INVALID" | "COLOUR_LOW_CONTRAST";
  message: string;
}

const FIELD_NAME: Record<OwnColourField, string> = {
  sidebar: "Sidebar colour",
  accent: "Accent colour",
  highlight: "Highlight colour",
  page: "Page colour",
};

/**
 * Checks a set of own colours against WCAG AA (4.5:1) the way the interface
 * uses them: the page colour must carry the page text, the accent is drawn as
 * text and button fill on the page, the highlight sits behind text, and the
 * sidebar carries its own text. Fields left out fall back to the member's
 * chosen theme and page colour (`base`).
 */
export function checkOwnColours(
  own: Record<string, unknown>,
  base: { sidebar: string; accent: string; highlight: string; page: string },
): { colours: OwnColours; problems: ColourProblem[] } {
  const problems: ColourProblem[] = [];
  const colours: OwnColours = {};

  for (const [field, value] of Object.entries(own)) {
    if (!(OWN_COLOUR_FIELDS as readonly string[]).includes(field)) continue;
    if (value === null || value === undefined) continue;
    if (!isHexColour(value)) {
      problems.push({
        field: field as OwnColourField,
        code: "COLOUR_INVALID",
        message: `${FIELD_NAME[field as OwnColourField]} must be a six-digit hex colour such as #1F7A4D.`,
      });
      continue;
    }
    colours[field as OwnColourField] = normaliseHex(value);
  }
  if (problems.length > 0) return { colours, problems };

  const effective = { ...base, ...colours };
  const need = (field: OwnColourField, ratio: number, against: string, againstLabel: string) => {
    if (ratio >= AA_TEXT) return;
    problems.push({
      field,
      code: "COLOUR_LOW_CONTRAST",
      message: `${FIELD_NAME[field]} ${effective[field]} has a contrast of ${formatRatio(ratio)} against ${againstLabel} ${against}; it needs at least ${AA_TEXT}:1 to be readable.`,
    });
  };

  // Only what the member set is judged: a theme default is already vetted for the light pages
  // it was designed for, and a page choice is not blamed on a colour the member never touched.
  const pageText = bestTextOn(effective.page).colour;
  if (colours.page) need("page", bestTextOn(effective.page).ratio, effective.page, "its own text on");
  if (colours.accent) need("accent", contrastRatio(effective.accent, effective.page), effective.page, "the page colour");
  if (colours.highlight) need("highlight", contrastRatio(pageText, effective.highlight), effective.highlight, "the text on");
  if (colours.sidebar) need("sidebar", bestTextOn(effective.sidebar).ratio, effective.sidebar, "its own text on");
  return { colours, problems };
}

/** The colours a theme and page colour resolve to, for use as the base when vetting own colours. */
export function resolveBase(themeKey: string, pageColourKey: string, toggleLightHex = "#FFFFFF") {
  const theme = findTheme(themeKey) ?? THEMES[0]!;
  const page = findPageColour(pageColourKey);
  return {
    sidebar: theme.sidebar,
    accent: theme.accent,
    highlight: theme.highlight,
    page: page?.hex ?? toggleLightHex,
  };
}

/** A theme and page colour spelled out as the values a client paints with. `pageDark`/`pageHex` are `null` for "Match my device". */
export interface LookColours {
  theme: { key: string; label: string };
  sidebar: string;
  accent: string;
  highlight: string;
  page: { key: string; label: string; hex: string | null; dark: boolean };
}

export function lookColours(themeKey: string, pageColourKey: string): LookColours {
  const theme = findTheme(themeKey) ?? findTheme(BRAND_THEME)!;
  const page = findPageColour(pageColourKey) ?? findPageColour(BRAND_PAGE_COLOUR)!;
  return {
    theme: { key: theme.key, label: theme.label },
    sidebar: theme.sidebar,
    accent: theme.accent,
    highlight: theme.highlight,
    page: { key: page.key, label: page.label, hex: page.hex, dark: page.dark },
  };
}
