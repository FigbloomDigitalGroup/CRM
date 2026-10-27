import { describe, expect, it } from "vitest";
import { THEMES, PAGE_COLOURS } from "../../../src/preferences/catalogue";
import { AA_TEXT, bestTextOn, contrastRatio, formatRatio } from "../../../src/preferences/contrast";
import { buildPalette, TOKEN_PAIRS, type SchemeLook } from "../../../src/ui/theme/palette";
import { ensureContrast, mix } from "../../../src/ui/theme/color";
import {
  appearanceAttrs,
  DEFAULT_DEVICE,
  defaultLook,
  defaultScheme,
  lookStyles,
  parseDevicePrefs,
  resolveScheme,
  schemeLook,
  type LookInput,
} from "../../../src/ui/theme/resolve";
import { NO_FLASH_SOURCE } from "../../../src/ui/theme/NoFlashScript";

/**
 * F1.01. The CI check the issue asks for: every colour pair the interface draws passes WCAG AA, for every theme, every page colour and both
 * schemes, and for arbitrary colours a member could choose. The resolver rules (account vs device vs the organisation's lock) are tested as
 * pure functions.
 */

function lookWith(themeKey: string, page: { key: string; hex: string; dark: boolean }): LookInput {
  const theme = THEMES.find((t) => t.key === themeKey)!;
  return { locked: false, toggle: { light: "WHITE", dark: "DARK" }, colours: { sidebar: theme.sidebar, accent: theme.accent, highlight: theme.highlight, page } };
}

function failures(palette: Record<string, string>): string[] {
  const out: string[] = [];
  for (const p of TOKEN_PAIRS) {
    const fg = palette[p.fg];
    const bg = palette[p.bg];
    if (!fg || !bg) {
      out.push(`${p.fg}/${p.bg} missing`);
      continue;
    }
    const ratio = contrastRatio(fg, bg);
    if (ratio < p.min) out.push(`${p.what}: ${p.fg} ${fg} on ${p.bg} ${bg} is ${formatRatio(ratio)}, needs ${p.min}:1`);
  }
  return out;
}

