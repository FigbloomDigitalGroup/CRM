import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BRAND_THEME, THEMES, themesDefaultFirst } from "../../../src/preferences/catalogue";

/**
 * Sky is the default theme everywhere (Given, 10 Nov 2026): the first choice in every picker, the brand default for a member who never chose one
 * (their stored theme is null, so they follow the organisation), and the default of every new organisation. These guards need no database.
 */
describe("Sky is the default theme", () => {
  it("is the brand theme and the first choice in a picker, with every other theme kept", () => {
    expect(BRAND_THEME).toBe("SKY");
    const list = themesDefaultFirst();
    expect(list[0]!.key).toBe("SKY");
    expect(list.map((t) => t.key).sort()).toEqual(THEMES.map((t) => t.key).sort());
    expect(list.findIndex((t) => t.key === "FOREST")).toBeGreaterThan(0);
  });

  it("is the default of a new organisation, and no later migration puts Forest back", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    expect(schema).toMatch(/defaultTheme\s+String\s+@default\("SKY"\)/);
    const memberModel = schema.match(/model UserPreference \{[\s\S]*?\n\}/)![0];
    // Unset (null) follows the organisation's default, so a member who never chose a theme is on Sky too.
    expect(memberModel).toMatch(/theme\s+String\?\s/);
    const migrations = readdirSync("prisma/migrations", { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name >= "20261125090000_sky_default_theme")
      .map((e) => e.name)
      .sort();
    expect(migrations[0]).toBe("20261125090000_sky_default_theme");
    for (const dir of migrations) {
      const sql = readFileSync(`prisma/migrations/${dir}/migration.sql`, "utf8");
      expect(sql, dir).not.toMatch(/default_theme"?\s+SET DEFAULT 'FOREST'/);
      if (dir !== "20261125090000_sky_default_theme") expect(sql, dir).not.toMatch(/SET "?default_theme"?\s*=\s*'FOREST'/);
    }
  });
});
