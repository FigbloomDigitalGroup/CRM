/**
 * G3.01 independent security review (FIG-1191), custom roles (FIG-1188): can a role the organisation builds reach payments, margin, audit or
 * bulk export, or the deal value it was told to hide? A crawl calls every parameterless GET route of the organisation as the role and looks
 * for planted values. A passing test shows a defence holds. A test marked `it.fails` is a confirmed gap, written up in
 * docs/M17_SECURITY_REVIEW_G3_01.md.
 */
import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../src/auth/context";
import { adminDb } from "../src/db/adminClient";

const current: { ctx: AuthContext | null } = { ctx: null };
vi.mock("../src/auth/requestContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/auth/requestContext")>();
  return {
    ...actual,
    resolveRequestContext: async () => {
      if (!current.ctx) {
        const { UnauthorizedError } = await import("../src/auth/errors");
        throw new UnauthorizedError();
      }
      return current.ctx;
    },
  };
});
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [] }), headers: async () => new Headers() }));

import { API_SCOPES } from "../src/auth/apiToken";
import { grantableKeys } from "../src/lib/roleLimits";
import { resolveActiveMembership } from "../src/repositories/memberships";
import { createApiToken } from "../src/services/apiTokenService";
import { createDeal } from "../src/services/dealService";
import { createInvoice, markInvoiceSent, recordPayment } from "../src/services/paymentService";
import { createCatalogueEntry } from "../src/services/catalogueService";
import { createQuote } from "../src/services/quoteService";
import { createRole } from "../src/services/roleEditorService";
import { changeMemberRole } from "../src/services/membershipService";
import { GET as listContactsRoute } from "../src/app/api/v1/contacts/route";
import { commercialWorld } from "./commercialFixtures";
import { createTestMembership } from "./helpers/fixtures";
import { createWonDeal } from "./helpers/stage3";
import { getReport, getReports } from "../src/services/reportsV2Service";
import { apiRequest } from "./helpers/laneC";
import { discoverRoutes, fillParams, invoke, isOrganisationRoute } from "./helpers/routeHarness";

const DEAL_VALUE = "5400007";
const INVOICE = "3141592";
const PAYMENT = "2718281";
const COST = "7000013"; // the catalogue cost of the planted product (its price is 9000011)

async function setRelease(orgId: string, release: "v1.1" | "v2") {
  await adminDb.organizationSetting.upsert({
    where: { organizationId_key: { organizationId: orgId, key: "release_override" } },
    update: { value: { release } },
    create: { organizationId: orgId, key: "release_override", value: { release } },
  });
}

async function holderOf(orgId: string, roleId: string, prefix: string) {
  const { user, membership } = await createTestMembership(orgId, "SALES", prefix);
  await adminDb.membership.update({ where: { id: membership.id }, data: { roleId } });
  return (await resolveActiveMembership(user.id, orgId))!;
}

async function plantedWorld() {
  const base = await commercialWorld();
  await setRelease(base.org.id, "v2");
  // Contexts are resolved against the release: resolve them again now that the organisation is on V2 (roles.manage is a V2 key).
  const again = async (c: AuthContext) => (await resolveActiveMembership(c.userId, c.organizationId))!;
  const w = { ...base, management: await again(base.management), sales: await again(base.sales), salesTwo: await again(base.salesTwo), finance: await again(base.finance) };
  const deal = (await createDeal(w.management, { companyId: w.company.id, pipelineStageId: w.stageId, value: DEAL_VALUE })) as { id: string };
  const costly = await createCatalogueEntry(w.management, { name: "Planted product", price: 9000011, cost: Number(COST) });
  const { quote } = await createQuote(w.management, deal.id, { lines: [{ catalogueItemId: costly.id, quantity: 2 }] });
  // An invoice can only belong to a won deal.
  const won = await createWonDeal(w.org.id, w.management, { companyId: w.company.id, value: Number(DEAL_VALUE) });
  const invoice = (await createInvoice(w.management, { number: "G301-INV-1", amount: INVOICE, issuedOn: "2026-11-01", dueOn: "2026-12-01", dealId: won.id, companyId: w.company.id })) as { id: string };
  await markInvoiceSent(w.management, invoice.id);
  await recordPayment(w.management, invoice.id, { amount: PAYMENT, paidOn: "2026-11-05" });
  return { ...w, deal, quote, invoice };
}

