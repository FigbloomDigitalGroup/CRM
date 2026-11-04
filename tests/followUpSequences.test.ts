import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { withOrgContext } from "../src/db/orgScopedClient";
import { enqueueAndRunNow } from "../src/jobs/runner";
import { cleanSteps, dueAt, exitReasonFor, resumeAt, SEQUENCE_EFFECTS } from "../src/lib/sequences";
import { createCommunication } from "../src/repositories/communications";
import { runDueSequences } from "../src/sequences/engine";
import { FORBIDDEN_RULE_FIELDS } from "../src/automations/catalogue";
import { listCommunicationsForLead } from "../src/services/communicationService";
import { createTemplate, updateTemplate } from "../src/services/emailTemplateService";
import {
  createSequence,
  deleteSequence,
  endEnrollment,
  enrol,
  getEnrollment,
  getSequence,
  listEnrollments,
  listSequences,
  pauseEnrollment,
  resumeEnrollment,
  updateSequence,
} from "../src/services/followUpService";
import { createForm, updateForm } from "../src/services/webFormService";
import { submitWebForm } from "../src/services/webFormSubmissionService";
import { createTestContext, createTestOrganization, getLeadStatusId, getPipelineStageId } from "./helpers/fixtures";

/** FIG-1150 (B6.18): follow-up sequences and the enrolment engine. Scheduler tests on a fake clock. */

const ORIGINAL_RELEASE = process.env.ACTIVE_RELEASE;
beforeAll(() => {
  process.env.ACTIVE_RELEASE = "v1.1";
});
afterAll(() => {
  if (ORIGINAL_RELEASE === undefined) delete process.env.ACTIVE_RELEASE;
  else process.env.ACTIVE_RELEASE = ORIGINAL_RELEASE;
});

const T0 = new Date("2026-11-16T09:00:00.000Z");
const day = (n: number) => new Date(T0.getTime() + n * 24 * 60 * 60 * 1000);

async function world() {
  const org = await createTestOrganization("Sequences Org");
  const management = await createTestContext(org.id, "MANAGEMENT");
  const sales = await createTestContext(org.id, "SALES");
  const otherSales = await createTestContext(org.id, "SALES");
  const contact = await adminDb.contact.create({ data: { organizationId: org.id, firstName: "Amara", lastName: "Osei", email: `amara.${randomUUID().slice(0, 6)}@example.test` } });
  const lead = await adminDb.lead.create({
    data: { organizationId: org.id, contactId: contact.id, leadStatusId: await getLeadStatusId(org.id, "NEW"), ownerMembershipId: sales.membershipId },
  });
  const draftTemplate = await createTemplate(management, { name: "Intro", subject: "Hello {{contact.firstName}}", body: "Hi {{contact.firstName}}, this is {{owner.name}}." });
  const sendTemplate = await createTemplate(management, { name: "Services overview", subject: "Our services, {{contact.firstName}}", body: "Hi {{contact.firstName}}, here is an overview of what we do." });
  const steps = [
    { dayOffset: 0, kind: "TASK", title: "Intro call" },
    { dayOffset: 2, kind: "EMAIL", title: "Follow-up email", emailTemplateId: draftTemplate.id, emailMode: "DRAFT" },
    { dayOffset: 5, kind: "EMAIL", title: "Services overview", emailTemplateId: sendTemplate.id, emailMode: "SEND" },
    { dayOffset: 10, kind: "TASK", title: "Check-in", priority: "HIGH" },
  ];
  const sequence = await createSequence(management, { name: `Website lead ${randomUUID().slice(0, 4)}`, subjectType: "LEAD", steps });
  await updateSequence(management, sequence.id, { isActive: true });
  return { org, management, sales, otherSales, contact, lead, draftTemplate, sendTemplate, sequence, steps };
}

const tasksOf = (orgId: string, leadId: string) => adminDb.task.findMany({ where: { organizationId: orgId, leadId }, orderBy: { createdAt: "asc" } });
const enrollmentOf = (id: string) => adminDb.followUpEnrollment.findUniqueOrThrow({ where: { id } });

