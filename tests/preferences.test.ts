import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../src/auth/context";
import { ForbiddenError, ValidationError } from "../src/auth/errors";
import { createPlatformCookieValue, DEV_PLATFORM_COOKIE_NAME } from "../src/auth/devSession";
import { adminDb } from "../src/db/adminClient";
import { getUnscopedAppClientForTests, withOrgContext } from "../src/db/orgScopedClient";
import { FeatureUnavailableError } from "../src/lib/featureFlags";
import { resolveActiveMembership } from "../src/repositories/memberships";
import { contrastRatio, bestTextOn } from "../src/preferences/contrast";
import { THEMES, PAGE_COLOURS } from "../src/preferences/catalogue";
import { setOrganizationRelease } from "../src/services/featureService";
import { updateOrganizationLook } from "../src/services/organizationLookService";
import * as platformPrefs from "../src/services/platformPreferenceService";
import * as prefs from "../src/services/preferenceService";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";

const current: { ctx: AuthContext | null } = { ctx: null };
vi.mock("../src/auth/requestContext", () => ({
  resolveRequestContext: async () => {
    if (!current.ctx) {
      const { UnauthorizedError } = await import("../src/auth/errors");
      throw new UnauthorizedError();
    }
    return current.ctx;
  },
}));
const cookieJar: { value: string | undefined } = { value: undefined };
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.value && name === DEV_PLATFORM_COOKIE_NAME ? { value: cookieJar.value } : undefined),
  }),
}));

import * as prefsRoute from "../src/app/api/orgs/[orgSlug]/me/preferences/route";
import * as resetRoute from "../src/app/api/orgs/[orgSlug]/me/preferences/reset/route";
import * as undoRoute from "../src/app/api/orgs/[orgSlug]/me/preferences/undo/route";
import * as platformRoute from "../src/app/api/platform/preferences/route";

const params = { params: Promise.resolve({ orgSlug: "x" }) };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  cookieJar.value = undefined;
});

async function setup() {
  const org = await createTestOrganization("Prefs");
  await setOrganizationRelease(org.id, "v1.1");
  const mgmt = await createTestContext(org.id, "MANAGEMENT", "pf.mgmt");
  const sales = await createTestContext(org.id, "SALES", "pf.sales");
  const finance = await createTestContext(org.id, "FINANCE", "pf.fin");
  return { org, mgmt, sales, finance };
}

async function issues(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ValidationError);
    return (err as ValidationError).issues ?? [];
  }
  throw new Error("Expected a validation error.");
}

