import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { DEV_FIXTURE_PASSWORD } from "../src/auth/devAccounts";
import { verifyPassword } from "../src/auth/password";
import { resolveActiveMembership } from "../src/repositories/memberships";
import { getUpcomingRenewals } from "../src/services/customerReportService";
import * as dealService from "../src/services/dealService";
import * as leadService from "../src/services/leadService";
import {
  DEV_ORGANIZATIONS,
  DEV_USERS,
  assertDevSeedAllowed,
  runDevSeed,
} from "../prisma/devSeed";
import { SAMPLE_DATA } from "../prisma/sampleData";

/**
 * FIG-1016 (B0.08): the dev seed gives a fresh database the dev accounts,
 * two organizations and the prototype's sample data in one command, can be
 * run again safely, and refuses to run anywhere near production.
 */

const ALLOWED = { NODE_ENV: "test", ALLOW_DEV_ACCOUNTS: "true" };

async function snapshot(slug: string) {
  const org = await adminDb.organization.findUniqueOrThrow({ where: { slug } });
  const where = { organizationId: org.id };
  return {
    org,
    counts: {
      companies: await adminDb.company.count({ where }),
      contacts: await adminDb.contact.count({ where }),
      leads: await adminDb.lead.count({ where }),
      deals: await adminDb.deal.count({ where }),
      tasks: await adminDb.task.count({ where }),
      activities: await adminDb.activity.count({ where }),
      notifications: await adminDb.notification.count({ where }),
      companyServices: await adminDb.companyService.count({ where }),
      handoffs: await adminDb.dealHandoff.count({ where }),
      memberships: await adminDb.membership.count({ where }),
    },
  };
}

beforeAll(async () => {
  await runDevSeed({ env: ALLOWED });
}, 120_000);

describe("guards", () => {
  it("refuses in production and without ALLOW_DEV_ACCOUNTS", () => {
    expect(() => assertDevSeedAllowed({ NODE_ENV: "production", ALLOW_DEV_ACCOUNTS: "true" })).toThrow(
      /NODE_ENV is production/,
    );
    expect(() => assertDevSeedAllowed({ NODE_ENV: "development" })).toThrow(/ALLOW_DEV_ACCOUNTS/);
    expect(() => assertDevSeedAllowed({ NODE_ENV: "development", ALLOW_DEV_ACCOUNTS: "yes" })).toThrow(
      /ALLOW_DEV_ACCOUNTS/,
    );
    expect(() => assertDevSeedAllowed({ NODE_ENV: "development", ALLOW_DEV_ACCOUNTS: "true" })).not.toThrow();
  });

  it("runDevSeed stops before touching anything when not allowed", async () => {
    const before = await adminDb.user.count();
    await expect(runDevSeed({ env: { NODE_ENV: "production", ALLOW_DEV_ACCOUNTS: "true" } })).rejects.toThrow(
      /production/,
    );
    await expect(runDevSeed({ env: { NODE_ENV: "development" } })).rejects.toThrow(/ALLOW_DEV_ACCOUNTS/);
    expect(await adminDb.user.count()).toBe(before);
  });

  it("the seed:dev command exits non-zero in production, and the plain seed creates no dev data", () => {
    const run = (script: string, env: Record<string, string>) => {
      try {
        const stdout = execFileSync("npx", ["tsx", script], {
          env: { ...process.env, ...env },
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          shell: true,
        });
        return { code: 0, out: stdout };
      } catch (err) {
        const e = err as { status: number; stderr: string; stdout: string };
        return { code: e.status, out: `${e.stdout}${e.stderr}` };
      }
    };
    const refused = run("prisma/seedDev.ts", { NODE_ENV: "production", ALLOW_DEV_ACCOUNTS: "true" });
    expect(refused.code).toBe(1);
    expect(refused.out).toMatch(/Refusing to run the dev seed/);

    // The production-safe seed: reference data only, exits 0, adds nothing.
    return adminDb.organization.count().then((before) => {
      const plain = run("prisma/seed.ts", { NODE_ENV: "production" });
      expect(plain.code).toBe(0);
      return adminDb.organization.count().then((after) => expect(after).toBe(before));
    });
  }, 90_000);
});

