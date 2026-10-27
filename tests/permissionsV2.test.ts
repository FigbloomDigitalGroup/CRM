import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ownerRoleNamesForKeys } from "../src/auth/areaOwners";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import {
  DEPARTURES,
  canView,
  effectivePermissionKeys,
  resolveScope,
  roleIsAvailable,
} from "../src/auth/permissions";
import { adminDb } from "../src/db/adminClient";
import { buildErrorResponse } from "../src/lib/apiErrors";
import type { FeatureConfig } from "../src/lib/featureFlags";
import { PERMISSIONS, ROLES, ROLE_PERMISSIONS } from "../prisma/seedData";
import { seedRolesAndPermissions } from "../prisma/seedReference";
import { createCompany } from "../src/services/companyService";
import * as dealService from "../src/services/dealService";
import { setOrganizationRelease, updateFeatureToggles } from "../src/services/featureService";
import * as leadService from "../src/services/leadService";
import { changeMemberRole, inviteMember } from "../src/services/membershipService";
import * as searchService from "../src/services/searchService";
import * as taskService from "../src/services/taskService";
import {
  createTestContext,
  createTestOrganization,
  getLeadStatusId,
  getPipelineStageId,
} from "./helpers/fixtures";

const V1: FeatureConfig = { release: "v1", toggles: {} };
const off = (...keys: string[]): FeatureConfig => ({
  release: "v1",
  toggles: Object.fromEntries(keys.map((k) => [k, false])),
});

const keysFor = (roleKey: string, config: FeatureConfig = V1) => ({
  membershipId: `m-${roleKey}`,
  permissionKeys: effectivePermissionKeys({
    roleKey,
    catalogueKeys: ROLE_PERMISSIONS[roleKey] ?? [],
    config,
  }),
});

// ---------------------------------------------------------------------------
// The matrix (B1.01 acceptance: a table-driven test for all roles)
// ---------------------------------------------------------------------------

type Cell = "organisation" | "own" | "read-only" | "none";
type Resource = Parameters<typeof resolveScope>[1];

/**
 * What each role sees at list level, written out by hand from the design's
 * Screen Checklist role columns and docs/DECISIONS.md: E = edit, O = own,
 * R = read-only, no access. `view` is the scope pill on the list; `edit` is
 * whether a change is allowed on a record the caller can see (own records
 * for `own` roles).
 */
const MATRIX: Record<string, Partial<Record<Resource, { view: Cell; edit: Cell }>>> = {
  MANAGEMENT: {
    leads: { view: "organisation", edit: "organisation" },
    deals: { view: "organisation", edit: "organisation" },
    tasks: { view: "organisation", edit: "organisation" },
    companies: { view: "organisation", edit: "organisation" },
    contacts: { view: "organisation", edit: "organisation" },
    activities: { view: "organisation", edit: "organisation" },
    communications: { view: "organisation", edit: "organisation" },
    proposals: { view: "organisation", edit: "organisation" },
  },
  SALES: {
    leads: { view: "own", edit: "own" },
    deals: { view: "own", edit: "own" },
    tasks: { view: "own", edit: "own" },
    companies: { view: "organisation", edit: "organisation" },
    contacts: { view: "organisation", edit: "organisation" },
    activities: { view: "organisation", edit: "organisation" },
    communications: { view: "organisation", edit: "organisation" },
    proposals: { view: "organisation", edit: "organisation" },
  },
  DELIVERY: {
    leads: { view: "none", edit: "none" },
    deals: { view: "read-only", edit: "read-only" },
    tasks: { view: "own", edit: "own" },
    companies: { view: "organisation", edit: "read-only" },
    contacts: { view: "organisation", edit: "read-only" },
    activities: { view: "organisation", edit: "organisation" },
    communications: { view: "organisation", edit: "organisation" },
    proposals: { view: "none", edit: "none" },
  },
  FINANCE: {
    leads: { view: "none", edit: "none" },
    deals: { view: "read-only", edit: "read-only" },
    tasks: { view: "none", edit: "none" },
    companies: { view: "organisation", edit: "read-only" },
    contacts: { view: "organisation", edit: "read-only" },
    activities: { view: "none", edit: "none" },
    communications: { view: "none", edit: "none" },
    proposals: { view: "none", edit: "none" },
  },
  RESTRICTED_TECHNICAL: {
    leads: { view: "none", edit: "none" },
    deals: { view: "none", edit: "none" },
    tasks: { view: "own", edit: "own" },
    companies: { view: "none", edit: "none" },
    contacts: { view: "none", edit: "none" },
    activities: { view: "organisation", edit: "read-only" },
    communications: { view: "organisation", edit: "read-only" },
    proposals: { view: "none", edit: "none" },
  },
};