describe("the catalogue", () => {
  it("ships ten themes and eleven page colours, and every theme is readable", () => {
    expect(THEMES).toHaveLength(10);
    expect(PAGE_COLOURS).toHaveLength(11);
    for (const t of THEMES) {
      expect(bestTextOn(t.sidebar).ratio, `${t.key} sidebar`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.accent, "#FFFFFF"), `${t.key} accent on white`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio("#111827", t.highlight), `${t.key} highlight`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("reading and following the organisation's look", () => {
  it("a member with no saved choices follows the organisation's default", async () => {
    const { mgmt, sales } = await setup();
    await updateOrganizationLook(mgmt, { defaultTheme: "OCEAN", defaultPageColour: "MINT" });
    const view = await prefs.getMyPreferences(sales);
    expect(view.appearance.theme).toBeNull();
    expect(view.appearance.effective).toMatchObject({ source: "organisation", theme: "OCEAN", pageColour: "MINT", locked: false });
    expect(view.appearance.effective.colours.sidebar).toBe("#14365C");
    expect(view.appearance.organisationDefault).toEqual({ theme: "OCEAN", pageColour: "MINT" });
  });

  it("saving only a density does not pin the brand colours", async () => {
    const { mgmt, sales } = await setup();
    await prefs.updateMyPreferences(sales, { density: "COMPACT" });
    await updateOrganizationLook(mgmt, { defaultTheme: "TEAL" });
    const view = await prefs.getMyPreferences(sales);
    expect(view.appearance.density).toBe("COMPACT");
    expect(view.appearance.effective).toMatchObject({ source: "organisation", theme: "TEAL" });
  });

  it("an own choice wins over the organisation's default", async () => {
    const { mgmt, sales } = await setup();
    await updateOrganizationLook(mgmt, { defaultTheme: "OCEAN" });
    const view = await prefs.updateMyPreferences(sales, { theme: "ROSEWOOD", pageColour: "BLUSH" });
    expect(view.appearance.effective).toMatchObject({ source: "own", theme: "ROSEWOOD", pageColour: "BLUSH" });
    expect(view.appearance.effective.colours.page.hex).toBe("#FAF1F1");
    expect(view.ignored).toEqual([]);
  });

  it("returns the same shape for every role", async () => {
    const org = await createTestOrganization("PrefShape");
    const shapes: string[] = [];
    for (const role of ["MANAGEMENT", "SALES", "DELIVERY", "FINANCE", "RESTRICTED_TECHNICAL", "CUSTOMER_SUPPORT"]) {
      const ctx = await createTestContext(org.id, role, `shape.${role.toLowerCase()}`);
      current.ctx = ctx;
      const res = await prefsRoute.GET(new Request("http://x"), params);
      expect(res.status, role).toBe(200);
      shapes.push(JSON.stringify(Object.keys(await res.json())));
    }
    expect(new Set(shapes).size).toBe(1);
  });
});

describe("saving choices", () => {
  it("validates every field and says what is allowed", async () => {
    const { sales } = await setup();
    const found = await issues(
      prefs.updateMyPreferences(sales, {
        theme: "NEON",
        pageColour: "PURPLE",
        density: "TINY",
        hourFormat: "H48",
        firstDayOfWeek: "TUE",
        dateFormat: "ISO",
      }),
    );
    expect(found.map((i) => i.path).sort()).toEqual(["dateFormat", "density", "firstDayOfWeek", "hourFormat", "pageColour", "theme"]);
    expect(found.find((i) => i.path === "theme")!.message).toContain("FOREST");
    expect((await prefs.getMyPreferences(sales)).appearance.theme).toBeNull();
  });

  it("keeps the light/dark pair on the right sides", async () => {
    const { sales } = await setup();
    const ok = await prefs.updateMyPreferences(sales, { toggle: { light: "WARM_SAND", dark: "NAVY_NIGHT" } });
    expect(ok.appearance.toggle).toEqual({ light: "WARM_SAND", dark: "NAVY_NIGHT" });
    const bad = await issues(prefs.updateMyPreferences(sales, { toggle: { light: "BLACK", dark: "WHITE" } }));
    expect(bad.map((i) => i.path).sort()).toEqual(["toggle.dark", "toggle.light"]);
    const device = await issues(prefs.updateMyPreferences(sales, { toggle: { light: "MATCH_DEVICE" } }));
    expect(device[0]!.path).toBe("toggle.light");
  });

  it("saves regional choices and audits the change", async () => {
    const { sales, org } = await setup();
    const view = await prefs.updateMyPreferences(sales, { hourFormat: "H24", firstDayOfWeek: "SUN", dateFormat: "YMD" });
    expect(view.regional).toMatchObject({ hourFormat: "H24", firstDayOfWeek: "SUN", dateFormat: "YMD" });
    const events = await adminDb.auditEvent.findMany({
      where: { organizationId: org.id, action: "preferences.updated", entityId: sales.membershipId },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.newValue).toMatchObject({ hourFormat: "H24", dateFormat: "YMD" });
    // Saving the same thing again changes nothing and writes nothing.
    await prefs.updateMyPreferences(sales, { hourFormat: "H24" });
    expect(await adminDb.auditEvent.count({ where: { organizationId: org.id, action: "preferences.updated" } })).toBe(1);
  });

  it("refuses device-only settings with the reason, and saves nothing", async () => {
    const { sales } = await setup();
    const found = await issues(prefs.updateMyPreferences(sales, { textSize: "LARGE", bold: true, density: "COMPACT" }));
    expect(found.map((i) => i.code)).toEqual(["DEVICE_ONLY_SETTING", "DEVICE_ONLY_SETTING"]);
    expect(found[0]!.message).toContain("saved on this device");
    const view = await prefs.getMyPreferences(sales);
    expect(view.appearance.density).toBe("COMFORTABLE");
    expect(view.deviceOnly).toMatchObject({ textSize: "DEFAULT", bold: false, higherContrast: false, reduceMotion: false, storedOn: "device" });
  });

  it("rejects unknown fields at the route and returns the new state", async () => {
    const { sales } = await setup();
    current.ctx = sales;
    const bad = await prefsRoute.PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ wallpaper: "x" }) }), params);
    expect(bad.status).toBe(400);
    const device = await prefsRoute.PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ reduceMotion: true }) }), params);
    expect(device.status).toBe(400);
    expect((await device.json()).fieldErrors[0].code).toBe("DEVICE_ONLY_SETTING");
    const ok = await prefsRoute.PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ theme: "SKY" }) }), params);
    expect((await ok.json()).appearance.theme).toBe("SKY");
  });
});

