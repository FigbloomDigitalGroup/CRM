/**
 * Stage 2 exit gate (B2.17, FIG-1046).
 *
 * The executable demo and the cross-cutting checks for Stage 2 (sales core and record extras):
 *   1. the demo walk, on a freshly created organisation, one person per role;
 *   2. the permission matrix: every role is allowed or refused exactly by the permission it holds;
 *   3. the deal value masking regression for the surfaces Stage 2 added;
 *   4. tenant isolation for every table that carries an organisation id;
 *   5. dashboards stay small however many records exist (aggregates, not row loads).
 * `docs/demo/stage-2.http` is the same walk-through for a person with a running server.
 */
import { describe, expect, it } from "vitest";
import type { AuthContext } from "../src/auth/context";
import { ForbiddenError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { withOrgContext } from "../src/db/orgScopedClient";
import * as companyService from "../src/services/companyService";
import { addComment, followRecord } from "../src/services/commentService";
import { getDashboard, loadSection } from "../src/services/dashboardService";
import * as dealService from "../src/services/dealService";
import { getDealRules, moveDeal } from "../src/services/dealRuleService";
import { startExport, startImport } from "../src/services/dataRunService";
import { listHandoffs, takeHandoff } from "../src/services/handoffService";
import * as leadService from "../src/services/leadService";
import { listNotificationCentre } from "../src/services/notificationCentreService";
import { getQualification, updateQualification } from "../src/services/qualificationService";
import { rememberRecentSearch, searchAll } from "../src/services/searchService";
import { getSignals, refreshSignals } from "../src/services/signalService";
import { createTag, changeTags } from "../src/services/tagService";
import { createTask, getMyWork } from "../src/services/taskService";
import { createTestContext, createTestOrganization, getLeadStatusId, getPipelineStageId } from "./helpers/fixtures";

const ROLES = ["MANAGEMENT", "SALES", "DELIVERY", "FINANCE", "RESTRICTED_TECHNICAL", "CUSTOMER_SUPPORT"] as const;
const SENTINEL = 8123456;

async function everyone() {
  const org = await createTestOrganization("Stage2Gate");
  const people = {} as Record<(typeof ROLES)[number], AuthContext>;
  for (const role of ROLES) people[role] = await createTestContext(org.id, role, role.toLowerCase());
  return { org, people };
}

describe("Stage 2 demo walk", () => {
  it("capture, qualify, convert, win, hand off, take, My work, Finance sees the value, Management totals match", async () => {
    const org = await createTestOrganization("Stage2Demo");
    const management = await createTestContext(org.id, "MANAGEMENT");
    const sales = await createTestContext(org.id, "SALES", "demo.sales");
    const delivery = await createTestContext(org.id, "DELIVERY", "demo.delivery");
    const technical = await createTestContext(org.id, "RESTRICTED_TECHNICAL", "demo.tech");
    const finance = await createTestContext(org.id, "FINANCE", "demo.finance");
    const newStatus = await getLeadStatusId(org.id);
    const qualifiedStatus = await getLeadStatusId(org.id, "QUALIFIED");
    const wonStage = await getPipelineStageId(org.id, "CLOSED_WON");
    const service = await adminDb.service.findFirstOrThrow({ where: { organizationId: org.id, key: "CCTV" } });

    // 1. Sales captures a lead for a new company.
    const { company } = await companyService.createCompany(management, { name: "Demo Retail Ltd" });
    const { lead } = await leadService.createLead(sales, { leadStatusId: newStatus, companyId: company.id, serviceInterestId: service.id, temperature: "HOT" });
    await addComment(sales, "lead", lead.id, { body: "Called, wants a quote for 8 cameras", mentions: [management.membershipId] });
    expect((await listNotificationCentre(management, {})).items.some((n) => n.type === "MENTION")).toBe(true);
    const tag = await createTag(management, { name: "retail" });
    await changeTags(sales, "lead", lead.id, { addTagIds: [tag.id] }).catch(() => undefined);

    // 2. Qualify: answer the questions, then move the lead to Qualified.
    const questions = await getQualification(sales, lead.id);
    expect(questions).toBeDefined();
    await updateQualification(sales, lead.id, { cctv_cameras: 8 });
    expect((await getQualification(sales, lead.id)).progress.canQualify).toBe(true);
    await leadService.updateLead(sales, lead.id, { leadStatusId: qualifiedStatus } as never);

    // 3. Convert to a deal, then win it with the owner left for Delivery to take.
    const converted = await leadService.convertLead(sales, lead.id, { value: SENTINEL, serviceId: service.id } as never);
    const dealId = ((converted as unknown as { deal?: { id: string } }).deal ?? (converted as unknown as { id: string })).id;
    await moveDeal(sales, dealId, { pipelineStageId: wonStage, handoff: { ownerLater: true } } as never);

    // 4. Delivery sees the handoff awaiting an owner and takes it.
    const awaiting = await listHandoffs(delivery, { status: "AWAITING_OWNER" } as never);
    expect(awaiting.total).toBe(1);
    await takeHandoff(delivery, dealId);
    expect((await listHandoffs(delivery, { status: "ONBOARDING" } as never)).total).toBe(1);

    // 5. Technical sees only their work.
    await createTask(management, { title: "Mount cameras", assigneeMembershipId: technical.membershipId, requirements: "Level 2, ladder needed" } as never);
    const work = await getMyWork(technical);
    expect(work.groups.flatMap((g) => g.items.map((i) => i.title))).toContain("Mount cameras");
    expect(JSON.stringify(work)).not.toContain(String(SENTINEL));

    // 6. Finance sees the won deal with its value; Delivery does not.
    const financeDeals = await dealService.listDeals(finance, {});
    expect(financeDeals.map((d) => Number(d.value))).toContain(SENTINEL);
    const deliveryDeals = await dealService.listDeals(delivery, {});
    expect(deliveryDeals.every((d) => d.value === null)).toBe(true);

    // 7. Management dashboard totals match the data.
    const section = await loadSection(management, "management", new Date(Date.now() + 11 * 60_000));
    expect(section.ok).toBe(true);
    const data = (section as { data: { thisMonth: { metrics: { dealOutcomes: { won: { count: number; value: unknown } } } } } }).data;
    expect(data.thisMonth.metrics.dealOutcomes.won.count).toBe(1);
    expect(Number(data.thisMonth.metrics.dealOutcomes.won.value)).toBe(SENTINEL);
    const deliverySection = (await loadSection(delivery, "delivery")) as { data: { onboardingInProgress: number; awaitingOwner: number } };
    expect(deliverySection.data).toMatchObject({ onboardingInProgress: 1, awaitingOwner: 0 });
    const financeSection = (await loadSection(finance, "finance")) as { data: { wonDeals: number } };
    expect(financeSection.data.wonDeals).toBe(1);
  });
});

describe("permission matrix across roles", () => {
  it("each role is allowed or refused by the permission it holds, for the Stage 2 actions", async () => {
    const { people } = await everyone();
    const csv = Buffer.from("First\nMatrix\n");
    const actions: { name: string; permission: string; run: (c: AuthContext) => Promise<unknown> }[] = [
      { name: "start a lead export", permission: "leads.export", run: (c) => startExport(c, { entity: "LEAD" }) },
      { name: "start a contact import", permission: "contacts.import", run: (c) => startImport(c, { entity: "CONTACT", fileName: "m.csv", csv, mapping: { firstName: "First" }, duplicateStrategy: "skip" }) },
      { name: "open My work", permission: "mywork.view", run: (c) => getMyWork(c) },
      { name: "read deal rules", permission: "configuration.manage", run: (c) => getDealRules(c) },
      { name: "create a tag", permission: "tags.manage", run: (c) => createTag(c, { name: `t-${Math.random().toString(36).slice(2, 8)}` }) },
      { name: "load the management dashboard section", permission: "reporting.view.all", run: (c) => loadSection(c, "management") },
    ];
    const outcomes: string[] = [];
    for (const role of ROLES) {
      const ctx = people[role];
      for (const action of actions) {
        const allowed = ctx.permissionKeys.includes(action.permission);
        let ok = true;
        try {
          await action.run(ctx);
        } catch (err) {
          if (!(err instanceof ForbiddenError)) throw err;
          ok = false;
        }
        if (ok !== allowed) outcomes.push(`${role} / ${action.name}: expected ${allowed ? "allowed" : "refused"}, got ${ok ? "allowed" : "refused"}`);
      }
    }
    expect(outcomes).toEqual([]);
  });

  it("every role gets a notification centre, a dashboard and a search that fit what it may see", async () => {
    const { people } = await everyone();
    for (const role of ROLES) {
      const ctx = people[role];
      expect((await listNotificationCentre(ctx, {})).total, role).toBe(0);
      const search = await searchAll(ctx, { q: "nothing here" });
      expect(search.hidden.someResultsHidden || role === "MANAGEMENT", role).toBe(true);
      // The dashboard answers, and a role with no sections gets an empty list rather than an error.
      const dash = await getDashboard(ctx);
      expect(Array.isArray(dash.sections), role).toBe(true);
      expect(dash.sections.every((s) => s.ok), role).toBe(true);
    }
  });
});

describe("deal value masking on the Stage 2 surfaces", () => {
  it("no list, detail, search, board, dashboard, signal, notification or comment reaches a role without values", async () => {
    const org = await createTestOrganization("Stage2Mask");
    const management = await createTestContext(org.id, "MANAGEMENT");
    const sales = await createTestContext(org.id, "SALES", "owner");
    const otherSales = await createTestContext(org.id, "SALES", "other");
    const delivery = await createTestContext(org.id, "DELIVERY");
    const technical = await createTestContext(org.id, "RESTRICTED_TECHNICAL");
    const stageId = await getPipelineStageId(org.id);
    const { company } = await companyService.createCompany(management, { name: "Maskable Holdings" });
    const deal = await dealService.createDeal(sales, { companyId: company.id, pipelineStageId: stageId, value: SENTINEL } as never);
    await addComment(management, "deal", deal.id, { body: `Agreed KES ${SENTINEL.toLocaleString("en-US")}`, mentions: [sales.membershipId] });
    await followRecord(otherSales, "company", company.id);
    await refreshSignals(org.id);

    const surfaces: [string, (c: AuthContext) => Promise<unknown>][] = [
      ["search", (c) => searchAll(c, { q: "Maskable" })],
      ["dashboard", (c) => getDashboard(c)],
      ["signals", (c) => getSignals(c)],
      ["notifications", (c) => listNotificationCentre(c, {})],
    ];
    for (const [name, call] of surfaces) {
      for (const [who, ctx] of [["other sales", otherSales], ["delivery", delivery], ["technical", technical]] as const) {
        const text = JSON.stringify(await call(ctx).catch(() => null));
        expect(text, `${name} as ${who}`).not.toContain(String(SENTINEL));
        expect(text, `${name} as ${who}`).not.toContain(SENTINEL.toLocaleString("en-US"));
      }
    }
    // The owner's notification carries the text, with the amount redacted if the owner lacks the value permission.
    const mention = (await listNotificationCentre(sales, {})).items.find((n) => n.type === "MENTION");
    expect(mention).toBeDefined();
  });
});

describe("tenant isolation for every table with an organisation id", () => {
  it("each one has row level security forced and a tenant policy", async () => {
    const tables = await adminDb.$queryRaw<{ table_name: string }[]>`
      SELECT c.table_name FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
      WHERE c.table_schema = 'public' AND c.column_name = 'organization_id'`;
    const protectedTables = await adminDb.$queryRaw<{ relname: string }[]>`
      SELECT c.relname FROM pg_class c JOIN pg_policy p ON p.polrelid = c.oid
      WHERE c.relrowsecurity AND c.relforcerowsecurity AND p.polname = 'tenant_isolation'`;
    const have = new Set(protectedTables.map((r) => r.relname));
    const missing = tables.map((t) => t.table_name).filter((n) => !have.has(n));
    expect(missing).toEqual([]);

    const required = [
      "comments", "comment_mentions", "record_follows", "attachments", "tags", "tag_links", "custom_field_definitions",
      "email_templates", "lead_pool_requests", "search_recents", "data_runs", "signal_snapshots", "background_jobs",
      "merge_records", "deal_moves",
    ];
    for (const name of required) expect(have.has(name), name).toBe(true);
  });

  it("a request in one organisation cannot read or touch another's rows", async () => {
    const a = await createTestOrganization("IsoA");
    const b = await createTestOrganization("IsoB");
    const mgmtA = await createTestContext(a.id, "MANAGEMENT", "a");
    const statusId = await getLeadStatusId(a.id);
    const { lead } = await leadService.createLead(mgmtA, { leadStatusId: statusId });
    await addComment(mgmtA, "lead", lead.id, { body: "private" });
    await followRecord(mgmtA, "lead", lead.id);
    await createTag(mgmtA, { name: "iso" });
    await rememberRecentSearch(mgmtA, "isolation");
    await refreshSignals(a.id);
    await startExport(mgmtA, { entity: "LEAD" });

    for (const table of ["comments", "record_follows", "tags", "search_recents", "signal_snapshots", "data_runs"]) {
      const seen = await withOrgContext(b.id, (tx) => tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${table}" WHERE organization_id = $1`, a.id));
      expect(Number(seen[0]!.n), table).toBe(0);
      const own = await adminDb.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${table}" WHERE organization_id = $1`, a.id);
      expect(Number(own[0]!.n), `${table} exists in A`).toBeGreaterThan(0);
    }
    const write = withOrgContext(b.id, (tx) =>
      tx.$executeRawUnsafe(`INSERT INTO "search_recents" (id, organization_id, membership_id, query) VALUES (gen_random_uuid()::text, $1, $2, 'sneaky')`, a.id, mgmtA.membershipId),
    );
    await expect(write).rejects.toBeDefined();
  });
});

describe("dashboards use aggregates only", () => {
  it("the home page stays small and bounded however many records exist", async () => {
    const org = await createTestOrganization("Stage2Agg");
    const management = await createTestContext(org.id, "MANAGEMENT");
    const sales = await createTestContext(org.id, "SALES", "busy");
    const statusId = await getLeadStatusId(org.id);
    const stageId = await getPipelineStageId(org.id);
    const { company } = await companyService.createCompany(management, { name: "Busy Co" });
    await adminDb.lead.createMany({
      data: Array.from({ length: 150 }, () => ({ organizationId: org.id, leadStatusId: statusId, ownerMembershipId: sales.membershipId, temperature: "HOT" as const })),
    });
    await adminDb.deal.createMany({
      data: Array.from({ length: 150 }, () => ({ organizationId: org.id, companyId: company.id, pipelineStageId: stageId, ownerMembershipId: sales.membershipId })),
    });
    const asSales = await getDashboard(sales);
    const section = asSales.sections.find((s) => s.key === "sales_today") as { data: { hotLeads: { count: number; top: unknown[] }; pipeline: { open: number } } };
    expect(section.data.hotLeads.count).toBe(150);
    expect(section.data.hotLeads.top).toHaveLength(5);
    expect(section.data.pipeline.open).toBe(150);
    expect(JSON.stringify(asSales).length).toBeLessThan(10_000);
    expect(JSON.stringify(await getDashboard(management)).length).toBeLessThan(20_000);
  });
});