describe("permission matrix (seeded roles, release v1, defaults)", () => {
  for (const [roleKey, resources] of Object.entries(MATRIX)) {
    for (const [resource, expected] of Object.entries(resources)) {
      it(`${roleKey} on ${resource}: view ${expected!.view}, edit ${expected!.edit}`, () => {
        const ctx = keysFor(roleKey);
        expect(resolveScope(ctx, resource as Resource, "view").scope).toBe(expected!.view);
        expect(resolveScope(ctx, resource as Resource, "edit").scope).toBe(expected!.edit);
      });
    }
  }

  it("covers every seeded role except the flag-gated one", () => {
    const covered = Object.keys(MATRIX).sort();
    const seeded = ROLES.filter((r) => !r.requiredFeature).map((r) => r.key).sort();
    expect(covered).toEqual(seeded);
  });

  it("has six roles, the sixth being Customer Support behind customer_support.role", () => {
    expect(ROLES.map((r) => r.key)).toEqual([
      "MANAGEMENT",
      "SALES",
      "DELIVERY",
      "FINANCE",
      "RESTRICTED_TECHNICAL",
      "CUSTOMER_SUPPORT",
    ]);
    expect(ROLES.find((r) => r.key === "CUSTOMER_SUPPORT")?.requiredFeature).toBe(
      "customer_support.role",
    );
  });

  it("gives every role only keys that exist in the catalogue, and Management every V1 key", () => {
    const known = new Set(PERMISSIONS.map((p) => p.key));
    for (const [roleKey, keys] of Object.entries(ROLE_PERMISSIONS)) {
      for (const key of keys) expect(known.has(key), `${roleKey} -> ${key}`).toBe(true);
    }
  });

  it("includes the 19 new design keys in the catalogue", () => {
    const keys = new Set(PERMISSIONS.map((p) => p.key));
    for (const key of [
      "attachments.manage",
      "templates.manage",
      "tags.manage",
      "customfields.manage",
      "views.share",
      "quotes.create",
      "quotes.approve",
      "catalogue.manage",
      "forecast.view.all",
      "targets.manage",
      "cadences.manage",
      "ai.use",
      "ai.configure",
      "api_tokens.manage",
      "webhooks.manage",
      "security.manage",
      "deals.margin",
      "payments.manage",
      "tickets.manage",
    ]) {
      expect(keys.has(key), key).toBe(true);
    }
  });
});

describe("release gating of keys", () => {
  it("keeps V1.1 and V2 keys inert until the release flag is on", () => {
    const v1 = keysFor("MANAGEMENT").permissionKeys;
    for (const inert of ["quotes.approve", "ai.configure", "api_tokens.manage", "webhooks.manage", "tickets.manage"]) {
      expect(v1).not.toContain(inert);
    }
    expect(v1).toContain("attachments.manage");

    const v11 = keysFor("MANAGEMENT", { release: "v1.1", toggles: {} }).permissionKeys;
    expect(v11).toContain("quotes.approve");
    expect(v11).not.toContain("webhooks.manage");
    expect(keysFor("MANAGEMENT", { release: "v2", toggles: {} }).permissionKeys).toContain(
      "webhooks.manage",
    );
  });
});

// ---------------------------------------------------------------------------
// resolveScope (unit)
// ---------------------------------------------------------------------------

