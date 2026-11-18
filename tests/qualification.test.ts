import { describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { ArchivedReadOnlyError, NotFoundError, ValidationError } from "../src/auth/errors";
import { GENERAL_QUESTIONS, SERVICE_QUESTIONS } from "../src/lib/qualificationDefaults";
import { updateCustomFieldDefinition } from "../src/services/customFieldService";
import * as leadService from "../src/services/leadService";
import { getQualification, updateQualification } from "../src/services/qualificationService";
import { createTestContext, createTestOrganization, getLeadStatusId } from "./helpers/fixtures";

async function serviceId(orgId: string, key: string) {
  return (await adminDb.service.findFirstOrThrow({ where: { organizationId: orgId, key } })).id;
}

async function leadFor(ctx: Awaited<ReturnType<typeof createTestContext>>, serviceKey: string | null, statusKey = "NEW") {
  const { lead } = await leadService.createLead(ctx, {
    leadStatusId: await getLeadStatusId(ctx.organizationId, statusKey),
    serviceInterestId: serviceKey ? await serviceId(ctx.organizationId, serviceKey) : undefined,
  });
  return lead;
}

/** The field-level issues of a rejected write. */
async function issuesOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ValidationError) return err.issues ?? [];
    throw err;
  }
  throw new Error("Expected the call to be rejected.");
}

