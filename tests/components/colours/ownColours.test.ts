import { describe, expect, it } from "vitest";
import { checkOwnColours, lookColours } from "../../../src/preferences/catalogue";
import { contrastRatio } from "../../../src/preferences/contrast";
import { buildPalette, TOKEN_PAIRS } from "../../../src/ui/theme/palette";
import { evaluateOwnColours, isChanged, type OwnDraft } from "../../../src/ui/theme/ownColours";

const forest = lookColours("FOREST", "WHITE");
const BASE = { sidebar: forest.sidebar, accent: forest.accent, highlight: forest.highlight, page: forest.page.hex! };
const draft = (over: Partial<OwnDraft> = {}): OwnDraft => ({ ...BASE, ...over });

function hex(n: number) {
  return `#${(n & 0xffffff).toString(16).padStart(6, "0").toUpperCase()}`;
}
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

describe("own colours: the check (AP4, FIG-1176)", () => {
  it("accepts the theme's own colours and says nothing is wrong", () => {
    const r = evaluateOwnColours(draft(), BASE);
    expect(r.canSave).toBe(true);
    expect(r.problems).toEqual([]);
  });

  it("blocks a colour that is not a six-digit hex, with the format in the message", () => {
    const r = evaluateOwnColours(draft({ accent: "#12" }), BASE);
    expect(r.canSave).toBe(false);
    expect(r.fields.find((f) => f.field === "accent")).toMatchObject({ valid: false, blocked: true, note: "Use a 6-digit hex like #275B3A." });
  });

  it("blocks an accent that would not read as text on the page, and suggests one that does", () => {
    const r = evaluateOwnColours(draft({ accent: "#EEEE88" }), BASE);
    const accent = r.fields.find((f) => f.field === "accent")!;
    expect(r.canSave).toBe(false);
    expect(accent.blocked).toBe(true);
    expect(accent.suggestion).toBeTruthy();
    // Taking the suggestion makes the set savable.
    expect(evaluateOwnColours(draft({ accent: accent.suggestion! }), BASE).canSave).toBe(true);
  });

  it("blocks a mid-grey page colour, where neither dark nor light text reads", () => {
    const r = evaluateOwnColours(draft({ page: "#777777" }), BASE);
    expect(contrastRatio("#777777", "#111827")).toBeLessThan(4.5);
    expect(r.canSave).toBe(false);
    expect(r.fields.find((f) => f.field === "page")!.suggestion).toBeTruthy();
  });

  it("darkens the button instead of blocking a light accent that still reads on the page", () => {
    // Light enough that white button text would fail, dark enough against the white page to read as a link.
    const r = evaluateOwnColours(draft({ accent: "#2E9E6B" }), BASE);
    expect(r.preview.button).not.toBe("#2E9E6B");
    expect(contrastRatio(r.preview.button, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
  });

  it("switches the sidebar text to dark on a light sidebar", () => {
    const r = evaluateOwnColours(draft({ sidebar: "#F2E8D5" }), BASE);
    expect(contrastRatio(r.preview.sidebarText, "#F2E8D5")).toBeGreaterThanOrEqual(4.5);
    expect(r.preview.sidebarText).not.toBe("#FFFFFF");
  });

  it("detects whether anything changed", () => {
    expect(isChanged(draft(), BASE)).toBe(false);
    expect(isChanged(draft({ accent: "#112233" }), BASE)).toBe(true);
  });

  it("never lets a set through that the server would refuse (the same rule), and every token pair stays at AA for what it lets through", () => {
    const next = rng(42);
    let allowed = 0;
    for (let i = 0; i < 300; i++) {
      const d = draft({ sidebar: hex(next() * 0xffffff), accent: hex(next() * 0xffffff), highlight: hex(next() * 0xffffff), page: hex(next() * 0xffffff) });
      const r = evaluateOwnColours(d, BASE);
      const server = checkOwnColours(d as unknown as Record<string, unknown>, BASE);
      // The screen and the server agree.
      expect(r.canSave).toBe(server.problems.length === 0);
      if (!r.canSave) continue;
      allowed += 1;
      for (const dark of [false, true]) {
        const pal = buildPalette({ sidebar: d.sidebar, accent: d.accent, highlight: d.highlight, pageHex: d.page, dark });
        for (const p of TOKEN_PAIRS) expect(contrastRatio(pal[p.fg]!, pal[p.bg]!), `${p.what} for ${JSON.stringify(d)}`).toBeGreaterThanOrEqual(p.min);
      }
    }
    expect(allowed).toBeGreaterThan(10);
  });
});
