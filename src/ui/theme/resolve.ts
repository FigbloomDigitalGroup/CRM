import { findPageColour, lookColours } from "@/preferences/catalogue";
import { buildPalette, type SchemeLook } from "./palette";

/**
 * The theme resolver (F1.01): the look the server resolved for the member (their own, or the organisation's default, or the organisation's lock),
 * plus what is stored only on this device (text size, bold, contrast, motion, markers, the light/dark switch), becomes the one set of
 * tokens the app paints with. Pure functions, so the "account vs device vs organisation lock" rules are unit-tested without a browser.
 *
 * Rules:
 *  - The look comes from `GET /api/me/context` (`look`) or the preferences endpoint (B1.08, B1.09); it already says whose it is
 *    (`source`) and whether the organisation locked it (`locked`).
 *  - The page colour sets the scheme (a dark page colour is a dark scheme). "Match my device" follows the operating system.
 *  - The top-bar light/dark switch (stored on the device) swaps to the member's other page colour (`toggle.light` / `toggle.dark`).
 *    It does nothing while the organisation has locked the look.
 *  - Accessibility modes are device settings and are always honoured, locked or not.
 */

export type Scheme = "light" | "dark";
export const TEXT_SIZES = ["SMALL", "DEFAULT", "LARGE", "EXTRA_LARGE"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

/** Settings stored on this device only (B1.08 `deviceOnly`), plus the light/dark switch and the status-marker mode. */
export interface DevicePrefs {
  /** The top-bar switch; `null` follows the page colour (or the operating system for "Match my device"). */
  scheme: Scheme | null;
  textSize: TextSize;
  bold: boolean;
  higherContrast: boolean;
  reduceMotion: boolean;
  /** Colour-blind-safe status markers: every status also carries a shape. */
  statusMarkers: boolean;
}

export const DEFAULT_DEVICE: DevicePrefs = {
  scheme: null,
  textSize: "DEFAULT",
  bold: false,
  higherContrast: false,
  reduceMotion: false,
  statusMarkers: false,
};

/** Text size as a scale on the 14 px design base (13, 14, 16, 18 px). */
export const TEXT_ZOOM: Record<TextSize, number> = { SMALL: 0.93, DEFAULT: 1, LARGE: 1.14, EXTRA_LARGE: 1.29 };

/** The look as `GET /api/me/context` reports it. */
export interface LookInput {
  locked: boolean;
  toggle: { light: string; dark: string };
  colours: {
    sidebar: string;
    accent: string;
    highlight: string;
    page: { key: string; label?: string; hex: string | null; dark: boolean };
  };
}

export function defaultLook(): LookInput {
  const base = lookColours("FOREST", "WHITE");
  return {
    locked: false,
    toggle: { light: "WHITE", dark: "DARK" },
    colours: { sidebar: base.sidebar, accent: base.accent, highlight: base.highlight, page: base.page },
  };
}

function pageFor(look: LookInput, dark: boolean): { hex: string; dark: boolean } {
  const page = look.colours.page;
  // A fixed page colour of the right darkness, or the only page there is while the look is locked.
  if (page.hex && (page.dark === dark || look.locked)) return { hex: page.hex, dark: page.dark };
  const swap = findPageColour(dark ? look.toggle.dark : look.toggle.light);
  if (swap?.hex) return { hex: swap.hex, dark: swap.dark };
  return dark ? { hex: "#0F1512", dark: true } : { hex: "#FAF9F7", dark: false };
}

export function schemeLook(look: LookInput, dark: boolean): SchemeLook {
  const page = pageFor(look, dark);
  return { sidebar: look.colours.sidebar, accent: look.colours.accent, highlight: look.colours.highlight, pageHex: page.hex, dark: page.dark };
}

/** The scheme to start in, before any device switch: the page colour's own, or the operating system's. */
export function defaultScheme(look: LookInput, systemDark: boolean): Scheme {
  const page = look.colours.page;
  if (page.hex) return page.dark ? "dark" : "light";
  return systemDark ? "dark" : "light";
}

export function resolveScheme(look: LookInput, device: DevicePrefs, systemDark: boolean): Scheme {
  if (look.locked && look.colours.page.hex) return look.colours.page.dark ? "dark" : "light";
  if (device.scheme && !look.locked) return device.scheme;
  return defaultScheme(look, systemDark);
}

/**
 * The stylesheet text for both schemes. Both are written out so switching scheme is only an attribute change (no recalculation, no flash),
 * and the server can render it before first paint. Higher contrast is a CSS layer over these tokens, so it needs no recalculation.
 */
export function lookStyles(look: LookInput): string {
  const block = (scheme: Scheme) => {
    const vars = buildPalette(schemeLook(look, scheme === "dark"));
    return `.fb-app[data-fb-scheme="${scheme}"]{${Object.entries(vars)
      .map(([k, v]) => `${k}:${v}`)
      .join(";")}}`;
  };
  return `${block("light")}${block("dark")}`;
}

export type AppearanceAttrs = {
  "data-fb-scheme": Scheme;
  "data-fb-density": "comfortable" | "compact";
  "data-fb-text": TextSize;
  "data-fb-bold": "0" | "1";
  "data-fb-contrast": "0" | "1";
  "data-fb-motion": "0" | "1";
  "data-fb-markers": "0" | "1";
};

/** The root attributes the stylesheet keys on. */
export function appearanceAttrs(input: { scheme: Scheme; density: string | null | undefined; device: DevicePrefs }): AppearanceAttrs {
  const { scheme, density, device } = input;
  return {
    "data-fb-scheme": scheme,
    "data-fb-density": density === "COMPACT" ? "compact" : "comfortable",
    "data-fb-text": device.textSize,
    "data-fb-bold": device.bold ? "1" : "0",
    "data-fb-contrast": device.higherContrast ? "1" : "0",
    "data-fb-motion": device.reduceMotion ? "1" : "0",
    "data-fb-markers": device.statusMarkers ? "1" : "0",
  };
}

// ---- the device store (browser only; every access is guarded, the app works without it)

export const DEVICE_STORAGE_KEY = "figbloom-device-prefs";
/** The key the earlier dark-mode toggle used; read once so a member's choice survives the upgrade. */
export const LEGACY_THEME_KEY = "figbloom-theme";

export function parseDevicePrefs(raw: string | null, legacyTheme: string | null = null): DevicePrefs {
  const out: DevicePrefs = { ...DEFAULT_DEVICE };
  if (legacyTheme === "dark" || legacyTheme === "light") out.scheme = legacyTheme;
  if (!raw) return out;
  try {
    const v = JSON.parse(raw) as Partial<DevicePrefs>;
    if (v.scheme === "light" || v.scheme === "dark" || v.scheme === null) out.scheme = v.scheme;
    if (typeof v.textSize === "string" && (TEXT_SIZES as readonly string[]).includes(v.textSize)) out.textSize = v.textSize as TextSize;
    if (typeof v.bold === "boolean") out.bold = v.bold;
    if (typeof v.higherContrast === "boolean") out.higherContrast = v.higherContrast;
    if (typeof v.reduceMotion === "boolean") out.reduceMotion = v.reduceMotion;
    if (typeof v.statusMarkers === "boolean") out.statusMarkers = v.statusMarkers;
  } catch {
    // A corrupted value is ignored; defaults apply.
  }
  return out;
}

export function readDevicePrefs(): DevicePrefs {
  try {
    return parseDevicePrefs(localStorage.getItem(DEVICE_STORAGE_KEY), localStorage.getItem(LEGACY_THEME_KEY));
  } catch {
    return { ...DEFAULT_DEVICE };
  }
}

export function writeDevicePrefs(prefs: DevicePrefs): void {
  try {
    localStorage.setItem(DEVICE_STORAGE_KEY, JSON.stringify(prefs));
    localStorage.removeItem(LEGACY_THEME_KEY);
  } catch {
    // Best-effort: private browsing or blocked storage just means the choice is not remembered.
  }
}