describe("accounts and organizations", () => {
  it("creates the six dev accounts with the right roles and the shared dev password", async () => {
    expect(DEV_USERS.map((u) => u.roleKey).sort()).toEqual(
      ["DELIVERY", "FINANCE", "MANAGEMENT", "RESTRICTED_TECHNICAL", "SALES", "SALES"],
    );
    for (const dev of DEV_USERS) {
      const user = await adminDb.user.findUniqueOrThrow({
        where: { email: dev.email },
        include: { memberships: { include: { role: true, organization: true } } },
      });
      expect(await verifyPassword(DEV_FIXTURE_PASSWORD, user.passwordHash!)).toBe(true);
      const main = user.memberships.find((m) => m.organization.slug === DEV_ORGANIZATIONS.main.slug);
      expect(main?.role.key).toBe(dev.roleKey);
      expect(main?.status).toBe("ACTIVE");
    }
  });

  it("makes Figbloom Digital Group each account's first organization and gives Management and one Sales user a sandbox too", async () => {
    const mgmt = await adminDb.user.findUniqueOrThrow({
      where: { email: "dev.management@figbloom.local" },
      include: { memberships: { include: { organization: true }, orderBy: { createdAt: "asc" } } },
    });
    expect(mgmt.memberships.map((m) => m.organization.slug)).toEqual(["figbloom", "figbloom-sandbox"]);
    expect(mgmt.memberships[0]!.organization.name).toBe("Figbloom Digital Group");
    expect(mgmt.memberships[1]!.organization.name).toBe("Figbloom Sandbox");

    const sandbox = await snapshot("figbloom-sandbox");
    expect(sandbox.counts.memberships).toBe(2);
    const delivery = await adminDb.membership.count({
      where: { user: { email: "dev.delivery@figbloom.local" } },
    });
    expect(delivery).toBe(1);
  });

  it("seeds the reference catalogues in both organizations (5 stages, 8 statuses, 15 sources, 11 lost reasons, 14 services, 6 lifecycle states)", async () => {
    for (const slug of ["figbloom", "figbloom-sandbox"]) {
      const { org } = await snapshot(slug);
      const where = { organizationId: org.id };
      expect(await adminDb.pipelineStage.count({ where })).toBe(5);
      expect(await adminDb.leadStatus.count({ where })).toBe(8);
      expect(await adminDb.leadSource.count({ where })).toBe(15);
      expect(await adminDb.lostReason.count({ where })).toBe(11);
      expect(await adminDb.service.count({ where })).toBe(14);
      expect(await adminDb.customerLifecycleState.count({ where })).toBe(6);
    }
  });
});

