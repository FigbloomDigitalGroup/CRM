import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NotFoundError, ValidationError } from "../src/auth/errors";
import { buildCommands, searchableTypes } from "../src/lib/commandIndex";
import { HELP_ARTICLES, RELEASE_NOTES } from "../src/lib/helpContent";
import { updateFeatureToggles } from "../src/services/featureService";
import { getCommandIndex, getHelpArticle, getWhatsNew, listHelpArticles } from "../src/services/helpService";
import { ACTIONS, GOTO } from "../src/ui/screens/palette/items";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";

/** FIG-1149 (B6.17): command palette index, Help and What's new. Role-based API tests. */

const ORIGINAL_RELEASE = process.env.ACTIVE_RELEASE;
beforeAll(() => {
  process.env.ACTIVE_RELEASE = "v1.1";
});
afterAll(() => {
  if (ORIGINAL_RELEASE === undefined) delete process.env.ACTIVE_RELEASE;
  else process.env.ACTIVE_RELEASE = ORIGINAL_RELEASE;
});

const ROLES = ["MANAGEMENT", "SALES", "DELIVERY", "FINANCE", "RESTRICTED_TECHNICAL"] as const;

async function world() {
  const org = await createTestOrganization("Palette Org");
  const ctx: Record<string, Awaited<ReturnType<typeof createTestContext>>> = {};
  for (const role of ROLES) ctx[role] = await createTestContext(org.id, role);
  return { org, ctx };
}
const idsOf = (r: { commands: { id: string }[] }) => r.commands.map((c) => c.id);

describe("command index (pure)", () => {
  it("lists nothing for a person with no permissions except the pages everyone has", () => {
    const ids = buildCommands({ permissionKeys: [], release: "v1.1", toggles: { "assistant.enabled": true } }).map((c) => c.id);
    expect(ids.sort()).toEqual(["go-dashboard", "go-preferences", "help"]);
  });

  it("holds back V1.1 commands in V1 and the assistant when its switch is off", () => {
    const keys = ["ai.use", "forecast.view.all"];
    expect(buildCommands({ permissionKeys: keys, release: "v1", toggles: { "assistant.enabled": true } }).map((c) => c.id)).not.toContain("go-forecast");
    expect(buildCommands({ permissionKeys: keys, release: "v1.1", toggles: { "assistant.enabled": false } }).map((c) => c.id)).not.toContain("ask");
    expect(buildCommands({ permissionKeys: keys, release: "v1.1", toggles: { "assistant.enabled": true } }).map((c) => c.id)).toEqual(expect.arrayContaining(["ask", "go-forecast"]));
  });

  it("searches only the record kinds the keys open", () => {
    expect(searchableTypes(["contacts.view", "deals.view.won"])).toEqual(["contacts", "deals"]);
    expect(searchableTypes([])).toEqual([]);
  });
});