describe("start page and sidebar", () => {
  it("offers only pages the role can open", async () => {
    const { sales, finance } = await setup();
    const salesKeys = (await prefs.getMyPreferences(sales)).startPage.options.map((o) => o.key);
    const financeKeys = (await prefs.getMyPreferences(finance)).startPage.options.map((o) => o.key);
    expect(salesKeys).toContain("leads");
    expect(financeKeys).not.toContain("leads");
    expect(financeKeys).toContain("dashboard");

    const set = await prefs.updateMyPreferences(sales, { startPage: "leads" });
    expect(set.startPage).toMatchObject({ key: "leads", unavailable: false });
    const denied = await issues(prefs.updateMyPreferences(finance, { startPage: "leads" }));
    expect(denied[0]).toMatchObject({ path: "startPage", code: "START_PAGE_NOT_AVAILABLE" });
    expect(denied[0]!.message).toContain("not available to your role");
    const unknown = await issues(prefs.updateMyPreferences(sales, { startPage: "nonsense" }));
    expect(unknown[0]!.path).toBe("startPage");
    const cleared = await prefs.updateMyPreferences(sales, { startPage: null });
    expect(cleared.startPage.key).toBeNull();
  });

  it("falls back to the dashboard when a role change retires the saved start page", async () => {
    const { sales, org } = await setup();
    await prefs.updateMyPreferences(sales, { startPage: "leads" });
    const finance = await adminDb.role.findUniqueOrThrow({ where: { key: "FINANCE" } });
    await adminDb.membership.update({ where: { id: sales.membershipId }, data: { roleId: finance.id } });
    const asFinance = (await resolveActiveMembership(sales.userId, org.id))!;
    const view = await prefs.getMyPreferences(asFinance);
    expect(view.startPage).toMatchObject({ key: null, unavailable: true });
  });

  it("stores the sidebar and rejects what cannot be hidden", async () => {
    const { sales } = await setup();
    const ok = await prefs.updateMyPreferences(sales, { sidebar: { collapsed: true, hidden: ["reports", "reports"] } });
    expect(ok.sidebar).toEqual({ collapsed: true, hidden: ["reports"] });
    expect((await issues(prefs.updateMyPreferences(sales, { sidebar: { hidden: ["dashboard"] } })))[0]!.message).toContain("dashboard");
    expect((await issues(prefs.updateMyPreferences(sales, { sidebar: { hidden: ["settings"] } })))[0]!.message).toContain("not in your sidebar");
    // The failed attempts did not disturb what was saved.
    expect((await prefs.getMyPreferences(sales)).sidebar).toEqual({ collapsed: true, hidden: ["reports"] });
  });
});

describe("personalisation switched off by the organisation", () => {
  it("ignores look choices, reports them, still saves the rest, and restores them when switched on", async () => {
    const { mgmt, sales, org } = await setup();
    await prefs.updateMyPreferences(sales, { theme: "AUBERGINE" });
    await updateOrganizationLook(mgmt, { defaultTheme: "OCEAN", allowPersonalisation: false });

    const view = await prefs.updateMyPreferences(sales, { theme: "SAND", pageColour: "MINT", density: "COMPACT" });
    expect(view.ignored.sort()).toEqual(["pageColour", "theme"]);
    expect(view.personalisation).toMatchObject({ allowed: false, locked: true });
    expect(view.appearance.effective).toMatchObject({ source: "organisation", theme: "OCEAN", locked: true });
    expect(view.appearance.density).toBe("COMPACT");

    await updateOrganizationLook(mgmt, { allowPersonalisation: true });
    const back = await prefs.getMyPreferences(sales);
    expect(back.appearance.effective).toMatchObject({ source: "own", theme: "AUBERGINE" });

    const toggles = await adminDb.auditEvent.findMany({
      where: { organizationId: org.id, action: "feature_toggle.changed", entityId: "personalisation.allowed" },
    });
    expect(toggles).toHaveLength(2);
  });
});