describe("sample data", () => {
  it("loads the prototype's records into the main organization, with the prototype's own counts", async () => {
    const { counts } = await snapshot("figbloom");
    expect(counts.contacts).toBe(SAMPLE_DATA.contacts.length);
    expect(counts.deals).toBe(SAMPLE_DATA.deals.length);
    expect(counts.leads).toBe(SAMPLE_DATA.leads.length);
    expect(counts.tasks).toBe(SAMPLE_DATA.tasks.length);
    // Leads the prototype shows without a company get a prospect company of the same name.
    const companylessLeads = SAMPLE_DATA.leads.filter((l) => !l.companyId).length;
    expect(counts.companies).toBe(SAMPLE_DATA.companies.length + companylessLeads);
    expect(counts.handoffs).toBe(SAMPLE_DATA.deals.filter((d) => d.handoff).length);
    expect(counts.activities).toBeGreaterThan(0);
    expect(counts.notifications).toBeGreaterThan(0);
  });

  it("covers every pipeline stage and lead state the screens show", async () => {
    const { org } = await snapshot("figbloom");
    const deals = await adminDb.deal.findMany({
      where: { organizationId: org.id },
      include: { pipelineStage: true, lostReason: true },
    });
    expect(new Set(deals.map((d) => d.pipelineStage.key))).toEqual(
      new Set(["SOLUTION_PRESENTED", "PROPOSAL_SENT", "NEGOTIATION", "CLOSED_WON", "CLOSED_LOST"]),
    );
    for (const d of deals.filter((d) => d.outcome === "WON")) {
      expect(d.wonAt).not.toBeNull();
      expect(d.pipelineStage.isWon).toBe(true);
    }
    const lost = deals.filter((d) => d.outcome === "LOST");
    expect(lost.length).toBeGreaterThan(0);
    expect(lost.every((d) => d.lostAt && d.lostReason)).toBe(true);

    const leads = await adminDb.lead.findMany({
      where: { organizationId: org.id },
      include: { leadStatus: true },
    });
    expect([...new Set(leads.map((l) => l.leadStatus.key))]).toEqual(
      expect.arrayContaining(["NEW", "CONTACTED", "QUALIFIED", "NEEDS_IDENTIFIED", "UNQUALIFIED", "CONVERTED", "LOST"]),
    );
    expect(leads.some((l) => l.ownerMembershipId === null)).toBe(true); // the shared pool
    expect(leads.some((l) => l.archivedAt !== null)).toBe(true);
    expect(leads.filter((l) => l.convertedAt).length).toBe(
      leads.filter((l) => l.leadStatus.key === "CONVERTED").length,
    );
  });

  it("shifts dates to the day the seed ran, so there are overdue and upcoming tasks and a renewal coming up", async () => {
    const { org } = await snapshot("figbloom");
    const tasks = await adminDb.task.findMany({ where: { organizationId: org.id } });
    const now = Date.now();
    expect(tasks.some((t) => t.status !== "COMPLETED" && t.dueAt && t.dueAt.getTime() < now)).toBe(true);
    expect(tasks.some((t) => t.dueAt && t.dueAt.getTime() > now)).toBe(true);
    expect(tasks.some((t) => t.status === "COMPLETED" && t.completedAt)).toBe(true);

    const mgmt = (await resolveActiveMembership(
      (await adminDb.user.findUniqueOrThrow({ where: { email: "dev.management@figbloom.local" } })).id,
      org.id,
    ))!;
    const renewals = await getUpcomingRenewals(mgmt, { withinDays: 365 });
    expect(renewals.items.length).toBeGreaterThan(0);
    expect(renewals.items.every((r) => r.endDate >= new Date(now - 400 * 86_400_000).toISOString().slice(0, 10))).toBe(true);
  });

  it("gives each salesperson only their own records through the real services", async () => {
    const { org } = await snapshot("figbloom");
    const ctxFor = async (email: string) =>
      (await resolveActiveMembership(
        (await adminDb.user.findUniqueOrThrow({ where: { email } })).id,
        org.id,
      ))!;
    const s1 = await ctxFor("dev.sales@figbloom.local");
    const s2 = await ctxFor("dev.sales2@figbloom.local");
    const mgmt = await ctxFor("dev.management@figbloom.local");

    const s1Leads = await leadService.listLeads(s1, { includeArchived: true });
    expect(s1Leads.length).toBeGreaterThan(0);
    // Own leads plus the shared pool of unassigned ones (B1.03), never a colleague's.
    expect(
      s1Leads.every(
        (l) => l.ownerMembershipId === s1.membershipId || l.ownerMembershipId === null,
      ),
    ).toBe(true);
    const s2Deals = await dealService.listDeals(s2);
    expect(s2Deals.length).toBeGreaterThan(0);
    expect(s2Deals.every((d) => d.ownerMembershipId === s2.membershipId)).toBe(true);
    const allDeals = await dealService.listDeals(mgmt);
    expect(allDeals).toHaveLength(SAMPLE_DATA.deals.length);
    expect(allDeals.some((d) => d.value !== null)).toBe(true);
  });

  it("notifies the people the prototype notifies, with a link to the record", async () => {
    const { org } = await snapshot("figbloom");
    const s1 = await adminDb.membership.findFirstOrThrow({
      where: { organizationId: org.id, user: { email: "dev.sales@figbloom.local" } },
    });
    const own = await adminDb.notification.findMany({
      where: { organizationId: org.id, membershipId: s1.id },
    });
    expect(own.length).toBeGreaterThan(0);
    const assigned = own.find((n) => n.type === "LEAD_ASSIGNED");
    expect(assigned?.link).toMatch(/^\/o\/figbloom\/leads\/[0-9a-f-]{36}$/);
    expect(assigned?.entityType).toBe("Lead");
  });

  it("keeps the sandbox to its own small slice of data", async () => {
    const main = await snapshot("figbloom");
    const sandbox = await snapshot("figbloom-sandbox");
    expect(sandbox.counts.companies).toBe(2);
    expect(sandbox.counts.leads).toBe(2);
    expect(sandbox.counts.deals).toBe(
      SAMPLE_DATA.deals.filter((d) => d.companyId === "c2" || d.companyId === "c3").length,
    );
    const names = (
      await adminDb.company.findMany({ where: { organizationId: sandbox.org.id } })
    ).map((c) => c.name).sort();
    expect(names).toEqual(["Sarova Hotels", "Two Rivers Mall"]);
    // The same company name exists in both organizations as separate records.
    const sarova = await adminDb.company.findMany({ where: { name: "Sarova Hotels", organizationId: { in: [main.org.id, sandbox.org.id] } } });
    expect(sarova).toHaveLength(2);
    expect(new Set(sarova.map((c) => c.organizationId)).size).toBe(2);
  });
});

describe("idempotency", () => {
  it("adds nothing when run again", async () => {
    const before = { main: await snapshot("figbloom"), sandbox: await snapshot("figbloom-sandbox") };
    const users = await adminDb.user.count();
    const again = await runDevSeed({ env: ALLOWED });
    expect(again.main.seeded).toBe(false);
    expect(again.sandbox.seeded).toBe(false);
    const after = { main: await snapshot("figbloom"), sandbox: await snapshot("figbloom-sandbox") };
    expect(after.main.counts).toEqual(before.main.counts);
    expect(after.sandbox.counts).toEqual(before.sandbox.counts);
    expect(await adminDb.user.count()).toBe(users);
  });

  it("skips the sample data for an organization that already has records, rather than duplicating them", async () => {
    const org = await adminDb.organization.findUniqueOrThrow({ where: { slug: "figbloom-sandbox" } });
    // Pretend an older dev database: records exist but there is no seed marker.
    await adminDb.organizationSetting.delete({
      where: { organizationId_key: { organizationId: org.id, key: "dev_seed" } },
    });
    const before = await snapshot("figbloom-sandbox");
    const result = await runDevSeed({ env: ALLOWED });
    expect(result.sandbox.seeded).toBe(false);
    expect((await snapshot("figbloom-sandbox")).counts).toEqual(before.counts);
    // Restore the marker so later runs behave as a normal re-run.
    await adminDb.organizationSetting.create({
      data: { organizationId: org.id, key: "dev_seed", value: { version: 2, seededAt: new Date().toISOString() } },
    });
  });
});