/** Calls every GET route of the organisation (ids filled in where known) as `ctx` and returns what came back. */
async function crawl(ctx: AuthContext, ids: Record<string, string>) {
  const out: Array<{ path: string; status: number; text: string }> = [];
  current.ctx = ctx;
  try {
    for (const route of discoverRoutes().filter((r) => isOrganisationRoute(r) && r.methods.includes("GET"))) {
      const values = fillParams(route, "x", (name) => ids[name]);
      try {
        const res = await invoke(route, "GET", values);
        out.push({ path: route.path, status: res.status, text: res.text });
      } catch (err) {
        out.push({ path: route.path, status: 599, text: String(err) });
      }
    }
  } finally {
    current.ctx = null;
  }
  return out;
}

const LEAKS: Array<[string, RegExp]> = [
  ["deal value", new RegExp(DEAL_VALUE)],
  ["invoice amount", new RegExp(INVOICE)],
  ["payment amount", new RegExp(PAYMENT)],
  ["catalogue and quote cost", new RegExp(COST)],
];

describe("G3.01 roles: a custom role holding every grantable key, with the deal value hidden, reaches no money it was refused", () => {
  it("the crawl reads the planted values as Management (control), and none of them as the custom role, Sales or Delivery", async () => {
    const w = await plantedWorld();
    const ids = { dealId: w.deal.id, quoteId: w.quote.id, companyId: w.company.id, invoiceId: w.invoice.id };
    const control = await crawl(w.management, ids);
    const controlText = control.map((c) => c.text).join("\n");
    for (const [name, re] of LEAKS) expect(re.test(controlText), `control: ${name} must be readable by Management or this test proves nothing`).toBe(true);

    const role = await createRole(w.management, { name: "Everything Grantable", permissionKeys: grantableKeys(), fieldRules: { "deal.value": "hidden" } });
    const custom = await holderOf(w.org.id, role.id, "g301.broad");
    const delivery = (await import("./helpers/fixtures")).createTestContext(w.org.id, "DELIVERY", "g301.deliv");
    const results: Record<string, Awaited<ReturnType<typeof crawl>>> = {
      custom: await crawl(custom, ids),
      salesTwo: await crawl(w.salesTwo, ids),
      delivery: await crawl(await delivery, ids),
    };
    const violations: string[] = [];
    for (const [who, rows] of Object.entries(results)) {
      expect(rows.filter((r) => r.status >= 500), `${who}: no route may fail with a 5xx`).toEqual([]);
      for (const row of rows) for (const [name, re] of LEAKS) if (re.test(row.text)) violations.push(`${who}: ${name} at ${row.path}`);
    }
    // Finding R-1 (the monthly report showed the won value) was fixed in src/services/reportsV2Service.ts, so no route is excused any more.
    expect(violations).toEqual([]);
    // The crawl is not vacuous: the broad role really opens things.
    expect(results.custom!.filter((r) => r.status === 200).length).toBeGreaterThan(20);
  }, 600_000);
});

