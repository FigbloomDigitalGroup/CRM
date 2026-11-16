import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isSettingsTabId, SETTINGS_TAB_IDS, settingsHref, settingsPath } from "../src/lib/settingsLinks";

const SRC = join(__dirname, "..", "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("settings links (FIG-1586)", () => {
  it("builds the path and the full link", () => {
    expect(settingsPath("members")).toBe("/settings?tab=members");
    expect(settingsHref("acme", "website")).toBe("/o/acme/settings?tab=website");
    expect(settingsHref("acme", "connect", { connection: "denied" })).toBe("/o/acme/settings?tab=connect&connection=denied");
  });

  it("knows its ids and rejects the rest", () => {
    expect(isSettingsTabId("members")).toBe(true);
    expect(isSettingsTabId("supportaccess")).toBe(false);
    expect(isSettingsTabId(null)).toBe(false);
    expect(new Set(SETTINGS_TAB_IDS).size).toBe(SETTINGS_TAB_IDS.length);
  });

  it("matches the sections the Settings screen really renders", () => {
    const src = readFileSync(join(SRC, "ui/screens/settings/SettingsScreen.tsx"), "utf8");
    const block = src.slice(src.indexOf("export const SETTINGS_TABS"), src.indexOf("];", src.indexOf("export const SETTINGS_TABS")));
    const ids = [...block.matchAll(/\{ id: "([a-z]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual([...SETTINGS_TAB_IDS]);
  });

  it("leaves no hand-written settings link outside the helper", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      if (file.endsWith(join("lib", "settingsLinks.ts"))) continue;
      const text = readFileSync(file, "utf8");
      text.split(/\r?\n/).forEach((line, i) => {
        if (/settings\?tab=|\}\/settings[`"'?]|route: "settings"|listPath: "settings"/.test(line) && !/\/api\/|\/\/|import /.test(line)) offenders.push(`${file}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