describe("own colours", () => {
  it("accepts readable colours and uses them in the effective look", async () => {
    const { sales } = await setup();
    const view = await prefs.updateMyPreferences(sales, {
      ownColours: { sidebar: "#1B2A4A", accent: "#0B5FA5", highlight: "#e6f0fa", page: "#fafafa" },
    });
    expect(view.appearance.ownColours).toEqual({ sidebar: "#1B2A4A", accent: "#0B5FA5", highlight: "#E6F0FA", page: "#FAFAFA" });
    expect(view.appearance.effective.colours).toMatchObject({ sidebar: "#1B2A4A", accent: "#0B5FA5", page: { hex: "#FAFAFA" } });
    expect(view.appearance.effective.source).toBe("own");
  });

  it("refuses unreadable colours and says why, with the ratio", async () => {
    const { sales } = await setup();
    const found = await issues(prefs.updateMyPreferences(sales, { ownColours: { accent: "#FFEB3B", sidebar: "#7F7F7F" } }));
    const accent = found.find((i) => i.path === "ownColours.accent")!;
    expect(accent.code).toBe("COLOUR_LOW_CONTRAST");
    expect(accent.message).toMatch(/contrast of \d+(\.\d+)?:1/);
    expect(accent.message).toContain("4.5:1");
    const bad = await issues(prefs.updateMyPreferences(sales, { ownColours: { accent: "green" } }));
    expect(bad[0]).toMatchObject({ path: "ownColours.accent", code: "COLOUR_INVALID" });
    expect((await prefs.getMyPreferences(sales)).appearance.ownColours).toBeNull();
  });

  it("judges colours against the page colour the member has chosen", async () => {
    const { sales } = await setup();
    // A pale accent is fine on black, not on white.
    await prefs.updateMyPreferences(sales, { pageColour: "BLACK" });
    const ok = await prefs.updateMyPreferences(sales, { ownColours: { accent: "#8FD3FF" } });
    expect(ok.appearance.ownColours).toEqual({ accent: "#8FD3FF" });
    await prefs.updateMyPreferences(sales, { ownColours: null });
    await prefs.updateMyPreferences(sales, { pageColour: "WHITE" });
    expect((await issues(prefs.updateMyPreferences(sales, { ownColours: { accent: "#8FD3FF" } })))[0]!.code).toBe("COLOUR_LOW_CONTRAST");
  });

  it("is a V1.1 feature: writing is refused before it, clearing is always allowed", async () => {
    const { sales, org } = await setup();
    await prefs.updateMyPreferences(sales, { ownColours: { accent: "#0B5FA5" } });
    await setOrganizationRelease(org.id, "v1");
    await expect(prefs.updateMyPreferences(sales, { ownColours: { accent: "#0B5FA5" } })).rejects.toBeInstanceOf(FeatureUnavailableError);
    const view = await prefs.getMyPreferences(sales);
    expect(view.personalisation.ownColoursAvailable).toBe(false);
    // Stored colours are not applied while the release is behind.
    expect(view.appearance.effective.ownColours).toBeNull();
    const cleared = await prefs.updateMyPreferences(sales, { ownColours: null });
    expect(cleared.appearance.ownColours).toBeNull();
  });
});