describe("command palette API by role", () => {
  it("lists exactly the pages and actions each role may use, in step with the screen's own list", async () => {
    const { ctx } = await world();
    for (const role of ROLES) {
      const c = ctx[role]!;
      const ids = idsOf(await getCommandIndex(c));
      for (const g of GOTO) expect(ids.includes(`go-${g.id}`), `${role} go-${g.id}`).toBe(g.allowed(c.permissionKeys));
      for (const a of ACTIONS.filter((x) => x.id !== "ask" && x.id !== "help")) expect(ids.includes(a.id), `${role} ${a.id}`).toBe(a.allowed(c.permissionKeys));
      expect(ids).toContain("help");
    }
  });

  it("matches what each role can do", async () => {
    const { ctx } = await world();
    // Ask Figbloom is off until the organisation switches it on (decision: the toggle defaults to off).
    expect(idsOf(await getCommandIndex(ctx.SALES!))).not.toContain("ask");
    await updateFeatureToggles(ctx.MANAGEMENT!, { "assistant.enabled": true });
    const m = idsOf(await getCommandIndex(ctx.MANAGEMENT!));
    expect(m).toEqual(expect.arrayContaining(["new-lead", "go-settings", "go-payments", "go-forecast", "ask"]));
    const s = idsOf(await getCommandIndex(ctx.SALES!));
    expect(s).toEqual(expect.arrayContaining(["new-lead", "go-leads", "go-forecast", "ask"]));
    expect(s).not.toEqual(expect.arrayContaining(["go-settings"]));
    expect(s).not.toContain("go-payments");
    const d = idsOf(await getCommandIndex(ctx.DELIVERY!));
    expect(d).toContain("go-deals");
    expect(d).not.toEqual(expect.arrayContaining(["new-lead"]));
    expect(d).not.toContain("go-leads");
    expect(d).not.toContain("go-forecast");
    const f = idsOf(await getCommandIndex(ctx.FINANCE!));
    expect(f).toContain("go-payments");
    expect(f).not.toContain("new-lead");
    const t = await getCommandIndex(ctx.RESTRICTED_TECHNICAL!);
    expect(idsOf(t)).not.toEqual(expect.arrayContaining(["go-companies"]));
    expect(idsOf(t)).not.toContain("ask");
    expect(idsOf(t)).not.toContain("go-settings");
    expect(t.search.types).toEqual(["tasks"]);
    expect((await getCommandIndex(ctx.SALES!)).search.types).toEqual(["companies", "contacts", "leads", "deals", "tasks"]);
    expect((await getCommandIndex(ctx.DELIVERY!)).search.types).toEqual(["companies", "contacts", "deals", "tasks"]);
    // Shortcuts are listed only for commands the role has.
    const keys = (await getCommandIndex(ctx.DELIVERY!)).shortcuts.map((x) => x.keys);
    expect(keys).toContain("G D");
    expect(keys).not.toContain("N");
    expect(keys).not.toContain("G L");
  });

  it("never carries a path for a command the role cannot open (a path appears only with its command)", async () => {
    const { ctx } = await world();
    for (const role of ROLES) {
      const index = await getCommandIndex(ctx[role]!);
      for (const c of index.commands) expect(c.path === null || typeof c.path === "string").toBe(true);
      expect(index.commands.filter((c) => c.kind === "navigate").every((c) => c.path !== null)).toBe(true);
    }
  });

  it("drops Ask Figbloom when the organisation switches the assistant off, for that organisation only", async () => {
    const a = await world();
    const b = await world();
    await updateFeatureToggles(a.ctx.MANAGEMENT!, { "assistant.enabled": true });
    await updateFeatureToggles(b.ctx.MANAGEMENT!, { "assistant.enabled": true });
    expect(idsOf(await getCommandIndex(a.ctx.SALES!))).toContain("ask");
    await updateFeatureToggles(a.ctx.MANAGEMENT!, { "assistant.enabled": false });
    expect(idsOf(await getCommandIndex(a.ctx.SALES!))).not.toContain("ask");
    expect(idsOf(await getCommandIndex(a.ctx.MANAGEMENT!))).not.toContain("ask");
    expect(idsOf(await getCommandIndex(b.ctx.SALES!))).toContain("ask");
  });

  it("is unavailable while the release is V1", async () => {
    const { ctx } = await world();
    process.env.ACTIVE_RELEASE = "v1";
    try {
      await expect(getCommandIndex(ctx.SALES!)).rejects.toMatchObject({ name: "FeatureUnavailableError" });
      await expect(listHelpArticles(ctx.SALES!)).rejects.toMatchObject({ name: "FeatureUnavailableError" });
      await expect(getWhatsNew(ctx.SALES!)).rejects.toMatchObject({ name: "FeatureUnavailableError" });
    } finally {
      process.env.ACTIVE_RELEASE = "v1.1";
    }
  });
});