describe("G3.01 roles: finding R-1 (fixed), the monthly report must not show the won value to a role that may not see values", () => {
  // FINDING (High, rule 7), FIXED 11 Nov 2026 (`valueRows` in src/services/reportsV2Service.ts). It was: `/reports/v2` (default report MONTH_VS_LAST, "This month against last month") has a "Won value" ROW, but the report's
  // masking hides money COLUMNS only (`valueColumns: []` for this report, src/services/reportsV2Service.ts line 248), and the page is reported with
  // `valueMasked: false`. Any role that holds `reporting.view.all` without `deals.view.value` reads the total of the deals won this month and last
  // month: a custom role built with the deal value switched off, "not even for the owner", still gets it. Platform roles are not affected only
  // because none of them holds `reporting.view.all` without also holding `deals.view.value`.
  it("a custom role with reporting.view.all and the deal value hidden is not shown the won value", async () => {
    const w = await plantedWorld();
    const role = await createRole(w.management, { name: "Reports No Values", permissionKeys: ["reporting.view.all", "leads.view.all", "deals.view.all"], fieldRules: { "deal.value": "hidden" } });
    const holder = await holderOf(w.org.id, role.id, "g301.reports");
    expect(holder.permissionKeys).not.toContain("deals.view.value");
    const route = discoverRoutes().find((r) => r.path === "/api/orgs/{orgSlug}/reports/v2")!;
    current.ctx = holder;
    try {
      const res = await invoke(route, "GET", { orgSlug: "x" });
      expect(res.status).toBe(200);
      expect(res.text.includes(DEAL_VALUE), "the planted won value is in the report").toBe(false);
    } finally {
      current.ctx = null;
    }
  }, 120_000);

  it("the report service masks the Won value row for that role (page and single report) and keeps it for a role that may see values", async () => {
    const w = await plantedWorld();
    const role = await createRole(w.management, { name: "Reports No Values 2", permissionKeys: ["reporting.view.all", "leads.view.all", "deals.view.all"], fieldRules: { "deal.value": "hidden" } });
    const holder = await holderOf(w.org.id, role.id, "g301.reports2");
    const wonRow = (r: Awaited<ReturnType<typeof getReport>>) => r.table.rows.find((row) => row.label === "Won value")!;

    const masked = await getReport(holder, "MONTH_VS_LAST");
    expect(masked.valueMasked).toBe(true);
    expect(wonRow(masked)).toMatchObject({ label: "Won value", thisMonth: null, lastMonth: null, change: null });
    // The other rows of the same report still show (counts are not money).
    expect(masked.table.rows.find((row) => row.label === "Deals won")!.thisMonth).not.toBeNull();
    expect(JSON.stringify(masked)).not.toContain(DEAL_VALUE);

    const page = await getReports(holder);
    const monthly = page.reports.find((r) => r.key === "MONTH_VS_LAST")!;
    expect(monthly.valueMasked).toBe(true);
    expect(JSON.stringify(page)).not.toContain(DEAL_VALUE);

    // Management may see values: nothing is over-masked.
    const open = await getReport(w.management, "MONTH_VS_LAST");
    expect(open.valueMasked).toBe(false);
    expect(wonRow(open).thisMonth).not.toBeNull();
  }, 120_000);
});