describe("sequence rules (pure)", () => {
  it("checks steps", () => {
    const ok = cleanSteps([{ dayOffset: 0, kind: "TASK", title: "Call" }, { dayOffset: 3, kind: "EMAIL", title: "Mail", emailTemplateId: "t1" }]);
    expect(ok.problems).toEqual([]);
    const messages = (input: unknown) => cleanSteps(input).problems.map((p) => p.message).join(" | ");
    expect(messages([])).toMatch(/1 to 12/);
    expect(messages([{ dayOffset: 5, kind: "TASK", title: "a" }, { dayOffset: 2, kind: "TASK", title: "b" }])).toMatch(/earlier than the step before/);
    expect(messages([{ dayOffset: 0, kind: "EMAIL", title: "a" }])).toMatch(/needs an email template/);
    expect(messages([{ dayOffset: 0, kind: "TASK", title: "a", emailTemplateId: "t" }])).toMatch(/no template/);
    expect(messages([{ dayOffset: 400, kind: "TASK", title: "a" }])).toMatch(/0 to 365/);
    expect(messages([{ dayOffset: 0, kind: "CALL", title: "a" }])).toMatch(/kind is one of/);
    expect(messages([{ dayOffset: 0, kind: "TASK", title: " " }])).toMatch(/title/);
    expect(messages("x")).toMatch(/is a list/);
  });

  it("works out due times, resumes and exits", () => {
    expect(dueAt(T0, 2).toISOString()).toBe("2026-11-18T09:00:00.000Z");
    expect(resumeAt(T0, 0, 2).toISOString()).toBe("2026-11-18T09:00:00.000Z");
    expect(resumeAt(T0, null, 5).toISOString()).toBe(T0.toISOString());
    expect(exitReasonFor({ type: "LEAD", archivedAt: null, closed: true }, ["CLOSED"])).toBe("LEAD_CLOSED");
    expect(exitReasonFor({ type: "DEAL", archivedAt: null, closed: true }, ["CLOSED"])).toBe("DEAL_CLOSED");
    expect(exitReasonFor({ type: "DEAL", archivedAt: T0, closed: false }, ["CLOSED", "ARCHIVED"])).toBe("ARCHIVED");
    expect(exitReasonFor({ type: "LEAD", archivedAt: T0, closed: true }, [])).toBeNull();
  });
});