describe("reset and undo", () => {
  async function customised(sales: AuthContext) {
    await prefs.updateMyPreferences(sales, {
      theme: "ROSEWOOD",
      pageColour: "BLACK",
      toggle: { light: "MINT", dark: "BLACK" },
      density: "COMPACT",
      startPage: "leads",
      hourFormat: "H24",
      ownColours: { accent: "#8FD3FF" },
    });
  }

  it("goes back to Forest on White exactly, keeping start page and date/time choices", async () => {
    const { sales, mgmt, org } = await setup();
    await updateOrganizationLook(mgmt, { defaultTheme: "OCEAN" });
    await customised(sales);
    const { preferences, undo } = await prefs.resetMyAppearance(sales);
    expect(preferences.appearance).toMatchObject({
      theme: "FOREST",
      pageColour: "WHITE",
      toggle: { light: "WHITE", dark: "DARK" },
      density: "COMFORTABLE",
      ownColours: null,
    });
    expect(preferences.appearance.effective.colours).toMatchObject({ sidebar: "#203E2A", accent: "#275B3A", page: { hex: "#FAF9F7" } });
    expect(preferences.startPage.key).toBe("leads");
    expect(preferences.regional.hourFormat).toBe("H24");
    expect(undo.expiresInSeconds).toBe(600);
    expect(preferences.undoAvailable).toBe(true);
    expect(await adminDb.auditEvent.count({ where: { organizationId: org.id, action: "preferences.reset" } })).toBe(1);
  });

  it("undoes once, with the token, and restores what was there", async () => {
    const { sales } = await setup();
    await customised(sales);
    const { undo } = await prefs.resetMyAppearance(sales);
    const wrong = await issues(prefs.undoMyReset(sales, "not-the-token"));
    expect(wrong[0]!.code).toBe("UNDO_EXPIRED");

    const restored = await prefs.undoMyReset(sales, undo.token);
    expect(restored.appearance).toMatchObject({ theme: "ROSEWOOD", pageColour: "BLACK", density: "COMPACT", ownColours: { accent: "#8FD3FF" } });
    expect(restored.appearance.toggle).toEqual({ light: "MINT", dark: "BLACK" });
    expect(restored.undoAvailable).toBe(false);
    expect((await issues(prefs.undoMyReset(sales, undo.token)))[0]!.code).toBe("UNDO_EXPIRED");
  });

  it("undo for a member who had never chosen anything returns them to the organisation's look", async () => {
    const { sales, mgmt } = await setup();
    await updateOrganizationLook(mgmt, { defaultTheme: "OCEAN" });
    const { undo } = await prefs.resetMyAppearance(sales);
    const restored = await prefs.undoMyReset(sales, undo.token);
    expect(restored.appearance.theme).toBeNull();
    expect(restored.appearance.effective).toMatchObject({ source: "organisation", theme: "OCEAN" });
  });

  it("expires after ten minutes", async () => {
    const { sales } = await setup();
    await customised(sales);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-23T10:00:00Z"));
    const { undo } = await prefs.resetMyAppearance(sales);
    vi.setSystemTime(new Date("2026-10-23T10:09:59Z"));
    expect((await prefs.getMyPreferences(sales)).undoAvailable).toBe(true);
    vi.setSystemTime(new Date("2026-10-23T10:10:01Z"));
    expect((await prefs.getMyPreferences(sales)).undoAvailable).toBe(false);
    expect((await issues(prefs.undoMyReset(sales, undo.token)))[0]!.code).toBe("UNDO_EXPIRED");
  });

  it("a later look change makes the undo stale, and nobody else can use it", async () => {
    const { sales, finance } = await setup();
    await customised(sales);
    const { undo } = await prefs.resetMyAppearance(sales);
    await expect(prefs.undoMyReset(finance, undo.token)).rejects.toBeInstanceOf(ValidationError);
    await prefs.updateMyPreferences(sales, { theme: "SKY" });
    expect((await issues(prefs.undoMyReset(sales, undo.token)))[0]!.code).toBe("UNDO_EXPIRED");
    expect((await prefs.getMyPreferences(sales)).appearance.theme).toBe("SKY");
  });

  it("when personalisation is off, reset leaves theme and page colour following the organisation", async () => {
    const { sales, mgmt } = await setup();
    await updateOrganizationLook(mgmt, { defaultTheme: "OCEAN", allowPersonalisation: false });
    const { preferences } = await prefs.resetMyAppearance(sales);
    expect(preferences.appearance.theme).toBeNull();
    expect(preferences.appearance.effective).toMatchObject({ theme: "OCEAN", locked: true });
  });

  it("serves reset and undo through the routes", async () => {
    const { sales } = await setup();
    current.ctx = sales;
    await prefs.updateMyPreferences(sales, { theme: "SAND" });
    const reset = await resetRoute.POST(new Request("http://x", { method: "POST" }), params);
    expect(reset.status).toBe(200);
    const body = await reset.json();
    expect(body.preferences.appearance.theme).toBe("FOREST");
    const undo = await undoRoute.POST(new Request("http://x", { method: "POST", body: JSON.stringify({ token: body.undo.token }) }), params);
    expect(undo.status).toBe(200);
    expect((await undo.json()).appearance.theme).toBe("SAND");
    const missing = await undoRoute.POST(new Request("http://x", { method: "POST", body: JSON.stringify({}) }), params);
    expect(missing.status).toBe(400);
  });
});