describe("Help API by role", () => {
  it("indexes only the articles written for what the role can do", async () => {
    const { ctx } = await world();
    const slugs = async (role: string) => (await listHelpArticles(ctx[role]!)).items.map((i) => i.slug);
    const sales = await slugs("SALES");
    expect(sales).toEqual(expect.arrayContaining(["getting-started", "leads-basics", "deals-and-stages", "saved-views", "forecast"]));
    expect(sales).not.toEqual(expect.arrayContaining(["payments"]));
    expect(sales).not.toEqual(expect.arrayContaining(["settings-overview"]));
    expect(await slugs("FINANCE")).toContain("payments");
    expect(await slugs("MANAGEMENT")).toEqual(expect.arrayContaining(["payments", "settings-overview", "forecast", "assistant"]));
    const tech = await slugs("RESTRICTED_TECHNICAL");
    expect(tech).toEqual(expect.arrayContaining(["getting-started", "tasks-and-calendar", "saved-views"]));
    for (const hidden of ["leads-basics", "deals-and-stages", "payments", "settings-overview", "reports", "assistant", "forecast"]) expect(tech).not.toContain(hidden);
    // Every article is reachable by at least one role, and none is offered to a role it was not written for.
    for (const role of ROLES) {
      for (const slug of await slugs(role)) {
        const article = HELP_ARTICLES.find((a) => a.slug === slug)!;
        expect(!article.requiresAny || article.requiresAny.some((k) => ctx[role]!.permissionKeys.includes(k))).toBe(true);
      }
    }
  });

  it("answers 404 for an article the role cannot see, the same as one that does not exist", async () => {
    const { ctx } = await world();
    await expect(getHelpArticle(ctx.SALES!, "payments")).rejects.toBeInstanceOf(NotFoundError);
    await expect(getHelpArticle(ctx.SALES!, "no-such-article")).rejects.toBeInstanceOf(NotFoundError);
    expect(await getHelpArticle(ctx.FINANCE!, "payments")).toMatchObject({ slug: "payments", body: expect.any(Array) });
  });

  it("searches, filters by area and returns page tips", async () => {
    const { ctx } = await world();
    expect((await listHelpArticles(ctx.MANAGEMENT!, { q: "INVOICE" })).items.map((i) => i.slug)).toContain("payments");
    expect((await listHelpArticles(ctx.SALES!, { q: "invoice" })).items).toEqual([]);
    expect((await listHelpArticles(ctx.SALES!, { area: "leads" })).items.map((i) => i.slug)).toEqual(["leads-basics"]);
    const r = await listHelpArticles(ctx.SALES!, { page: "leads" });
    expect(r.tips?.title).toBe("Leads");
    expect((await listHelpArticles(ctx.SALES!)).tips).toBeNull();
    await expect(listHelpArticles(ctx.SALES!, { page: "nope" })).rejects.toBeInstanceOf(ValidationError);
    await expect(listHelpArticles(ctx.SALES!, { q: "x".repeat(101) })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("What's new feed", () => {
  it("shows notes for the release and for features the role can use, newest first", async () => {
    const { ctx } = await world();
    const sales = await getWhatsNew(ctx.SALES!);
    expect(sales.release).toBe("v1.1");
    const ids = sales.items.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(["v11-ask", "v11-saved-views", "v11-forecast", "v1-masking"]));
    expect(ids).not.toContain("v11-forms-sequences");
    expect(ids).not.toContain("v2-api");
    const dates = sales.items.map((i) => i.date);
    expect([...dates].sort().reverse()).toEqual(dates);
    const mgmt = (await getWhatsNew(ctx.MANAGEMENT!)).items.map((i) => i.id);
    expect(mgmt).toContain("v11-forms-sequences");
    const tech = (await getWhatsNew(ctx.RESTRICTED_TECHNICAL!)).items.map((i) => i.id);
    expect(tech).not.toContain("v11-ask");
    expect(tech).toContain("v11-saved-views");
  });

  it("filters by date, limits, validates, and shows V2 notes only when the release is V2", async () => {
    const { ctx } = await world();
    expect((await getWhatsNew(ctx.SALES!, { since: "2026-11-10" })).items.every((i) => i.date > "2026-11-10")).toBe(true);
    expect((await getWhatsNew(ctx.SALES!, { limit: 1 })).items).toHaveLength(1);
    await expect(getWhatsNew(ctx.SALES!, { since: "yesterday" })).rejects.toBeInstanceOf(ValidationError);
    await expect(getWhatsNew(ctx.SALES!, { limit: 0 })).rejects.toBeInstanceOf(ValidationError);
    process.env.ACTIVE_RELEASE = "v2";
    try {
      // Permission keys are resolved per release, so people are looked up again under V2.
      const v2 = await world();
      expect((await getWhatsNew(v2.ctx.MANAGEMENT!)).items.map((i) => i.id)).toContain("v2-api");
      expect((await getWhatsNew(v2.ctx.SALES!)).items.map((i) => i.id)).not.toContain("v2-api");
    } finally {
      process.env.ACTIVE_RELEASE = "v1.1";
    }
    expect(RELEASE_NOTES.every((n) => n.date.match(/^\d{4}-\d{2}-\d{2}$/))).toBe(true);
  });

  it("carries no record, value or person: only the written content", async () => {
    const { ctx } = await world();
    const text = JSON.stringify([await getCommandIndex(ctx.SALES!), await listHelpArticles(ctx.SALES!), await getWhatsNew(ctx.SALES!)]);
    expect(text).not.toContain(ctx.SALES!.membershipId);
    expect(text).not.toContain(ctx.SALES!.organizationId);
  });
});