describe("G3.01 roles: the limits hold for every way a request can name a key or a role", () => {
  it("a request cannot smuggle a reserved key in by spelling, spacing, case, duplication or an alias", async () => {
    const w = await plantedWorld();
    for (const key of ["audit.view ", " audit.view", "AUDIT.VIEW", "audit.view​", "audit.view\n", "audit%2eview", "export.bulk", "payments.manage", "deals.margin", "finance.view.payments", "roles.manage", "security.manage", "*", "", "__proto__", "constructor"]) {
      await expect(createRole(w.management, { name: `Smuggle ${Math.random().toString(36).slice(2, 8)}`, permissionKeys: ["leads.view.all", key] }), JSON.stringify(key)).rejects.toMatchObject({ name: "ValidationError" });
    }
    // Starting from Management copies only the grantable keys.
    const role = await createRole(w.management, { name: "From Management", basedOnRoleKey: "MANAGEMENT" });
    for (const k of ["audit.view", "export.bulk", "payments.manage", "deals.margin", "roles.manage", "security.manage", "organization.manage_settings", "membership.manage", "role.assign", "api_tokens.manage", "webhooks.manage", "finance.view.payments"]) {
      expect(role.permissionKeys, k).not.toContain(k);
    }
  });

  it("extra body fields on the role routes cannot set the organisation, the key, the system flag or the owner of a role", async () => {
    const w = await plantedWorld();
    const other = await plantedWorld();
    const route = discoverRoutes().find((r) => r.path === "/api/orgs/{orgSlug}/roles")!;
    current.ctx = w.management;
    try {
      const res = await invoke(route, "POST", { orgSlug: "x" }, { body: { name: "Mass Assign", permissionKeys: ["leads.view.all"], organizationId: other.org.id, isSystem: true, key: "MANAGEMENT", archivedAt: null, createdByMembershipId: other.management.membershipId } });
      expect(res.status === 200 || res.status === 201 || res.status === 400).toBe(true);
      if (res.status !== 400) {
        const row = await adminDb.role.findFirstOrThrow({ where: { name: "Mass Assign" } });
        expect(row.organizationId).toBe(w.org.id);
        expect(row.isSystem).toBe(false);
        expect(row.key).not.toBe("MANAGEMENT");
        expect(row.createdByMembershipId).toBe(w.management.membershipId);
      }
    } finally {
      current.ctx = null;
    }
  });

  it("another organisation's custom role cannot be assigned, edited or read by id, and an archived role grants nothing", async () => {
    const a = await plantedWorld();
    const b = await plantedWorld();
    const foreign = await createRole(b.management, { name: "Foreign Role", permissionKeys: ["leads.view.all"] });
    const member = await createTestMembership(a.org.id, "SALES", "g301.assign");
    await expect(changeMemberRole(a.management, member.membership.id, foreign.key)).rejects.toThrow();
    expect((await adminDb.membership.findUniqueOrThrow({ where: { id: member.membership.id } })).roleId).not.toBe(foreign.id);
  });

  it("a person cannot give themselves a stronger role: a Sales member, and a holder of a broad custom role, are refused role changes", async () => {
    const w = await plantedWorld();
    const role = await createRole(w.management, { name: "Broad Two", permissionKeys: grantableKeys() });
    const custom = await holderOf(w.org.id, role.id, "g301.self");
    const mgmtRole = await adminDb.role.findFirstOrThrow({ where: { key: "MANAGEMENT", organizationId: null } });
    for (const who of [custom, w.sales, w.salesTwo]) {
      await expect(changeMemberRole(who, who.membershipId, mgmtRole.key), who.roleKey).rejects.toMatchObject({ name: "ForbiddenError" });
    }
  });
});

describe("G3.01 roles: bulk reading through the public API", () => {
  // FINDING (Medium, a decision for Michael): exports are limited to 500 rows and anything larger needs `export.bulk` (Management only, and a
  // reserved key that no custom role can hold). The public API gives every token owner the same rows by paging, 100 at a time, 120 calls a
  // minute, with no export permission, no export approval and no export entry in the audit log. A role that was deliberately refused
  // `contacts.export` can still take every contact it may view, at about 12,000 a minute.
  it.fails("a role without the export permission cannot take more than the 500-row export limit of contacts through the API", async () => {
    const w = await plantedWorld();
    await adminDb.contact.createMany({ data: Array.from({ length: 620 }, (_v, i) => ({ organizationId: w.org.id, companyId: w.company.id, firstName: `Bulk${i}`, lastName: "Row", ownerMembershipId: w.management.membershipId })) });
    const role = await createRole(w.management, { name: "Viewer Only", permissionKeys: ["contacts.view"] });
    const viewer = await holderOf(w.org.id, role.id, "g301.viewer");
    expect(viewer.permissionKeys).not.toContain("contacts.export");
    const token = (await createApiToken(viewer, { name: "bulk", scopes: [...API_SCOPES] })).token;
    let cursor: string | null = null;
    let taken = 0;
    for (let i = 0; i < 10; i++) {
      const res = await listContactsRoute(apiRequest(`/api/v1/contacts?limit=100${cursor ? `&cursor=${cursor}` : ""}`, token));
      if (res.status !== 200) break;
      const page = (await res.json()) as { items: unknown[]; nextCursor: string | null };
      taken += page.items.length;
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect(taken).toBeLessThanOrEqual(500);
  }, 120_000);
});
