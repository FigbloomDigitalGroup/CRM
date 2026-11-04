import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { withOrgContext } from "../src/db/orgScopedClient";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { checkDealMove, getBoard, moveDeal } from "../src/services/dealRuleService";
import { decideApproval, requestDealMoveApproval, updateApprovalRules } from "../src/services/approvalService";
import { addPipelineStage, createPipeline, listPipelines, reorderPipelineStages, setStageRules, updatePipeline, updatePipelineStage } from "../src/services/pipelineService";
import { getQuoteSettings, updateQuoteSettings } from "../src/services/quoteService";
import * as dealService from "../src/services/dealService";
import { commercialWorld, stageIdFor } from "./commercialFixtures";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";

async function issuesOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ValidationError) return err.issues ?? [];
    throw err;
  }
  throw new Error("Expected the call to be rejected.");
}

const INSTALL = {
  name: "Installations",
  stages: [
    { name: "Site survey", probability: 15 },
    { name: "Solution Presented", probability: 25 },
    { name: "Closed Won", kind: "WON" as const },
    { name: "Closed Lost", kind: "LOST" as const },
  ],
};

describe("pipelines: migration of the default pipeline (FIG-1147, B6.15)", () => {
  it("gives every organisation one default pipeline holding all its stages, with no rules", async () => {
    expect(await adminDb.pipelineStage.count({ where: { pipelineId: null } })).toBe(0);
    const orgs = await adminDb.organization.findMany({ select: { id: true } });
    const defaults = await adminDb.pipeline.groupBy({ by: ["organizationId"], where: { isDefault: true }, _count: true });
    expect(defaults).toHaveLength(orgs.length);
    expect(defaults.every((d) => d._count === 1)).toBe(true);
    // A stage always belongs to a pipeline of its own organisation.
    const mismatched = await adminDb.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pipeline_stages s JOIN pipelines p ON p.id = s.pipeline_id WHERE p.organization_id <> s.organization_id`;
    expect(Number(mismatched[0]!.n)).toBe(0);
  });

  it("puts stages created the old way into the default pipeline, and a new organisation gets its default pipeline with it", async () => {
    const org = await createTestOrganization();
    const pipelines = await adminDb.pipeline.findMany({ where: { organizationId: org.id } });
    expect(pipelines).toHaveLength(1);
    expect(pipelines[0]).toMatchObject({ isDefault: true, key: "DEFAULT" });
    const stages = await adminDb.pipelineStage.findMany({ where: { organizationId: org.id } });
    expect(stages.length).toBeGreaterThanOrEqual(5);
    expect(stages.every((s) => s.pipelineId === pipelines[0]!.id)).toBe(true);
    const extra = await adminDb.pipelineStage.create({ data: { organizationId: org.id, key: "EXTRA", name: "Extra", sequence: 9 } });
    expect(extra.pipelineId).toBe(pipelines[0]!.id);
    // Only one default per organisation, and the default stays active.
    await expect(adminDb.pipeline.create({ data: { organizationId: org.id, key: "TWO", name: "Two", isDefault: true } })).rejects.toThrow();
    await expect(adminDb.pipeline.update({ where: { id: pipelines[0]!.id }, data: { isActive: false } })).rejects.toThrow();
  });

  it("turns an existing Proposal Sent quote setting into the same rule on that stage, without changing what it blocks", async () => {
    const w = await commercialWorld();
    await adminDb.organizationSetting.create({ data: { organizationId: w.org.id, key: "quotes.settings", value: { requireForProposalSent: true } } });
    const sql = readFileSync("prisma/migrations/20261107130000_pipelines_and_stage_rules/migration.sql", "utf8");
    // Only this organisation: the shared test database holds settings written by other tests.
    const statement = sql.slice(sql.indexOf('INSERT INTO "stage_rules"')).replace(/;\s*$/, ` AND s."organization_id" = '${w.org.id}';`);
    await adminDb.$executeRawUnsafe(statement);
    const proposal = await stageIdFor(w.org.id, "PROPOSAL_SENT");
    expect(await adminDb.stageRule.count({ where: { organizationId: w.org.id, stageId: proposal, type: "QUOTE_REQUIRED" } })).toBe(1);
    expect((await checkDealMove(w.sales, w.deal.id, { pipelineStageId: proposal })).blockers[0]).toMatchObject({ code: "QUOTE_REQUIRED" });
    expect(await getQuoteSettings(w.sales)).toMatchObject({ requireForProposalSent: true });
  });

  it("existing deals keep moving exactly as before when no pipeline or rule is added", async () => {
    const w = await commercialWorld();
    const negotiation = await stageIdFor(w.org.id, "NEGOTIATION");
    const moved = await moveDeal(w.sales, w.deal.id, { pipelineStageId: negotiation });
    expect(moved.deal.pipelineStageId).toBe(negotiation);
    const board = await getBoard(w.management);
    expect(board.columns.map((c) => c.stage.key)).toEqual(["SOLUTION_PRESENTED", "PROPOSAL_SENT", "NEGOTIATION", "CLOSED_WON", "CLOSED_LOST"]);
    expect(board.columns.find((c) => c.stage.key === "NEGOTIATION")!.count).toBe(1);
  });
});

describe("pipelines: managing them (FIG-1147)", () => {
  it("Management creates a pipeline with its own stages; everyone who works deals can read it", async () => {
    const w = await commercialWorld();
    const service = await adminDb.service.findFirstOrThrow({ where: { organizationId: w.org.id } });
    const created = await createPipeline(w.management, { ...INSTALL, serviceIds: [service.id] });
    expect(created).toMatchObject({ key: "INSTALLATIONS", isDefault: false, isActive: true, serviceIds: [service.id] });
    expect(created.stages.map((s) => [s.name, s.isWon, s.isLost])).toEqual([["Site survey", false, false], ["Solution Presented", false, false], ["Closed Won", true, false], ["Closed Lost", false, true]]);
    expect(created.stages[0]!.key).toBe("INSTALLATIONS_SITE_SURVEY");
    expect(created.stages[2]).toMatchObject({ probability: 100 });

    const asSales = await listPipelines(w.sales);
    expect(asSales.items.map((p) => p.name)).toEqual(["Sales", "Installations"]);
    await expect(createPipeline(w.sales, INSTALL)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listPipelines(await createTestContext(w.org.id, "RESTRICTED_TECHNICAL"))).rejects.toBeInstanceOf(ForbiddenError);

    // The default pipeline is untouched.
    const board = await getBoard(w.management);
    expect(board.columns).toHaveLength(5);
    const other = await getBoard(w.management, {}, created.id);
    expect(other.columns.map((c) => c.stage.name)).toEqual(["Site survey", "Solution Presented", "Closed Won", "Closed Lost"]);
  });

  it("validates stage sets and names, and keeps stage keys unique across pipelines", async () => {
    const w = await commercialWorld();
    const bad = await issuesOf(createPipeline(w.management, { name: " ", stages: [{ name: "Only open" }, { name: "Also won", kind: "WON" }, { name: "Won again", kind: "WON" }] }));
    expect(bad.map((i) => i.path)).toEqual(expect.arrayContaining(["name", "stages"]));
    expect((await issuesOf(createPipeline(w.management, { name: "Sales", stages: INSTALL.stages })))[0]).toMatchObject({ code: "DUPLICATE_PIPELINE" });
    expect((await issuesOf(createPipeline(w.management, { ...INSTALL, serviceIds: ["nope"] })))[0]).toMatchObject({ code: "UNKNOWN_SERVICE" });
    const one = await createPipeline(w.management, INSTALL);
    const two = await createPipeline(w.management, { name: "Installations 2", stages: INSTALL.stages });
    const keys = [...one.stages, ...two.stages].map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("adds, edits and reorders stages; won and lost stay last; a stage with open deals cannot be switched off", async () => {
    const w = await commercialWorld();
    const p = await createPipeline(w.management, INSTALL);
    const withNew = await addPipelineStage(w.management, p.id, { name: "Quote visit", probability: 40, position: 1 });
    expect(withNew.stages.map((s) => s.name)).toEqual(["Site survey", "Quote visit", "Solution Presented", "Closed Won", "Closed Lost"]);
    expect((await issuesOf(addPipelineStage(w.management, p.id, { name: "quote VISIT" })))[0]).toMatchObject({ code: "DUPLICATE_STAGE" });
    expect((await issuesOf(addPipelineStage(w.management, p.id, { name: "Won 2", kind: "WON" })))[0]).toMatchObject({ code: "STAGES_INVALID" });

    const open = withNew.stages.filter((s) => !s.isWon && !s.isLost).map((s) => s.id);
    const reordered = await reorderPipelineStages(w.management, p.id, [...open].reverse());
    expect(reordered.stages.map((s) => s.name)).toEqual(["Solution Presented", "Quote visit", "Site survey", "Closed Won", "Closed Lost"]);
    expect((await issuesOf(reorderPipelineStages(w.management, p.id, open.slice(1))))[0]).toMatchObject({ code: "STAGES_INVALID" });

    const survey = reordered.stages.find((s) => s.name === "Site survey")!;
    await updatePipelineStage(w.management, p.id, survey.id, { name: "Survey visit", probability: 20, stalledAfterDays: 5 });
    // A deal in the stage stops it being switched off.
    const deal = await dealService.createDeal(w.sales, { companyId: w.company.id, pipelineStageId: survey.id, value: 1000 });
    expect((await issuesOf(updatePipelineStage(w.management, p.id, survey.id, { isActive: false })))[0]).toMatchObject({ code: "STAGE_HAS_DEALS" });
    const wonStage = reordered.stages.find((s) => s.isWon)!;
    expect((await issuesOf(updatePipelineStage(w.management, p.id, wonStage.id, { isActive: false })))[0]).toMatchObject({ code: "STAGE_LOCKED" });
    await expect(updatePipelineStage(w.management, w.org.id, survey.id, { name: "x" })).rejects.toBeInstanceOf(NotFoundError);
    void deal;
  });

  it("the default pipeline cannot be switched off, a pipeline with open deals cannot, and a service belongs to one pipeline", async () => {
    const w = await commercialWorld();
    const service = await adminDb.service.findFirstOrThrow({ where: { organizationId: w.org.id } });
    const list = await listPipelines(w.management);
    const def = list.items[0]!;
    expect((await issuesOf(updatePipeline(w.management, def.id, { isActive: false })))[0]).toMatchObject({ code: "DEFAULT_PIPELINE" });
    expect(def.stages.length).toBeGreaterThanOrEqual(5);

    const a = await createPipeline(w.management, { ...INSTALL, serviceIds: [service.id] });
    const b = await createPipeline(w.management, { name: "Retail", stages: INSTALL.stages });
    await updatePipeline(w.management, b.id, { serviceIds: [service.id] });
    expect((await listPipelines(w.management)).items.find((p) => p.id === a.id)!.serviceIds).toEqual([]);
    expect((await listPipelines(w.management)).items.find((p) => p.id === b.id)!.serviceIds).toEqual([service.id]);

    await dealService.createDeal(w.sales, { companyId: w.company.id, pipelineStageId: a.stages[0]!.id, value: 1 });
    expect((await issuesOf(updatePipeline(w.management, a.id, { isActive: false })))[0]).toMatchObject({ code: "PIPELINE_HAS_DEALS" });
    expect((await updatePipeline(w.management, b.id, { isActive: false })).isActive).toBe(false);
    expect((await issuesOf(updatePipeline(w.management, b.id, { isDefault: true })))[0]).toMatchObject({ code: "PIPELINE_INACTIVE" });
    const made = await updatePipeline(w.management, a.id, { isDefault: true });
    expect(made.isDefault).toBe(true);
    expect((await listPipelines(w.management)).items.filter((p) => p.isDefault).map((p) => p.name)).toEqual(["Installations"]);
  });
});

describe("pipelines: stage rules block a move with a reason (FIG-1147)", () => {
  async function world() {
    const w = await commercialWorld();
    const managementTwo = await createTestContext(w.org.id, "MANAGEMENT");
    const pipelines = (await listPipelines(w.management)).items;
    const def = pipelines[0]!;
    const stage = (key: string) => def.stages.find((s) => s.key === key)!;
    return { ...w, managementTwo, def, stage };
  }

  it("blocks Proposal Sent without a valid quote and without the required fields, all reasons at once, and never moves the deal", async () => {
    const w = await world();
    const proposal = w.stage("PROPOSAL_SENT");
    const out = await setStageRules(w.management, w.def.id, proposal.id, [{ type: "QUOTE_REQUIRED" }, { type: "REQUIRED_FIELDS", fields: ["expectedCloseDate", "primaryContactId"] }]);
    expect(out.rules.map((r) => r.type).sort()).toEqual(["QUOTE_REQUIRED", "REQUIRED_FIELDS"]);
    expect(out.impact).toContain("2 rules");
    expect(out.impact).toContain("not moved or changed");

    const check = await checkDealMove(w.sales, w.deal.id, { pipelineStageId: proposal.id });
    expect(check.allowed).toBe(false);
    expect(check.blockers.map((b) => b.code)).toEqual(["QUOTE_REQUIRED", "REQUIRED_FIELDS_MISSING"]);
    expect(check.blockers[1]).toMatchObject({ fields: ["expectedCloseDate", "primaryContactId"], field: "pipelineStageId" });
    expect(check.blockers[1]!.message).toBe("Proposal Sent needs Expected close date and Primary contact filled in first.");
    expect(check.blockers[0]!.message).toContain("Proposal Sent needs a valid quote");
    const err = await moveDeal(w.sales, w.deal.id, { pipelineStageId: proposal.id }).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.issues.map((i: { code: string }) => i.code)).toEqual(["QUOTE_REQUIRED", "REQUIRED_FIELDS_MISSING"]);
    expect((await adminDb.deal.findUniqueOrThrow({ where: { id: w.deal.id } })).pipelineStageId).toBe(w.stageId);

    // Fill the fields and add the quote: the move goes through.
    const contact = await adminDb.contact.create({ data: { organizationId: w.org.id, firstName: "Grace", companyId: w.company.id } });
    await dealService.updateDeal(w.sales, w.deal.id, { primaryContactId: contact.id, expectedCloseDate: "2027-01-31" });
    const { createQuote } = await import("../src/services/quoteService");
    const { transitionVersion } = await import("../src/services/quoteService");
    const { quote } = await createQuote(w.sales, w.deal.id, { lines: [{ catalogueItemId: w.camera.id, quantity: 1 }] });
    expect((await checkDealMove(w.sales, w.deal.id, { pipelineStageId: proposal.id })).blockers.map((b) => b.code)).toEqual(["QUOTE_NOT_APPROVED"]);
    const versionId = (await adminDb.quoteVersion.findFirstOrThrow({ where: { quoteId: quote.id } })).id;
    await transitionVersion(w.org.id, versionId, ["DRAFT"], "APPROVED", { lock: true });
    expect((await moveDeal(w.sales, w.deal.id, { pipelineStageId: proposal.id })).deal.pipelineStageId).toBe(proposal.id);
  });

  it("checks custom fields, and refuses unknown fields, a rule on a lost stage and duplicate rules", async () => {
    const w = await world();
    await adminDb.customFieldDefinition.create({ data: { organizationId: w.org.id, entityType: "DEAL", key: "site_count", label: "Number of sites", fieldType: "NUMBER" } });
    const negotiation = w.stage("NEGOTIATION");
    await setStageRules(w.management, w.def.id, negotiation.id, [{ type: "REQUIRED_FIELDS", fields: ["custom:site_count", "notes"] }]);
    const check = await checkDealMove(w.sales, w.deal.id, { pipelineStageId: negotiation.id });
    expect(check.blockers[0]).toMatchObject({ code: "REQUIRED_FIELDS_MISSING", fields: ["custom:site_count", "notes"] });
    expect(check.blockers[0]!.message).toBe("Negotiation needs Number of sites and Notes filled in first.");
    await dealService.updateDeal(w.sales, w.deal.id, { notes: "Visit booked", customFields: { site_count: 3 } });
    expect((await checkDealMove(w.sales, w.deal.id, { pipelineStageId: negotiation.id })).allowed).toBe(true);

    expect((await issuesOf(setStageRules(w.management, w.def.id, negotiation.id, [{ type: "REQUIRED_FIELDS", fields: ["colour"] }])))[0]).toMatchObject({ code: "UNKNOWN_FIELD" });
    expect((await issuesOf(setStageRules(w.management, w.def.id, negotiation.id, [{ type: "REQUIRED_FIELDS", fields: [] }])))[0]).toMatchObject({ code: "FIELDS_REQUIRED" });
    expect((await issuesOf(setStageRules(w.management, w.def.id, negotiation.id, [{ type: "NOPE" }])))[0]).toMatchObject({ code: "UNKNOWN_RULE" });
    expect((await issuesOf(setStageRules(w.management, w.def.id, negotiation.id, [{ type: "QUOTE_REQUIRED" }, { type: "QUOTE_REQUIRED" }])))[0]).toMatchObject({ code: "DUPLICATE_RULE" });
    expect((await issuesOf(setStageRules(w.management, w.def.id, w.stage("CLOSED_LOST").id, [{ type: "QUOTE_REQUIRED" }])))[0]).toMatchObject({ code: "STAGE_LOCKED" });
    await expect(setStageRules(w.sales, w.def.id, negotiation.id, [])).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setStageRules(w.management, w.def.id, "nope", [])).rejects.toBeInstanceOf(NotFoundError);
    // Closed Lost still always needs a reason.
    const lost = await checkDealMove(w.sales, w.deal.id, { pipelineStageId: w.stage("CLOSED_LOST").id });
    expect(lost.blockers[0]).toMatchObject({ code: "LOST_REASON_REQUIRED" });
  });

  it("an approval rule makes the move wait for an approver; approval makes the move; a disabled rule blocks nothing", async () => {
    const w = await world();
    const negotiation = w.stage("NEGOTIATION");
    await setStageRules(w.management, w.def.id, negotiation.id, [{ type: "APPROVAL_REQUIRED" }]);
    const check = await checkDealMove(w.sales, w.deal.id, { pipelineStageId: negotiation.id });
    expect(check.blockers[0]).toMatchObject({ code: "APPROVAL_REQUIRED" });
    expect(check.blockers[0]!.message).toBe("Negotiation needs approval before a deal can move there. Ask for approval from the deal.");

    const item = await requestDealMoveApproval(w.sales, w.deal.id, { pipelineStageId: negotiation.id, note: "Client agreed on the phone" });
    expect(item.title).toContain("move to Negotiation");
    const decided = await decideApproval(w.managementTwo, item.id, { approve: true });
    expect(decided).toMatchObject({ status: "APPROVED", resumed: true });
    expect((await adminDb.deal.findUniqueOrThrow({ where: { id: w.deal.id } })).pipelineStageId).toBe(negotiation.id);

    // A disabled rule blocks nothing; an approval is not asked for a move that needs none.
    const other = await dealService.createDeal(w.sales, { companyId: w.company.id, pipelineStageId: w.stageId, value: 5 });
    await setStageRules(w.management, w.def.id, negotiation.id, [{ type: "APPROVAL_REQUIRED", enabled: false }]);
    expect((await checkDealMove(w.sales, other.id, { pipelineStageId: negotiation.id })).allowed).toBe(true);
    expect((await issuesOf(requestDealMoveApproval(w.sales, other.id, { pipelineStageId: negotiation.id })))[0]).toMatchObject({ code: "APPROVAL_NOT_NEEDED" });
    void updateApprovalRules;
  });

  it("refuses a move into another pipeline unless the caller says it is changing the pipeline, and then applies that stage rules", async () => {
    const w = await world();
    const p = await createPipeline(w.management, INSTALL);
    const survey = p.stages[0]!;
    const check = await checkDealMove(w.sales, w.deal.id, { pipelineStageId: survey.id });
    expect(check.blockers[0]).toMatchObject({ code: "WRONG_PIPELINE" });
    await setStageRules(w.management, p.id, survey.id, [{ type: "REQUIRED_FIELDS", fields: ["notes"] }]);
    const changing = await checkDealMove(w.sales, w.deal.id, { pipelineStageId: survey.id, changePipeline: true });
    expect(changing.blockers.map((b) => b.code)).toEqual(["REQUIRED_FIELDS_MISSING"]);
    await dealService.updateDeal(w.sales, w.deal.id, { notes: "Survey booked" });
    const moved = await moveDeal(w.sales, w.deal.id, { pipelineStageId: survey.id, changePipeline: true });
    expect(moved.deal.pipelineStageId).toBe(survey.id);
    // A move inside the new pipeline needs no flag.
    expect((await checkDealMove(w.sales, w.deal.id, { pipelineStageId: p.stages[1]!.id })).allowed).toBe(true);
  });

  it("leaves V1 organisations alone, keeps rules inside their organisation, and audits changes", async () => {
    const v1 = await createTestOrganization();
    const management = await createTestContext(v1.id, "MANAGEMENT");
    await expect(listPipelines(management)).rejects.toThrow(/not available/i);
    await expect(createPipeline(management, INSTALL)).rejects.toThrow(/not available/i);

    const a = await world();
    const b = await world();
    const stage = a.stage("PROPOSAL_SENT");
    await setStageRules(a.management, a.def.id, stage.id, [{ type: "REQUIRED_FIELDS", fields: ["notes"] }]);
    await expect(setStageRules(b.management, a.def.id, stage.id, [])).rejects.toBeInstanceOf(NotFoundError);
    await expect(getBoard(b.management, {}, a.def.id)).resolves.toMatchObject({ columns: [] });
    expect((await listPipelines(b.management)).items.flatMap((p) => p.stages.flatMap((s) => s.rules))).toEqual([]);
    expect(await withOrgContext(b.org.id, (tx) => tx.stageRule.findMany({ where: { organizationId: a.org.id } }))).toEqual([]);
    await expect(withOrgContext(b.org.id, (tx) => tx.stageRule.create({ data: { organizationId: a.org.id, stageId: stage.id, type: "QUOTE_REQUIRED" } }))).rejects.toThrow();
    expect(await adminDb.auditEvent.count({ where: { organizationId: a.org.id, action: "stage_rules.updated" } })).toBe(1);
    // The old quote setting is the same rule: switching it off removes the rule on Proposal Sent only.
    await updateQuoteSettings(a.management, { requireForProposalSent: true });
    expect(await adminDb.stageRule.count({ where: { organizationId: a.org.id, type: "QUOTE_REQUIRED" } })).toBe(1);
    await updateQuoteSettings(a.management, { requireForProposalSent: false });
    expect(await adminDb.stageRule.count({ where: { organizationId: a.org.id, type: "QUOTE_REQUIRED" } })).toBe(0);
    expect(await adminDb.stageRule.count({ where: { organizationId: a.org.id, type: "REQUIRED_FIELDS" } })).toBe(1);
  });
});