describe("tenant isolation", () => {
  it("preferences are invisible across organisations and without a context", async () => {
    const a = await setup();
    const b = await setup();
    await prefs.updateMyPreferences(a.sales, { theme: "SAND" });
    const seenFromB = await withOrgContext(b.org.id, (tx) => tx.userPreference.findMany({ where: { membershipId: a.sales.membershipId } }));
    expect(seenFromB).toEqual([]);
    const bare = getUnscopedAppClientForTests();
    expect(await bare.userPreference.findMany()).toEqual([]);
    // Another organisation's context cannot write a row for a membership that is not its own.
    await expect(
      withOrgContext(b.org.id, (tx) =>
        tx.userPreference.create({ data: { organizationId: b.org.id, membershipId: a.sales.membershipId } }),
      ),
    ).rejects.toThrow();
  });
});

describe("Platform Super Admin preferences", () => {
  // The dev-account tests assert on the dev rows that exist, so these are removed again.
  const created: string[] = [];
  afterEach(async () => {
    await adminDb.platformIdentity.deleteMany({ where: { id: { in: created.splice(0) } } });
  });
  async function identity() {
    const row = await adminDb.platformIdentity.create({
      data: { email: `pf.${Math.random().toString(36).slice(2)}@platform.test`, name: "Platform Dev", isDev: true },
    });
    created.push(row.id);
    return row;
  }

  it("is limited to light or dark, with the reason for everything else", async () => {
    const id = await identity();
    expect((await platformPrefs.getPlatformPreferences(id.id)).uiMode).toBe("LIGHT");
    const set = await platformPrefs.updatePlatformPreferences(id.id, { uiMode: "DARK" });
    expect(set.uiMode).toBe("DARK");
    const found = await issues(platformPrefs.updatePlatformPreferences(id.id, { theme: "OCEAN", startPage: "leads", textSize: "LARGE" }));
    expect(found.map((i) => i.code).sort()).toEqual(["DEVICE_ONLY_SETTING", "PLATFORM_PREFERENCE_NOT_AVAILABLE", "PLATFORM_PREFERENCE_NOT_AVAILABLE"]);
    expect(found.find((i) => i.path === "theme")!.message).toContain("light or dark");
    await issues(platformPrefs.updatePlatformPreferences(id.id, { uiMode: "SEPIA" }));
    expect((await platformPrefs.getPlatformPreferences(id.id)).uiMode).toBe("DARK");
  });

  it("is a 404 without a dev platform session, and works with one in development", async () => {
    const none = await platformRoute.GET();
    expect(none.status).toBe(404);

    const id = await identity();
    cookieJar.value = createPlatformCookieValue(id.id);
    // Outside development a leftover cookie is not honoured.
    expect((await platformRoute.GET()).status).toBe(404);

    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_DEV_ACCOUNTS", "true");
    const ok = await platformRoute.GET();
    expect(ok.status).toBe(200);
    const patched = await platformRoute.PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify({ uiMode: "DARK" }) }));
    expect((await patched.json()).uiMode).toBe("DARK");
  });

  it("a tenant member context cannot be built from a platform identity", async () => {
    const id = await identity();
    expect(await resolveActiveMembership(id.id, "00000000-0000-0000-0000-000000000000")).toBeNull();
    void ForbiddenError;
  });
});