describe("qualification questions (FIG-1030, B2.01)", () => {
  it("every one of the 14 seeded services has questions, copied into each organisation", async () => {
    const org = await createTestOrganization();
    const services = await adminDb.service.findMany({ where: { organizationId: org.id } });
    expect(services).toHaveLength(14);
    expect(Object.keys(SERVICE_QUESTIONS).sort()).toEqual(services.map((s) => s.key).sort());

    const defs = await adminDb.customFieldDefinition.findMany({ where: { organizationId: org.id, entityType: "LEAD", section: "QUALIFICATION" } });
    const expected = GENERAL_QUESTIONS.length + Object.values(SERVICE_QUESTIONS).reduce((n, q) => n + q.length, 0);
    expect(defs).toHaveLength(expected);
    // Service questions are tied to their service; general ones to none.
    expect(defs.filter((d) => d.serviceId === null)).toHaveLength(GENERAL_QUESTIONS.length);
    const cctv = defs.filter((d) => d.serviceId === services.find((s) => s.key === "CCTV")!.id);
    expect(cctv.map((d) => d.key).sort()).toEqual(SERVICE_QUESTIONS.CCTV!.map((q) => q.key).sort());
  });

  it("asks the general questions and only the questions of the lead's own service", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");
    const lead = await leadFor(ctx, "CCTV");
    const view = await getQualification(ctx, lead.id);
    const keys = view.questions.map((q) => q.key);
    expect(keys).toEqual(expect.arrayContaining(["budget_range", "decision_maker", "timeline", "cctv_cameras", "cctv_site_type", "cctv_site_visit"]));
    expect(keys).not.toContain("acct_users");
    expect(view.questions.find((q) => q.key === "cctv_site_type")!.options.map((o) => o.label)).toContain("Warehouse");

    const noService = await getQualification(ctx, (await leadFor(ctx, null)).id);
    expect(noService.questions.map((q) => q.key).sort()).toEqual(GENERAL_QUESTIONS.map((q) => q.key).sort());
  });

  it("blocks moving to Qualified until the required answers are in, with a field-level list; then allows it", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");
    const lead = await leadFor(ctx, "CCTV");
    const qualified = await getLeadStatusId(org.id, "QUALIFIED");

    const issues = await issuesOf(leadService.updateLead(ctx, lead.id, { leadStatusId: qualified }));
    expect(issues).toEqual([expect.objectContaining({ path: "qualificationData.cctv_cameras", code: "REQUIRED_ON_QUALIFY" })]);
    expect((await adminDb.lead.findUniqueOrThrow({ where: { id: lead.id } })).leadStatusId).not.toBe(qualified);

    const view = await getQualification(ctx, lead.id);
    expect(view.progress.canQualify).toBe(false);
    expect(view.progress.missing).toEqual([expect.objectContaining({ key: "cctv_cameras", label: "Number of cameras" })]);

    await updateQualification(ctx, lead.id, { cctv_cameras: "8" });
    const after = await leadService.updateLead(ctx, lead.id, { leadStatusId: qualified });
    expect(after.leadStatusId).toBe(qualified);
    expect((await getQualification(ctx, lead.id)).progress.qualified).toBe(true);
  });

  it("qualifies together with the answers in one update, and a service with no required answers qualifies freely", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");
    const qualified = await getLeadStatusId(org.id, "QUALIFIED");
    const withAnswers = await leadFor(ctx, "ACCOUNTING");
    const updated = await leadService.updateLead(ctx, withAnswers.id, { leadStatusId: qualified, qualificationData: { acct_users: 5 } });
    expect(updated.leadStatusId).toBe(qualified);
    expect(updated.qualificationData).toMatchObject({ acct_users: 5 });

    const noService = await leadFor(ctx, null);
    await expect(leadService.updateLead(ctx, noService.id, { leadStatusId: qualified })).resolves.toBeDefined();
  });

  it("Management can make another answer required, and a retired question no longer blocks", async () => {
    const org = await createTestOrganization();
    const management = await createTestContext(org.id, "MANAGEMENT");
    const lead = await leadFor(management, "HR");
    const qualified = await getLeadStatusId(org.id, "QUALIFIED");
    await updateQualification(management, lead.id, { hr_headcount: 40 });
    await expect(leadService.updateLead(management, lead.id, { leadStatusId: qualified })).resolves.toBeDefined();

    const lead2 = await leadFor(management, "HR");
    await updateQualification(management, lead2.id, { hr_headcount: 40 });
    const budget = await adminDb.customFieldDefinition.findFirstOrThrow({ where: { organizationId: org.id, key: "budget_range" } });
    await updateCustomFieldDefinition(management, budget.id, { requiredOnQualify: true });
    expect((await issuesOf(leadService.updateLead(management, lead2.id, { leadStatusId: qualified })))[0]).toMatchObject({ path: "qualificationData.budget_range" });
    await updateCustomFieldDefinition(management, budget.id, { isActive: false });
    await expect(leadService.updateLead(management, lead2.id, { leadStatusId: qualified })).resolves.toBeDefined();
  });

  it("changing the service re-evaluates the questions and keeps the earlier answers", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");
    const lead = await leadFor(ctx, "CCTV");
    await updateQualification(ctx, lead.id, { cctv_cameras: 12, decision_maker: "Ms Achieng" });

    await leadService.updateLead(ctx, lead.id, { serviceInterestId: await serviceId(org.id, "ACCOUNTING") });
    const accounting = await getQualification(ctx, lead.id);
    expect(accounting.questions.map((q) => q.key)).toContain("acct_users");
    expect(accounting.questions.map((q) => q.key)).not.toContain("cctv_cameras");
    expect(accounting.keptAnswers).toEqual([expect.objectContaining({ key: "cctv_cameras", answer: 12 })]);
    expect(accounting.questions.find((q) => q.key === "decision_maker")!.answer).toBe("Ms Achieng"); // general answers carry over
    expect((await adminDb.lead.findUniqueOrThrow({ where: { id: lead.id } })).qualificationData).toMatchObject({ cctv_cameras: 12 });

    // The question is for another service now: it cannot be answered here.
    expect((await issuesOf(updateQualification(ctx, lead.id, { cctv_cameras: 3 })))[0]).toMatchObject({ code: "FIELD_NOT_APPLICABLE" });

    await leadService.updateLead(ctx, lead.id, { serviceInterestId: await serviceId(org.id, "CCTV") });
    const back = await getQualification(ctx, lead.id);
    expect(back.questions.find((q) => q.key === "cctv_cameras")!.answer).toBe(12);
    expect(back.keptAnswers).toEqual([]);
  });

  it("validates answers by type and rejects unknown questions", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");
    const lead = await leadFor(ctx, "CCTV");
    const issues = await issuesOf(updateQualification(ctx, lead.id, { cctv_cameras: "lots", cctv_site_type: "Castle", made_up: "x", cctv_site_visit: "maybe" }));
    expect(issues.map((i) => [i.path, i.code]).sort()).toEqual([
      ["qualificationData.cctv_cameras", "INVALID_VALUE"],
      ["qualificationData.cctv_site_type", "INVALID_VALUE"],
      ["qualificationData.cctv_site_visit", "INVALID_VALUE"],
      ["qualificationData.made_up", "UNKNOWN_FIELD"],
    ]);
    // Nothing partial was saved.
    expect((await adminDb.lead.findUniqueOrThrow({ where: { id: lead.id } })).qualificationData).toBeNull();
  });

  it("clears an answer with null, merges with what is stored, and keeps keys the website form stored", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");
    const lead = await leadFor(ctx, "CCTV");
    await adminDb.lead.update({ where: { id: lead.id }, data: { qualificationData: { unmatchedService: "Drones", utm: { source: "fb" } } } });

    await updateQualification(ctx, lead.id, { cctv_cameras: 4, timeline: "this_month" });
    await updateQualification(ctx, lead.id, { cctv_cameras: null });
    const stored = (await adminDb.lead.findUniqueOrThrow({ where: { id: lead.id } })).qualificationData;
    expect(stored).toEqual({ unmatchedService: "Drones", utm: { source: "fb" }, timeline: "this_month" });
  });

  it("the legacy whole-object update validates known answers and passes other keys through", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");
    const lead = await leadFor(ctx, "CCTV");
    await expect(leadService.updateLead(ctx, lead.id, { qualificationData: { cctv_cameras: "x" } })).rejects.toBeInstanceOf(ValidationError);
    const ok = await leadService.updateLead(ctx, lead.id, { qualificationData: { cctv_cameras: 3, anything_else: { a: 1 } } });
    expect(ok.qualificationData).toEqual({ cctv_cameras: 3, anything_else: { a: 1 } });
  });

  it("audits qualification changes with before and after", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");
    const lead = await leadFor(ctx, "CCTV");
    await updateQualification(ctx, lead.id, { cctv_cameras: 4 });
    await updateQualification(ctx, lead.id, { cctv_cameras: 6 });
    await updateQualification(ctx, lead.id, { cctv_cameras: 6 }); // no change, no event
    const audit = await adminDb.auditEvent.findMany({ where: { organizationId: org.id, entityId: lead.id, action: "lead.qualification_updated" }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => [a.previousValue, a.newValue])).toEqual([
      [{ cctv_cameras: null }, { cctv_cameras: 4 }],
      [{ cctv_cameras: 4 }, { cctv_cameras: 6 }],
    ]);
  });

  it("describes the progress strip: done, current and to-do stages, and off-strip statuses", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");
    const stateOf = async (statusKey: string) => {
      const lead = await leadFor(ctx, null, statusKey);
      return getQualification(ctx, lead.id);
    };
    const contacted = await stateOf("CONTACTED");
    expect(contacted.progress.stages.map((s) => [s.key, s.state])).toEqual([
      ["NEW", "done"],
      ["CONTACTED", "current"],
      ["NEEDS_IDENTIFIED", "todo"],
      ["QUALIFIED", "todo"],
      ["CONVERTED", "todo"],
    ]);
    expect(contacted.progress.offStrip).toBeNull();

    const qualified = await stateOf("QUALIFIED");
    expect(qualified.progress.stages.find((s) => s.key === "QUALIFIED")!.state).toBe("current");
    expect(qualified.progress.qualified).toBe(true);

    const lost = await stateOf("LOST");
    expect(lost.progress.offStrip).toEqual({ key: "LOST", name: "Lost" });
    expect(lost.progress.stages.every((s) => s.state === "todo")).toBe(true);
  });

  it("Sales answers only their own leads; Management any; archived leads are read-only; other organisations see nothing", async () => {
    const org = await createTestOrganization();
    const owner = await createTestContext(org.id, "SALES", "owner");
    const other = await createTestContext(org.id, "SALES", "other");
    const management = await createTestContext(org.id, "MANAGEMENT");
    const lead = await leadFor(owner, "CCTV");

    await expect(getQualification(other, lead.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateQualification(other, lead.id, { cctv_cameras: 2 })).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateQualification(management, lead.id, { cctv_cameras: 2 })).resolves.toBeDefined();

    await leadService.archiveLead(management, lead.id);
    await expect(updateQualification(owner, lead.id, { cctv_cameras: 5 })).rejects.toBeInstanceOf(ArchivedReadOnlyError);

    const foreign = await createTestOrganization();
    const foreignCtx = await createTestContext(foreign.id, "MANAGEMENT");
    await expect(getQualification(foreignCtx, lead.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