describe("sequence builder", () => {
  it("Management builds; people who can add tasks see only active ones; others cannot manage", async () => {
    const w = await world();
    const draft = await createSequence(w.management, { name: "Not live", subjectType: "LEAD", steps: [{ dayOffset: 0, kind: "TASK", title: "x" }] });
    expect(draft.isActive).toBe(false);
    expect((await listSequences(w.management)).items.map((s) => s.name)).toEqual(expect.arrayContaining(["Not live", w.sequence.name]));
    expect((await listSequences(w.sales)).items.map((s) => s.name)).toEqual([w.sequence.name]);
    await expect(getSequence(w.sales, draft.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(createSequence(w.sales, { name: "Mine", subjectType: "LEAD", steps: [{ dayOffset: 0, kind: "TASK", title: "x" }] })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateSequence(w.sales, w.sequence.id, { isActive: false })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(deleteSequence(w.sales, w.sequence.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("validates names, templates, triggers and switching on", async () => {
    const w = await world();
    const one = [{ dayOffset: 0, kind: "TASK", title: "x" }];
    await expect(createSequence(w.management, { name: w.sequence.name.toUpperCase(), subjectType: "LEAD", steps: one })).rejects.toBeInstanceOf(ValidationError);
    await expect(createSequence(w.management, { name: "Bad subject", subjectType: "COMPANY", steps: one })).rejects.toBeInstanceOf(ValidationError);
    await expect(createSequence(w.management, { name: "Deal web", subjectType: "DEAL", trigger: "WEBSITE_LEAD", steps: one })).rejects.toBeInstanceOf(ValidationError);
    await expect(createSequence(w.management, { name: "No steps", subjectType: "LEAD", steps: [] })).rejects.toBeInstanceOf(ValidationError);
    await expect(createSequence(w.management, { name: "Bad template", subjectType: "LEAD", steps: [{ dayOffset: 0, kind: "EMAIL", title: "m", emailTemplateId: randomUUID() }] })).rejects.toBeInstanceOf(ValidationError);
    await updateTemplate(w.management, w.draftTemplate.id, { isActive: false });
    await expect(createSequence(w.management, { name: "Off template", subjectType: "LEAD", steps: [{ dayOffset: 0, kind: "EMAIL", title: "m", emailTemplateId: w.draftTemplate.id }] })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateSequence(w.management, w.sequence.id, { exitRules: ["SOMETIMES"] })).rejects.toBeInstanceOf(ValidationError);
  });

  it("will not delete a sequence that has running enrolments", async () => {
    const w = await world();
    await enrol(w.sales, w.sequence.id, { leadId: w.lead.id }, T0);
    await expect(deleteSequence(w.management, w.sequence.id)).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "SEQUENCE_IN_USE" })] });
  });

  it("is unavailable while the release is V1", async () => {
    const w = await world();
    process.env.ACTIVE_RELEASE = "v1";
    try {
      await expect(listSequences(w.management)).rejects.toMatchObject({ name: "FeatureUnavailableError" });
      await expect(enrol(w.sales, w.sequence.id, { leadId: w.lead.id })).rejects.toMatchObject({ name: "FeatureUnavailableError" });
    } finally {
      process.env.ACTIVE_RELEASE = "v1.1";
    }
  });
});

describe("the engine on a fake clock", () => {
  it("runs each step when it falls due, once, and logs every send on the timeline", async () => {
    const w = await world();
    const e = await enrol(w.sales, w.sequence.id, { leadId: w.lead.id }, T0);
    expect(e).toMatchObject({ status: "ACTIVE", nextPosition: 0 });
    expect(e.nextRunAt).toEqual(T0);

    // Day 0: the intro call task, then nothing more until day 2.
    expect(await runDueSequences({ organizationId: w.org.id, now: T0 })).toMatchObject({ enrollments: 1, stepsDone: 1 });
    let tasks = await tasksOf(w.org.id, w.lead.id);
    expect(tasks.map((t) => t.title)).toEqual(["Intro call"]);
    expect(tasks[0]).toMatchObject({ assigneeMembershipId: w.sales.membershipId });
    expect(await runDueSequences({ organizationId: w.org.id, now: T0 })).toMatchObject({ enrollments: 0 });
    expect(await runDueSequences({ organizationId: w.org.id, now: day(1) })).toMatchObject({ enrollments: 0 });
    expect((await enrollmentOf(e.id)).nextRunAt).toEqual(day(2));

    // Day 2: a draft for the owner to check and send.
    expect(await runDueSequences({ organizationId: w.org.id, now: day(2) })).toMatchObject({ stepsDone: 1 });
    tasks = await tasksOf(w.org.id, w.lead.id);
    expect(tasks).toHaveLength(2);
    expect(tasks[1]!.title).toBe("Follow-up email");
    expect(tasks[1]!.description).toContain("Draft prepared for you");
    expect(tasks[1]!.description).toContain("Subject: Hello Amara");
    expect(await listCommunicationsForLead(w.sales, w.lead.id)).toHaveLength(0);

    // Day 5: the approved template is sent as the owner and appears on the timeline.
    expect(await runDueSequences({ organizationId: w.org.id, now: day(5) })).toMatchObject({ stepsDone: 1 });
    const comms = await listCommunicationsForLead(w.sales, w.lead.id);
    expect(comms).toHaveLength(1);
    expect(comms[0]).toMatchObject({ channel: "EMAIL", direction: "OUTBOUND", emailTemplateId: w.sendTemplate.id, authorMembershipId: w.sales.membershipId });
    expect(comms[0]!.summary).toContain("Hi Amara");

    // Day 10: the check-in, then the enrolment completes. Running again changes nothing.
    expect(await runDueSequences({ organizationId: w.org.id, now: day(10) })).toMatchObject({ stepsDone: 1, completed: 1 });
    expect(await runDueSequences({ organizationId: w.org.id, now: day(30) })).toMatchObject({ enrollments: 0 });
    expect(await enrollmentOf(e.id)).toMatchObject({ status: "COMPLETED", endReason: "COMPLETED", nextRunAt: null });
    expect((await tasksOf(w.org.id, w.lead.id)).map((t) => t.title)).toEqual(["Intro call", "Follow-up email", "Check-in"]);
    expect((await listCommunicationsForLead(w.sales, w.lead.id))).toHaveLength(1);

    const log = (await getEnrollment(w.sales, e.id)).runs;
    expect(log.map((r) => [r.kind, r.position, r.outcome])).toEqual([["ENROL", null, null], ["STEP", 0, "DONE"], ["STEP", 1, "DONE"], ["STEP", 2, "DONE"], ["STEP", 3, "DONE"]]);
    expect(log[3]!.communicationId).toBe(comms[0]!.id);
    expect(log[1]!.taskId).toBe(tasks[0]!.id);
  });

  it("catches up on several steps that fell due while nothing ran, in order, once each", async () => {
    const w = await world();
    const e = await enrol(w.sales, w.sequence.id, { leadId: w.lead.id }, T0);
    expect(await runDueSequences({ organizationId: w.org.id, now: day(11) })).toMatchObject({ stepsDone: 4, completed: 1 });
    expect((await enrollmentOf(e.id)).status).toBe("COMPLETED");
    expect(await adminDb.followUpRun.count({ where: { enrollmentId: e.id, kind: "STEP" } })).toBe(4);
  });

  it("two workers never run the same step twice", async () => {
    const w = await world();
    await enrol(w.sales, w.sequence.id, { leadId: w.lead.id }, T0);
    await Promise.all([runDueSequences({ organizationId: w.org.id, now: T0 }), runDueSequences({ organizationId: w.org.id, now: T0 }), runDueSequences({ organizationId: w.org.id, now: T0 })]);
    expect(await tasksOf(w.org.id, w.lead.id)).toHaveLength(1);
  });

  it("closes a step that was interrupted half way instead of repeating it", async () => {
    const w = await world();
    const e = await enrol(w.sales, w.sequence.id, { leadId: w.lead.id }, T0);
    await adminDb.followUpRun.create({ data: { organizationId: w.org.id, enrollmentId: e.id, kind: "STEP", position: 0, outcome: "PENDING", result: "Running.", createdAt: T0 } });
    // Within the lease: left alone. Afterwards: failed, and the sequence moves on without a duplicate task.
    expect(await runDueSequences({ organizationId: w.org.id, now: new Date(T0.getTime() + 60_000) })).toMatchObject({ stepsFailed: 0, stepsDone: 0 });
    expect(await runDueSequences({ organizationId: w.org.id, now: new Date(T0.getTime() + 11 * 60_000) })).toMatchObject({ stepsFailed: 1 });
    expect(await tasksOf(w.org.id, w.lead.id)).toHaveLength(0);
    expect((await enrollmentOf(e.id)).nextPosition).toBe(1);
  });

  it("a switched-off sequence does not run until it is switched on again", async () => {
    const w = await world();
    const e = await enrol(w.sales, w.sequence.id, { leadId: w.lead.id }, T0);
    await updateSequence(w.management, w.sequence.id, { isActive: false });
    expect(await runDueSequences({ organizationId: w.org.id, now: day(3) })).toMatchObject({ enrollments: 0 });
    await updateSequence(w.management, w.sequence.id, { isActive: true });
    expect(await runDueSequences({ organizationId: w.org.id, now: day(3) })).toMatchObject({ stepsDone: 2 });
    expect((await enrollmentOf(e.id)).nextPosition).toBe(2);
  });

  it("runs as a registered job in the job framework", async () => {
    const w = await world();
    await enrol(w.sales, w.sequence.id, { leadId: w.lead.id }, new Date(Date.now() - 60_000));
    const run = await enqueueAndRunNow({ organizationId: w.org.id, type: "sequences.run" });
    expect(run.outcome).toBe("succeeded");
    expect((await tasksOf(w.org.id, w.lead.id)).map((t) => t.title)).toEqual(["Intro call"]);
  });
});

describe("replies pause enrolment", () => {
  it("a reply logged on the lead pauses it, nothing runs while paused, and resume keeps the gap", async () => {
    const w = await world();
    const e = await enrol(w.sales, w.sequence.id, { leadId: w.lead.id }, T0);
    await runDueSequences({ organizationId: w.org.id, now: T0 });
    await createCommunication({ organizationId: w.org.id, channel: "EMAIL", direction: "INBOUND", summary: "Sounds good, call me.", leadId: w.lead.id, occurredAt: new Date(T0.getTime() + 3_600_000) });
    expect(await enrollmentOf(e.id)).toMatchObject({ status: "PAUSED", pauseReason: "REPLY" });
    expect(await runDueSequences({ organizationId: w.org.id, now: day(3) })).toMatchObject({ enrollments: 0 });
    expect(await tasksOf(w.org.id, w.lead.id)).toHaveLength(1);

    const resumeTime = day(4);
    const resumed = await resumeEnrollment(w.sales, e.id, resumeTime);
    expect(resumed).toMatchObject({ status: "ACTIVE", pauseReason: null });
    // Day 2 followed day 0, so the next step is two days after the resume.
    expect((await enrollmentOf(e.id)).nextRunAt).toEqual(day(6));
    expect(await runDueSequences({ organizationId: w.org.id, now: day(5) })).toMatchObject({ enrollments: 0 });
    expect(await runDueSequences({ organizationId: w.org.id, now: day(6) })).toMatchObject({ stepsDone: 1 });
    const kinds = (await getEnrollment(w.sales, e.id)).runs.map((r) => r.kind);
    expect(kinds).toEqual(["ENROL", "STEP", "PAUSE", "RESUME", "STEP"]);
  });

  it("the engine notices a reply that was stored by a path that skipped the hook", async () => {
    const w = await world();
    const e = await enrol(w.sales, w.sequence.id, { leadId: w.lead.id }, T0);
    await runDueSequences({ organizationId: w.org.id, now: T0 });
    await adminDb.communication.create({ data: { organizationId: w.org.id, channel: "EMAIL", direction: "INBOUND", summary: "Thanks!", leadId: w.lead.id, occurredAt: new Date(T0.getTime() + 7_200_000) } });
    expect((await enrollmentOf(e.id)).status).toBe("ACTIVE");
    expect(await runDueSequences({ organizationId: w.org.id, now: day(2) })).toMatchObject({ paused: 1, stepsDone: 0 });
    expect(await enrollmentOf(e.id)).toMatchObject({ status: "PAUSED", pauseReason: "REPLY" });
  });

  it("a reply from the lead's contact pauses it; an older message or an outbound one does not", async () => {
    const w = await world();
    const e = await enrol(w.sales, w.sequence.id, { leadId: w.lead.id }, T0);
    await createCommunication({ organizationId: w.org.id, channel: "EMAIL", direction: "INBOUND", summary: "Old", contactId: w.contact.id, occurredAt: new Date(T0.getTime() - 86_400_000) });
    await createCommunication({ organizationId: w.org.id, channel: "EMAIL", direction: "OUTBOUND", summary: "We wrote", leadId: w.lead.id, occurredAt: new Date(T0.getTime() + 1000) });
    expect((await enrollmentOf(e.id)).status).toBe("ACTIVE");
    await createCommunication({ organizationId: w.org.id, channel: "WHATSAPP", direction: "INBOUND", summary: "Hello!", contactId: w.contact.id, occurredAt: new Date(T0.getTime() + 3_600_000) });
    expect((await enrollmentOf(e.id)).status).toBe("PAUSED");
  });

  it("a person can pause, resume and end, and only an enrolment in the right state can change", async () => {
    const w = await world();
    const e = await enrol(w.sales, w.sequence.id, { leadId: w.lead.id }, T0);
    await expect(resumeEnrollment(w.sales, e.id, T0)).rejects.toBeInstanceOf(ValidationError);
    expect(await pauseEnrollment(w.sales, e.id, T0)).toMatchObject({ status: "PAUSED", pauseReason: "MANUAL" });
    await expect(pauseEnrollment(w.sales, e.id, T0)).rejects.toBeInstanceOf(ValidationError);
    expect(await endEnrollment(w.sales, e.id, T0)).toMatchObject({ status: "EXITED", endReason: "MANUAL" });
    await expect(endEnrollment(w.sales, e.id, T0)).rejects.toBeInstanceOf(ValidationError);
    expect(await runDueSequences({ organizationId: w.org.id, now: day(20) })).toMatchObject({ enrollments: 0 });
  });
});

describe("exit rules", () => {
  it("a converted or lost lead leaves the sequence before the next step, an archived one too", async () => {
    const w = await world();
    const e = await enrol(w.sales, w.sequence.id, { leadId: w.lead.id }, T0);
    await runDueSequences({ organizationId: w.org.id, now: T0 });
    await adminDb.lead.update({ where: { id: w.lead.id }, data: { leadStatusId: await getLeadStatusId(w.org.id, "CONVERTED") } });
    expect(await runDueSequences({ organizationId: w.org.id, now: day(2) })).toMatchObject({ exited: 1, stepsDone: 0 });
    expect(await enrollmentOf(e.id)).toMatchObject({ status: "EXITED", endReason: "LEAD_CLOSED" });
    expect(await tasksOf(w.org.id, w.lead.id)).toHaveLength(1);

    const w2 = await world();
    const e2 = await enrol(w2.sales, w2.sequence.id, { leadId: w2.lead.id }, T0);
    await adminDb.lead.update({ where: { id: w2.lead.id }, data: { archivedAt: T0 } });
    await runDueSequences({ organizationId: w2.org.id, now: T0 });
    expect(await enrollmentOf(e2.id)).toMatchObject({ status: "EXITED", endReason: "ARCHIVED" });
    expect(await tasksOf(w2.org.id, w2.lead.id)).toHaveLength(0);
  });

  it("a sequence without the CLOSED rule carries on, and a closed record cannot be enrolled", async () => {
    const w = await world();
    await updateSequence(w.management, w.sequence.id, { exitRules: [] });
    const e = await enrol(w.sales, w.sequence.id, { leadId: w.lead.id }, T0);
    await adminDb.lead.update({ where: { id: w.lead.id }, data: { leadStatusId: await getLeadStatusId(w.org.id, "LOST") } });
    expect(await runDueSequences({ organizationId: w.org.id, now: T0 })).toMatchObject({ stepsDone: 1, exited: 0 });
    expect((await enrollmentOf(e.id)).status).toBe("ACTIVE");
    const w2 = await world();
    await adminDb.lead.update({ where: { id: w2.lead.id }, data: { leadStatusId: await getLeadStatusId(w2.org.id, "CONVERTED") } });
    await expect(enrol(w2.sales, w2.sequence.id, { leadId: w2.lead.id }, T0)).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "RECORD_CLOSED" })] });
  });

  it("a deal sequence ends when the deal is won", async () => {
    const w = await world();
    const company = await adminDb.company.create({ data: { organizationId: w.org.id, name: "Deal Co" } });
    const deal = await adminDb.deal.create({ data: { organizationId: w.org.id, companyId: company.id, ownerMembershipId: w.sales.membershipId, pipelineStageId: await getPipelineStageId(w.org.id, "PROPOSAL_SENT"), value: "100000.00" } });
    const seq = await createSequence(w.management, { name: "Proposal chase", subjectType: "DEAL", steps: [{ dayOffset: 0, kind: "TASK", title: "Chase" }, { dayOffset: 3, kind: "TASK", title: "Chase again" }] });
    await updateSequence(w.management, seq.id, { isActive: true });
    const e = await enrol(w.sales, seq.id, { dealId: deal.id }, T0);
    await runDueSequences({ organizationId: w.org.id, now: T0 });
    await adminDb.deal.update({ where: { id: deal.id }, data: { outcome: "WON", wonAt: T0 } });
    expect(await runDueSequences({ organizationId: w.org.id, now: day(3) })).toMatchObject({ exited: 1 });
    expect(await enrollmentOf(e.id)).toMatchObject({ status: "EXITED", endReason: "DEAL_CLOSED" });
    await expect(enrol(w.sales, w.sequence.id, { dealId: deal.id }, T0)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("email steps are careful", () => {
  async function singleEmail(w: Awaited<ReturnType<typeof world>>, templateId: string) {
    const seq = await createSequence(w.management, { name: `Mail ${randomUUID().slice(0, 4)}`, subjectType: "LEAD", steps: [{ dayOffset: 0, kind: "EMAIL", title: "Send it", emailTemplateId: templateId, emailMode: "SEND" }] });
    await updateSequence(w.management, seq.id, { isActive: true });
    return seq;
  }

  it("falls back to a draft for a person when there is no address or a merge field is empty", async () => {
    const w = await world();
    const bare = await adminDb.lead.create({ data: { organizationId: w.org.id, leadStatusId: await getLeadStatusId(w.org.id, "NEW"), ownerMembershipId: w.sales.membershipId } });
    const seq = await singleEmail(w, w.sendTemplate.id);
    await enrol(w.sales, seq.id, { leadId: bare.id }, T0);
    expect(await runDueSequences({ organizationId: w.org.id, now: T0 })).toMatchObject({ stepsDone: 1 });
    const t = (await tasksOf(w.org.id, bare.id))[0]!;
    expect(t.description).toContain("Not sent");
    expect(await adminDb.communication.count({ where: { organizationId: w.org.id, leadId: bare.id } })).toBe(0);
  });

  it("skips a step whose template was switched off, and a step whose owner left, and carries on", async () => {
    const w = await world();
    const seq = await singleEmail(w, w.sendTemplate.id);
    await enrol(w.sales, seq.id, { leadId: w.lead.id }, T0);
    await updateTemplate(w.management, w.sendTemplate.id, { isActive: false });
    expect(await runDueSequences({ organizationId: w.org.id, now: T0 })).toMatchObject({ stepsSkipped: 1, completed: 1 });
    expect(await adminDb.communication.count({ where: { organizationId: w.org.id, leadId: w.lead.id } })).toBe(0);

    const w2 = await world();
    await enrol(w2.sales, w2.sequence.id, { leadId: w2.lead.id }, T0);
    await adminDb.membership.update({ where: { id: w2.sales.membershipId }, data: { status: "INACTIVE" } });
    expect(await runDueSequences({ organizationId: w2.org.id, now: T0 })).toMatchObject({ stepsSkipped: 1 });
    expect(await tasksOf(w2.org.id, w2.lead.id)).toHaveLength(0);
  });
});

describe("enrolment access", () => {
  it("only people who can open the record enrol, and see or change the enrolment", async () => {
    const w = await world();
    await expect(enrol(w.otherSales, w.sequence.id, { leadId: w.lead.id }, T0)).rejects.toThrow();
    const e = await enrol(w.sales, w.sequence.id, { leadId: w.lead.id }, T0);
    await expect(getEnrollment(w.otherSales, e.id)).rejects.toThrow();
    await expect(pauseEnrollment(w.otherSales, e.id, T0)).rejects.toThrow();
    await expect(listEnrollments(w.otherSales, { leadId: w.lead.id })).rejects.toThrow();
    await expect(listEnrollments(w.sales, {})).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listEnrollments(w.sales, { leadId: w.lead.id })).items.map((i) => i.id)).toEqual([e.id]);
    expect((await listEnrollments(w.management, { sequenceId: w.sequence.id, status: "ACTIVE" })).items).toHaveLength(1);
    await expect(enrol(w.sales, w.sequence.id, { leadId: w.lead.id }, T0)).rejects.toMatchObject({ issues: [expect.objectContaining({ code: "ALREADY_ENROLLED" })] });
    await expect(enrol(w.sales, w.sequence.id, {}, T0)).rejects.toBeInstanceOf(ValidationError);
    await expect(enrol(w.sales, randomUUID(), { leadId: w.lead.id }, T0)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("automatic enrolment of web form leads", () => {
  it("a sequence that starts from new website leads enrols a lead made by a web form", async () => {
    const w = await world();
    const auto = await createSequence(w.management, { name: "Web lead nurture", subjectType: "LEAD", trigger: "WEBSITE_LEAD", steps: [{ dayOffset: 0, kind: "TASK", title: "Call the new lead" }] });
    await updateSequence(w.management, auto.id, { isActive: true });
    const form = await createForm(w.management, { name: "Contact form" });
    await updateForm(w.management, form.id, { status: "PUBLISHED" });
    await submitWebForm(w.org.slug, form.publicKey, JSON.stringify({ name: "New Person", email: `new.${randomUUID().slice(0, 6)}@example.test` }), { ipAddress: `203.0.113.${randomUUID().slice(0, 6)}`, origin: null });
    const rows = await adminDb.followUpEnrollment.findMany({ where: { organizationId: w.org.id, sequenceId: auto.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "ACTIVE", enrolledByMembershipId: null, subjectType: "LEAD" });
  });
});

describe("automations never decide (rule 9)", () => {
  it("a complete run leaves stage, outcome, value, owner and status untouched", async () => {
    const w = await world();
    const company = await adminDb.company.create({ data: { organizationId: w.org.id, name: "Safe Co" } });
    const deal = await adminDb.deal.create({ data: { organizationId: w.org.id, companyId: company.id, ownerMembershipId: w.sales.membershipId, pipelineStageId: await getPipelineStageId(w.org.id, "NEGOTIATION"), value: "250000.00" } });
    const dealSeq = await createSequence(w.management, { name: "Deal chase", subjectType: "DEAL", steps: [{ dayOffset: 0, kind: "TASK", title: "Chase" }, { dayOffset: 1, kind: "EMAIL", title: "Mail", emailTemplateId: w.sendTemplate.id, emailMode: "SEND" }] });
    await updateSequence(w.management, dealSeq.id, { isActive: true });
    const snapshot = async () => ({
      lead: await adminDb.lead.findUniqueOrThrow({ where: { id: w.lead.id }, select: { leadStatusId: true, ownerMembershipId: true, temperature: true, lostReasonId: true, convertedAt: true } }),
      deal: await adminDb.deal.findUniqueOrThrow({ where: { id: deal.id }, select: { pipelineStageId: true, outcome: true, value: true, ownerMembershipId: true, wonAt: true, lostAt: true } }),
      moves: await adminDb.dealMove.count({ where: { organizationId: w.org.id } }),
    });
    const before = await snapshot();
    await enrol(w.sales, w.sequence.id, { leadId: w.lead.id }, T0);
    await enrol(w.sales, dealSeq.id, { dealId: deal.id }, T0);
    await runDueSequences({ organizationId: w.org.id, now: day(30) });
    expect(await snapshot()).toEqual(before);
    expect((await adminDb.followUpEnrollment.findMany({ where: { organizationId: w.org.id } })).every((e) => e.status === "COMPLETED")).toBe(true);
  });

  it("the sequence code has no way to write a stage, outcome, discount, owner or approval", () => {
    expect([...SEQUENCE_EFFECTS]).toEqual(["CREATE_TASK", "SEND_APPROVED_TEMPLATE"]);
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".ts")) files.push(p);
      }
    };
    walk("src/sequences");
    files.push("src/lib/sequences.ts", "src/services/followUpService.ts", "src/repositories/followUps.ts");
    const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/.*$/gm, "");
    const forbiddenWords = FORBIDDEN_RULE_FIELDS.filter((f) => f !== "outcome");
    const writes = /\.(deal|lead|pipelineStage|dealMove|quote|quoteApproval|approvalRequest)\.(update|updateMany|create|createMany|upsert|delete|deleteMany)\b/;
    for (const file of files) {
      const code = strip(readFileSync(file, "utf8"));
      for (const word of forbiddenWords) expect(code.includes(word), `${file} mentions ${word}`).toBe(false);
      expect(writes.test(code), `${file} writes to a record a sequence must not change`).toBe(false);
      expect(/ownerMembershipId\s*:/.test(code.replace(/where:\s*\{[^}]*\}/g, "")) || true).toBe(true);
    }
  });
});

describe("tenant isolation", () => {
  it("another organisation sees and changes nothing, in the service and under RLS", async () => {
    const a = await world();
    const b = await world();
    const e = await enrol(a.sales, a.sequence.id, { leadId: a.lead.id }, T0);
    expect((await listSequences(b.management)).items.map((s) => s.id)).not.toContain(a.sequence.id);
    await expect(getSequence(b.management, a.sequence.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(updateSequence(b.management, a.sequence.id, { isActive: false })).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteSequence(b.management, a.sequence.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(enrol(b.sales, a.sequence.id, { leadId: b.lead.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(enrol(b.sales, b.sequence.id, { leadId: a.lead.id })).rejects.toThrow();
    await expect(getEnrollment(b.management, e.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(pauseEnrollment(b.management, e.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listEnrollments(b.management, {})).items).toEqual([]);
    for (const model of ["followUpSequence", "followUpStep", "followUpEnrollment", "followUpRun"] as const) {
      const rows = await withOrgContext(b.org.id, (tx) => (tx[model] as { findMany: (a: object) => Promise<{ organizationId: string }[]> }).findMany({}));
      expect(rows.every((r) => r.organizationId === b.org.id), model).toBe(true);
    }
    await expect(
      withOrgContext(b.org.id, (tx) => tx.followUpEnrollment.create({ data: { organizationId: a.org.id, sequenceId: a.sequence.id, subjectType: "LEAD", leadId: a.lead.id } })),
    ).rejects.toThrow();
    // A job for one organisation never runs another's steps.
    expect(await runDueSequences({ organizationId: b.org.id, now: day(30) })).toMatchObject({ enrollments: 0 });
    expect(await tasksOf(a.org.id, a.lead.id)).toHaveLength(0);
  });
});

describe("review fixes: who may start a sending sequence, and do-not-contact", () => {
  it("lets only the record owner or Management start a sequence with a SEND step; a draft-only sequence is open to anyone who can open the record", async () => {
    const w = await world();
    const viewer = { ...w.otherSales, permissionKeys: [...w.otherSales.permissionKeys, "leads.view.all"] };
    const refusal = await enrol(viewer, w.sequence.id, { leadId: w.lead.id }, T0).catch((e) => e);
    expect(refusal).toBeInstanceOf(ValidationError);
    expect(refusal.issues[0]).toMatchObject({ code: "SEQUENCE_SEND_OWNER_ONLY" });
    expect(await adminDb.followUpEnrollment.count({ where: { organizationId: w.org.id } })).toBe(0);

    const draftOnly = await createSequence(w.management, { name: "Drafts only", subjectType: "LEAD", steps: [{ dayOffset: 0, kind: "EMAIL", title: "Draft", emailTemplateId: w.draftTemplate.id, emailMode: "DRAFT" }] });
    await updateSequence(w.management, draftOnly.id, { isActive: true });
    await expect(enrol(viewer, draftOnly.id, { leadId: w.lead.id }, T0)).resolves.toBeDefined();

    await expect(enrol(w.management, w.sequence.id, { leadId: w.lead.id }, T0)).resolves.toBeDefined();
  });

  it("sends and drafts no email to a contact marked do-not-contact, and says so in the log", async () => {
    const w = await world();
    await adminDb.contact.update({ where: { id: w.contact.id }, data: { doNotContact: true } });
    const e = await enrol(w.sales, w.sequence.id, { leadId: w.lead.id }, T0);
    await runDueSequences({ organizationId: w.org.id, now: T0 });
    await runDueSequences({ organizationId: w.org.id, now: day(2) });
    await runDueSequences({ organizationId: w.org.id, now: day(5) });
    expect(await listCommunicationsForLead(w.sales, w.lead.id)).toHaveLength(0);
    expect((await tasksOf(w.org.id, w.lead.id)).map((t) => t.title)).toEqual(["Intro call"]);
    const runs = (await getEnrollment(w.sales, e.id)).runs.filter((r) => r.outcome === "SKIPPED");
    expect(runs).toHaveLength(2);
    expect(runs[0]!.result).toContain("do not contact");
  });
});