describe("contrast of every token pair (AA)", () => {
  const pages = PAGE_COLOURS.filter((p) => p.hex !== null).map((p) => ({ key: p.key, hex: p.hex!, dark: p.dark }));

  it.each(THEMES.map((t) => t.key))("theme %s passes on every page colour, light and dark", (themeKey) => {
    const bad: string[] = [];
    for (const page of pages) {
      const look = lookWith(themeKey, page);
      for (const dark of [false, true]) {
        for (const f of failures(buildPalette(schemeLook(look, dark)))) bad.push(`${themeKey} on ${page.key} (${dark ? "dark" : "light"}): ${f}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("passes for colours a member picks themselves (200 random sidebar, accent, highlight and page colours the server accepts)", () => {
    let seed = 20261027;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const hex = () => `#${Math.floor(rnd() * 0xffffff).toString(16).padStart(6, "0")}`.toUpperCase();
    const bad: string[] = [];
    for (let i = 0; i < 200; i++) {
      const s: SchemeLook = { sidebar: hex(), accent: hex(), highlight: hex(), pageHex: hex(), dark: rnd() > 0.5 };
      // The server refuses a page colour that cannot carry text at AA (checkOwnColours), so only colours it would accept are possible.
      if (bestTextOn(s.pageHex).ratio < AA_TEXT) {
        i--;
        continue;
      }
      for (const f of failures(buildPalette(s))) bad.push(`${JSON.stringify(s)}: ${f}`);
    }
    expect(bad).toEqual([]);
  });

  it("keeps the design's own Forest and white values where they already pass (no needless drift)", () => {
    const forest = buildPalette(schemeLook(lookWith("FOREST", { key: "WHITE", hex: "#FFFFFF", dark: false }), false));
    expect(forest["--text"]).toBe("#1B1D1A");
    expect(forest["--primary-soft"]).toBe("#E3F1E8");
    expect(forest["--side"]).toBe("#14342B");
  });

  it("ensureContrast moves a colour only as far as it must", () => {
    expect(ensureContrast("#000000", ["#FFFFFF"], 4.5)).toBe("#000000");
    const moved = ensureContrast("#FFAA00", ["#FFFFFF"], 4.5);
    expect(contrastRatio(moved, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    expect(mix("#000000", "#FFFFFF", 0.5)).toBe("#808080");
  });
});

describe("the resolver: account, device and the organisation's lock", () => {
  const forestWhite = defaultLook();

  it("starts in the scheme of the page colour; Match my device follows the operating system", () => {
    expect(defaultScheme(forestWhite, true)).toBe("light");
    const dark = { ...forestWhite, colours: { ...forestWhite.colours, page: { key: "DARK", hex: "#1C2120", dark: true } } };
    expect(defaultScheme(dark, false)).toBe("dark");
    const device = { ...forestWhite, colours: { ...forestWhite.colours, page: { key: "MATCH_DEVICE", hex: null, dark: false } } };
    expect(defaultScheme(device, true)).toBe("dark");
    expect(defaultScheme(device, false)).toBe("light");
  });

  it("the device's light/dark switch swaps to the member's other page colour", () => {
    expect(resolveScheme(forestWhite, { ...DEFAULT_DEVICE, scheme: "dark" }, false)).toBe("dark");
    const darkSide = schemeLook(forestWhite, true);
    expect(darkSide.dark).toBe(true);
    expect(darkSide.pageHex).toBe("#1C2120"); // the toggle's dark page colour (DARK)
    expect(schemeLook(forestWhite, false).pageHex).toBe("#FFFFFF");
  });

  it("the toggle pair is honoured when the member chose other page colours for it", () => {
    const look: LookInput = { ...forestWhite, toggle: { light: "MINT", dark: "NAVY_NIGHT" } };
    expect(schemeLook(look, false).pageHex).toBe("#FFFFFF"); // the chosen page is white and light, so it stays
    expect(schemeLook(look, true).pageHex).toBe("#0E1A2B");
  });

  it("while the organisation locks the look, the device switch changes nothing and both schemes use the organisation's page", () => {
    const locked: LookInput = { ...forestWhite, locked: true };
    expect(resolveScheme(locked, { ...DEFAULT_DEVICE, scheme: "dark" }, true)).toBe("light");
    expect(schemeLook(locked, true).pageHex).toBe("#FFFFFF");
    const lockedDark: LookInput = { ...forestWhite, locked: true, colours: { ...forestWhite.colours, page: { key: "DARK", hex: "#1C2120", dark: true } } };
    expect(resolveScheme(lockedDark, { ...DEFAULT_DEVICE, scheme: "light" }, false)).toBe("dark");
  });

  it("accessibility modes are device settings and apply even while the look is locked", () => {
    const attrs = appearanceAttrs({ scheme: "light", density: "COMPACT", device: { ...DEFAULT_DEVICE, textSize: "EXTRA_LARGE", bold: true, higherContrast: true, reduceMotion: true, statusMarkers: true } });
    expect(attrs).toMatchObject({
      "data-fb-density": "compact",
      "data-fb-text": "EXTRA_LARGE",
      "data-fb-bold": "1",
      "data-fb-contrast": "1",
      "data-fb-motion": "1",
      "data-fb-markers": "1",
    });
    expect(appearanceAttrs({ scheme: "dark", density: null, device: DEFAULT_DEVICE })["data-fb-density"]).toBe("comfortable");
  });

  it("writes both schemes into one stylesheet so switching is only an attribute change", () => {
    const css = lookStyles(forestWhite);
    expect(css).toContain('.fb-app[data-fb-scheme="light"]{');
    expect(css).toContain('.fb-app[data-fb-scheme="dark"]{');
    expect(css).toContain("--primary-btn:");
    expect(css).not.toMatch(/undefined|NaN/);
  });

  it("reads stored device settings defensively and migrates the old dark-mode key", () => {
    expect(parseDevicePrefs(null, "dark").scheme).toBe("dark");
    expect(parseDevicePrefs("{not json").textSize).toBe("DEFAULT");
    expect(parseDevicePrefs(JSON.stringify({ textSize: "HUGE", bold: "yes", scheme: "dark" }))).toMatchObject({ textSize: "DEFAULT", bold: false, scheme: "dark" });
    expect(parseDevicePrefs(JSON.stringify({ textSize: "LARGE", reduceMotion: true }))).toMatchObject({ textSize: "LARGE", reduceMotion: true });
  });
});

describe("the no-flash script", () => {
  function run(stored: Record<string, string>, attrs: Record<string, string>) {
    const el = document.createElement("div");
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    const scriptEl = document.createElement("script");
    el.appendChild(scriptEl);
    document.body.appendChild(el);
    localStorage.clear();
    for (const [k, v] of Object.entries(stored)) localStorage.setItem(k, v);
    Object.defineProperty(document, "currentScript", { value: scriptEl, configurable: true });
    try {
      new Function(NO_FLASH_SOURCE)();
    } finally {
      localStorage.clear();
      Object.defineProperty(document, "currentScript", { value: null, configurable: true });
    }
    const out = { scheme: el.getAttribute("data-fb-scheme"), text: el.getAttribute("data-fb-text"), bold: el.getAttribute("data-fb-bold"), html: document.documentElement.getAttribute("data-theme") };
    el.remove();
    document.documentElement.removeAttribute("data-theme");
    return out;
  }

  it("applies this device's switch and modes before first paint", () => {
    const out = run({ "figbloom-device-prefs": JSON.stringify({ scheme: "dark", textSize: "LARGE", bold: true }) }, { "data-fb-default": "light", "data-fb-locked": "0" });
    expect(out).toEqual({ scheme: "dark", text: "LARGE", bold: "1", html: "dark" });
  });

  it("does not let the device switch past the organisation's lock", () => {
    const out = run({ "figbloom-device-prefs": JSON.stringify({ scheme: "dark" }) }, { "data-fb-default": "light", "data-fb-locked": "1" });
    expect(out.scheme).toBe("light");
  });

  it("falls back to the server's default when nothing is stored", () => {
    expect(run({}, { "data-fb-default": "dark", "data-fb-locked": "0" })).toMatchObject({ scheme: "dark", text: "DEFAULT", bold: "0" });
  });
});