describe("resolveScope", () => {
  const sales = keysFor("SALES");
  const mgmt = keysFor("MANAGEMENT");
  const delivery = keysFor("DELIVERY");

  it("answers own for a record the caller owns and none for somebody else's", () => {
    expect(resolveScope(sales, "leads", "view", { ownerMembershipId: sales.membershipId }).scope).toBe("own");
    expect(resolveScope(sales, "leads", "view", { ownerMembershipId: "someone-else" }).scope).toBe("none");
    expect(canView(sales, "leads", { ownerMembershipId: "someone-else" })).toBe(false);
  });

  it("explains itself in plain language", () => {
    const r = resolveScope(sales, "deals", "edit", { ownerMembershipId: "x" });
    expect(r.scope).toBe("none");
    expect(r.reason).toMatch(/cannot see this deal/i);
    expect(resolveScope(mgmt, "deals", "edit").reason).toMatch(/across the organisation/i);
  });

  it("lets the shared pool through read-only and marks it provisional", () => {
    const pool = resolveScope(sales, "leads", "view", { ownerMembershipId: null });
    expect(pool).toMatchObject({ scope: "read-only", provisional: true, departure: "shared_pool" });
    const edit = resolveScope(sales, "leads", "edit", { ownerMembershipId: null });
    expect(edit.scope).toBe("read-only");
  });

  it("limits a won-only viewer to won deals and marks the access provisional", () => {
    expect(resolveScope(delivery, "deals", "view", { ownerMembershipId: "x", outcome: "WON" })).toMatchObject({
      scope: "read-only",
      provisional: true,
      departure: "won_only",
    });
    expect(resolveScope(delivery, "deals", "view", { ownerMembershipId: "x", outcome: "OPEN" }).scope).toBe("none");
    expect(resolveScope(delivery, "deals", "view", { ownerMembershipId: "x", outcome: "LOST" }).scope).toBe("none");
  });

  it("is not provisional for access the seeded matrix already gave", () => {
    expect(resolveScope(mgmt, "deals", "view").provisional).toBe(false);
    expect(resolveScope(sales, "deals", "view", { ownerMembershipId: sales.membershipId }).provisional).toBe(false);
  });

  it("tasks follow the assignee", () => {
    expect(resolveScope(sales, "tasks", "view", { ownerMembershipId: sales.membershipId }).scope).toBe("own");
    expect(resolveScope(sales, "tasks", "view", { ownerMembershipId: "other" }).scope).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// Departures: every flag on and off, for every affected role (B1.03)
// ---------------------------------------------------------------------------

describe("departures: effective keys, flag on and off", () => {
  const has = (roleKey: string, key: string, config: FeatureConfig) =>
    keysFor(roleKey, config).permissionKeys.includes(key);

  it("won_only: Delivery and Finance see won deals only when on, every deal when off", () => {
    for (const role of ["DELIVERY", "FINANCE"]) {
      expect(has(role, "deals.view.won", V1)).toBe(true);
      expect(has(role, "deals.view.all", V1)).toBe(false);
      const fallback = off("departure.won_only");
      expect(has(role, "deals.view.won", fallback)).toBe(false);
      expect(has(role, "deals.view.all", fallback)).toBe(true);
    }
    // Roles the departure does not touch never change.
    expect(has("SALES", "deals.view.own", off("departure.won_only"))).toBe(true);
  });

  it("shared_pool: Sales gets the pool and claim when on, neither when off", () => {
    expect(has("SALES", "leads.view.shared", V1)).toBe(true);
    expect(has("SALES", "leads.claim", V1)).toBe(true);
    expect(has("SALES", "leads.view.shared", off("departure.shared_pool"))).toBe(false);
    expect(has("SALES", "leads.claim", off("departure.shared_pool"))).toBe(false);
    expect(has("SALES", "leads.view.own", off("departure.shared_pool"))).toBe(true);
  });

  it("technical_my_work: Restricted Technical gets My work when on only", () => {
    expect(has("RESTRICTED_TECHNICAL", "mywork.view", V1)).toBe(true);
    expect(has("RESTRICTED_TECHNICAL", "mywork.view", off("departure.technical_my_work"))).toBe(false);
    expect(has("RESTRICTED_TECHNICAL", "tasks.view.own", off("departure.technical_my_work"))).toBe(true);
  });

  it("finance_followup: Finance gets the follow-up note when on only", () => {
    expect(has("FINANCE", "finance.followup.note", V1)).toBe(true);
    expect(has("FINANCE", "finance.followup.note", off("departure.finance_followup"))).toBe(false);
    expect(has("FINANCE", "finance.view.payments", off("departure.finance_followup"))).toBe(true);
  });

  it("handoff_permission: Management, Sales and Delivery carry their handoff keys when on only", () => {
    const flag = off("departure.handoff_permission");
    expect(has("MANAGEMENT", "deals.handoff", V1) && has("MANAGEMENT", "handoff.manage", V1)).toBe(true);
    expect(has("SALES", "deals.handoff", V1)).toBe(true);
    expect(has("DELIVERY", "handoff.manage", V1)).toBe(true);
    expect(has("MANAGEMENT", "deals.handoff", flag)).toBe(false);
    expect(has("MANAGEMENT", "handoff.manage", flag)).toBe(false);
    expect(has("SALES", "deals.handoff", flag)).toBe(false);
    expect(has("DELIVERY", "handoff.manage", flag)).toBe(false);
  });

  it("the umbrella toggle switches every departure off at once", () => {
    const umbrella = off("permissions.provisional_departures");
    for (const departure of DEPARTURES) {
      for (const [role, keys] of Object.entries(departure.grants)) {
        for (const key of keys) expect(has(role, key, umbrella), `${role} ${key}`).toBe(false);
      }
      for (const [role, keys] of Object.entries(departure.restores)) {
        for (const key of keys) expect(has(role, key, umbrella), `${role} ${key}`).toBe(true);
      }
    }
  });

  it("an individual flag stays off when the umbrella is on, and vice versa", () => {
    const only = off("departure.shared_pool");
    expect(has("DELIVERY", "deals.view.won", only)).toBe(true);
    expect(has("SALES", "leads.view.shared", only)).toBe(false);
  });

  it("every departure carries a decision reference and the screens that show its banner", () => {
    expect(DEPARTURES).toHaveLength(5);
    for (const d of DEPARTURES) {
      expect(d.decision).toMatch(/^1\.\d$/);
      expect(d.screens.length).toBeGreaterThan(0);
      expect(d.toggle).toBe(`departure.${d.id}`);
    }
  });

  it("Customer Support carries nothing until its flag is on, then its catalogue keys", () => {
    expect(roleIsAvailable("CUSTOMER_SUPPORT", V1)).toBe(false);
    expect(keysFor("CUSTOMER_SUPPORT").permissionKeys).toEqual([]);
    const on: FeatureConfig = { release: "v1.1", toggles: { "customer_support.role": true } };
    expect(roleIsAvailable("CUSTOMER_SUPPORT", on)).toBe(true);
    expect(keysFor("CUSTOMER_SUPPORT", on).permissionKeys).toContain("contacts.view");
  });
});

// ---------------------------------------------------------------------------
// Departures through the real services (database)
// ---------------------------------------------------------------------------

async function org() {
  return createTestOrganization("PermV2");
}

async function openDealFor(owner: Awaited<ReturnType<typeof createTestContext>>, value = "500") {
  const { company } = await createCompany(owner, { name: "Perm Co" });
  return dealService.createDeal(owner, {
    companyId: company.id,
    pipelineStageId: await getPipelineStageId(owner.organizationId),
    value,
  });
}

async function win(owner: Awaited<ReturnType<typeof createTestContext>>, dealId: string) {
  return dealService.updateDeal(owner, dealId, {
    pipelineStageId: await getPipelineStageId(owner.organizationId, "CLOSED_WON"),
  });
}

describe("won-only departure through the services", () => {
  it("lists, counts, searches and summarises won deals only for Delivery and Finance, and every deal when the flag is off", async () => {
    const o = await org();
    const mgmt = await createTestContext(o.id, "MANAGEMENT", "pv.mgmt");
    const sales = await createTestContext(o.id, "SALES", "pv.sales");
    const open = await openDealFor(sales);
    const won = await openDealFor(sales, "900");
    await win(sales, won.id);

    for (const role of ["DELIVERY", "FINANCE"]) {
      const viewer = await createTestContext(o.id, role, `pv.${role.toLowerCase()}`);
      const list = await dealService.listDeals(viewer);
      expect(list.map((d) => d.id)).toEqual([won.id]);
      expect(await dealService.countDeals(viewer)).toBe(1);
      expect((await dealService.getDealSummary(viewer)).open).toBe(0);
      // A forged outcome filter cannot reach an open deal.
      expect(await dealService.listDeals(viewer, { outcome: "OPEN" })).toEqual([]);
      expect(await dealService.listDeals(viewer, { stalledOnly: true })).toEqual([]);
      // An open deal answers 404, as if it did not exist.
      await expect(dealService.getDeal(viewer, open.id)).rejects.toThrow(NotFoundError);
      await expect(dealService.getDeal(viewer, won.id)).resolves.toMatchObject({ id: won.id });
      const found = await searchService.globalSearch(viewer, "Perm");
      expect(found.deals.map((d) => d.id)).toEqual([won.id]);
    }

    // Flag off: back to the seeded matrix (every deal).
    await updateFeatureToggles(mgmt, { "departure.won_only": false });
    const deliveryAll = await createTestContext(o.id, "DELIVERY", "pv.delivery.off");
    expect((await dealService.listDeals(deliveryAll)).map((d) => d.id).sort()).toEqual([open.id, won.id].sort());
    await expect(dealService.getDeal(deliveryAll, open.id)).resolves.toBeTruthy();
  });

  it("masks values for Delivery but not Finance on a won deal", async () => {
    const o = await org();
    const sales = await createTestContext(o.id, "SALES", "pv.vsales");
    const won = await openDealFor(sales, "1200");
    await win(sales, won.id);
    const delivery = await createTestContext(o.id, "DELIVERY", "pv.vdel");
    const finance = await createTestContext(o.id, "FINANCE", "pv.vfin");
    expect((await dealService.getDeal(delivery, won.id)).valueMasked).toBe(true);
    expect(Number((await dealService.getDeal(finance, won.id)).value)).toBe(1200);
  });

  it("a won-only viewer cannot edit the won deal it can see: the explained 403", async () => {
    const o = await org();
    const sales = await createTestContext(o.id, "SALES", "pv.esales");
    const won = await openDealFor(sales);
    await win(sales, won.id);
    const finance = await createTestContext(o.id, "FINANCE", "pv.efin");
    await expect(dealService.updateDeal(finance, won.id, { notes: "x" })).rejects.toThrow(ForbiddenError);
  });
});

describe("shared pool through the services", () => {
  it("shows Sales their own leads plus unassigned ones, never a colleague's, and drops a forged owner filter", async () => {
    const o = await org();
    const mgmt = await createTestContext(o.id, "MANAGEMENT", "sp.mgmt");
    const alice = await createTestContext(o.id, "SALES", "sp.alice");
    const bob = await createTestContext(o.id, "SALES", "sp.bob");
    const leadStatusId = await getLeadStatusId(o.id);
    const mine = (await leadService.createLead(alice, { leadStatusId })).lead;
    const theirs = (await leadService.createLead(bob, { leadStatusId })).lead;
    const pooled = (await leadService.createLead(mgmt, { leadStatusId })).lead;
    await adminDb.lead.update({ where: { id: pooled.id }, data: { ownerMembershipId: null } });

    const seen = (await leadService.listLeads(alice)).map((l) => l.id).sort();
    expect(seen).toEqual([mine.id, pooled.id].sort());
    expect(seen).not.toContain(theirs.id);
    const forged = await leadService.listLeads(alice, { ownerMembershipId: bob.membershipId });
    expect(forged.map((l) => l.id).sort()).toEqual([mine.id, pooled.id].sort());

    // Read-only: she can open a pool lead but not change it (claiming is B2.02).
    await expect(leadService.getLead(alice, pooled.id)).resolves.toBeTruthy();
    await expect(leadService.updateLead(alice, pooled.id, { notes: "mine now" })).rejects.toThrow(ForbiddenError);
    await expect(leadService.getLead(alice, theirs.id)).rejects.toThrow(NotFoundError);

    // Flag off: the pool disappears.
    await updateFeatureToggles(mgmt, { "departure.shared_pool": false });
    const aliceNoPool = await createTestContext(o.id, "SALES", "sp.alice2");
    await expect(leadService.getLead(aliceNoPool, pooled.id)).rejects.toThrow(NotFoundError);
  });
});

describe("record visibility: 404 for the invisible, explained 403 for the role", () => {
  it("a role with no access to the area gets the explained 403; one with access but not to this record gets 404", async () => {
    const o = await org();
    const sales = await createTestContext(o.id, "SALES", "rv.sales");
    const other = await createTestContext(o.id, "SALES", "rv.other");
    const tech = await createTestContext(o.id, "RESTRICTED_TECHNICAL", "rv.tech");
    const leadStatusId = await getLeadStatusId(o.id);
    const lead = (await leadService.createLead(sales, { leadStatusId })).lead;
    const task = await taskService.createTask(sales, { title: "Mine" });

    await expect(leadService.getLead(tech, lead.id)).rejects.toThrow(ForbiddenError);
    await expect(leadService.getLead(other, lead.id)).rejects.toThrow(NotFoundError);
    await expect(taskService.updateTask(other, task.id, { status: "COMPLETED" })).rejects.toThrow(NotFoundError);
  });
});

// ---------------------------------------------------------------------------
// Customer Support role assignment
// ---------------------------------------------------------------------------

describe("Customer Support behind its flag", () => {
  it("cannot be invited or assigned until customer_support.role is on", async () => {
    const o = await org();
    const mgmt = await createTestContext(o.id, "MANAGEMENT", "cs.mgmt");
    const sales = await createTestContext(o.id, "SALES", "cs.sales");

    await expect(
      inviteMember(mgmt, { email: "cs.invite@example.test", name: "Cs Invite", roleKey: "CUSTOMER_SUPPORT" }, (t) => `http://localhost/accept/${t}`),
    ).rejects.toThrow(ValidationError);
    await expect(changeMemberRole(mgmt, sales.membershipId, "CUSTOMER_SUPPORT")).rejects.toThrow(ValidationError);

    await setOrganizationRelease(o.id, "v1.1");
    await updateFeatureToggles(mgmt, { "customer_support.role": true });
    await expect(changeMemberRole(mgmt, sales.membershipId, "CUSTOMER_SUPPORT")).resolves.toBeTruthy();
    const support = await createTestContext(o.id, "CUSTOMER_SUPPORT", "cs.support");
    expect(support.permissionKeys).toContain("contacts.view");
  });

  it("a Customer Support member carries no permissions while the flag is off", async () => {
    const o = await org();
    const support = await createTestContext(o.id, "CUSTOMER_SUPPORT", "cs.off");
    expect(support.permissionKeys).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Catalogue sync: reconciles, audits, idempotent
// ---------------------------------------------------------------------------

describe("role catalogue sync", () => {
  it("removes a permission a role no longer has and audits the change in each organisation", async () => {
    const o = await org();
    await createTestContext(o.id, "FINANCE", "sync.fin");
    const financeRole = await adminDb.role.findUniqueOrThrow({ where: { key: "FINANCE" } });
    const extra = await adminDb.permission.findUniqueOrThrow({ where: { key: "leads.export" } });
    await adminDb.rolePermission.create({ data: { roleId: financeRole.id, permissionId: extra.id } });

    const result = await seedRolesAndPermissions();
    expect(result.changes.FINANCE).toEqual({ added: [], removed: ["leads.export"] });
    const stillThere = await adminDb.rolePermission.count({
      where: { roleId: financeRole.id, permissionId: extra.id },
    });
    expect(stillThere).toBe(0);

    const audit = await adminDb.auditEvent.findFirst({
      where: { organizationId: o.id, action: "role.permissions_changed", entityId: financeRole.id },
    });
    expect(audit?.metadata).toMatchObject({ roleKey: "FINANCE", removed: ["leads.export"] });

    const again = await seedRolesAndPermissions();
    expect(again.changes).toEqual({});
  });

  it("stores the required feature on the role row", async () => {
    const role = await adminDb.role.findUniqueOrThrow({ where: { key: "CUSTOMER_SUPPORT" } });
    expect(role.requiredFeature).toBe("customer_support.role");
    expect((await adminDb.role.findUniqueOrThrow({ where: { key: "SALES" } })).requiredFeature).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The explained denial (B1.02): one denied route per feature area and role
// ---------------------------------------------------------------------------

describe("explained denial envelope", () => {
  const AREAS: { area: string; key: string; expectOwners: string[] }[] = [
    { area: "Leads", key: "leads.edit.all", expectOwners: ["Management", "Sales"] },
    { area: "Deals", key: "deals.edit.all", expectOwners: ["Management", "Sales"] },
    { area: "Finance", key: "finance.manage.payments", expectOwners: ["Finance", "Management"] }, // Management manages payments too (FIG-1049)
    { area: "Organization", key: "organization.manage_settings", expectOwners: ["Management"] },
    { area: "Membership", key: "membership.manage", expectOwners: ["Management"] },
    { area: "Reporting", key: "reporting.view.all", expectOwners: ["Management"] },
    { area: "Audit", key: "audit.view", expectOwners: ["Management"] },
  ];

  it("carries yourRole, ownerRoles and whoToAsk (Management names) for each area and each denied role", async () => {
    const o = await org();
    const mgmt = await createTestContext(o.id, "MANAGEMENT", "den.mgmt");
    const mgmtUser = await adminDb.membership.findUniqueOrThrow({
      where: { id: mgmt.membershipId },
      include: { user: true },
    });
    const roles = ["SALES", "DELIVERY", "FINANCE", "RESTRICTED_TECHNICAL"];
    for (const roleKey of roles) {
      const ctx = await createTestContext(o.id, roleKey, `den.${roleKey.toLowerCase()}`);
      for (const { area, key, expectOwners } of AREAS) {
        if (ctx.permissionKeys.includes(key)) continue; // this role is allowed: no denial to test
        const err = new ForbiddenError(key, {
          roleKey: ctx.roleKey,
          organizationId: ctx.organizationId,
          permissionKeys: [key],
        });
        const { status, body } = await buildErrorResponse(err, "req-denial-0001");
        expect(status, `${roleKey} ${area}`).toBe(403);
        expect(body.denial?.yourRole).toBeTruthy();
        expect(body.denial?.ownerRoles, `${roleKey} ${area}`).toEqual(expectOwners);
        expect(body.denial?.whoToAsk).toEqual([mgmtUser.user.name]);
      }
    }
  });

  it("never lists an email address in whoToAsk", async () => {
    const o = await org();
    const mgmt = await createTestContext(o.id, "MANAGEMENT", "den.noemail");
    const tech = await createTestContext(o.id, "RESTRICTED_TECHNICAL", "den.tech2");
    const err = new ForbiddenError("leads.view.all", {
      roleKey: tech.roleKey,
      organizationId: tech.organizationId,
      permissionKeys: ["leads.view.all"],
    });
    const { body } = await buildErrorResponse(err, "req-denial-0002");
    expect(JSON.stringify(body.denial)).not.toContain("@");
    void mgmt;
  });

  it("leaves Customer Support out of the owner roles until its flag is on", () => {
    expect(ownerRoleNamesForKeys(["tickets.manage"], V1)).toEqual(["Management"]);
    const on: FeatureConfig = { release: "v1.1", toggles: { "customer_support.role": true } };
    // tickets.manage is a V2 key, but owner derivation reads the catalogue.
    expect(ownerRoleNamesForKeys(["tickets.manage"], on)).toEqual(["Customer Support", "Management"]);
  });
});

// ---------------------------------------------------------------------------
// Structural guard: no route or service checks a role name
// ---------------------------------------------------------------------------

describe("no code path checks a role name", () => {
  const ROLE_KEYS = ROLES.map((r) => r.key);
  // Files that legitimately name roles: the catalogue itself, the departures that
  // are defined per role, membership administration (the last-Management guard),
  // dev seeds, and the area-owner derivation that reports role names.
  const ALLOWED = [
    "src/auth/permissions.ts",
    "src/auth/areaOwners.ts",
    "src/services/membershipService.ts",
    "src/lib/apiErrors.ts",
    "src/services/organizationService.ts",
    "src/services/organizationProfileService.ts",
  ];

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(name)) out.push(full);
    }
    return out;
  }

  it("never compares roleKey or a role literal in an if/ternary outside the allowed files", () => {
    const root = join(__dirname, "..");
    const offenders: string[] = [];
    for (const file of walk(join(root, "src"))) {
      const rel = file.slice(root.length + 1).replace(/\\/g, "/");
      if (ALLOWED.some((a) => rel.endsWith(a))) continue;
      const text = readFileSync(file, "utf8");
      const patterns = [
        /\broleKey\s*(===|!==|==|!=)\s*["']/,
        /["'][A-Z_]+["']\s*(===|!==|==|!=)\s*[\w.]*roleKey\b/,
        new RegExp(`\\.roleKey\\s*(===|!==)\\s*["'](${ROLE_KEYS.join("|")})["']`),
      ];
      if (patterns.some((p) => p.test(text))) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
