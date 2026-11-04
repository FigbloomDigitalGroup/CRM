import { resolveActiveMembership } from "../repositories/memberships";
import { dueAt, exitReasonFor, type EndReason, type SubjectType } from "../lib/sequences";
import {
  advanceEnrollment,
  claimStep,
  createStepTask,
  findDueEnrollments,
  finishStep,
  getStepRun,
  hasReplySince,
  loadSubject,
  ownerUser,
  transitionEnrollment,
  getSequenceRow,
  type SubjectState,
} from "../repositories/followUps";
import { adminDb } from "../db/adminClient";
import { sendAndLogEmail } from "../services/communicationService";
import { renderTemplate } from "../services/emailTemplateService";
import type { AuthContext } from "../auth/context";

/**
 * The follow-up engine (FIG-1150, B6.18). `runDueSequences` is what the job framework's `sequences.run` job calls
 * (`src/jobs/definitions.ts`); it takes the clock as an argument so the scheduler tests run on a fake one.
 *
 * Before every step the engine looks again at the record and the conversation:
 *   1. the record is gone, archived or closed (and the sequence says so): the enrolment EXITS, nothing is sent;
 *   2. the person wrote back since the enrolment or the last step: the enrolment PAUSES until someone resumes it;
 *   3. otherwise the step runs, claimed first in the run log so two workers can never run it twice.
 * A step is a task for the owner (a reminder, or a draft email prepared for them) or, when Management chose SEND for an active
 * template, the email itself, sent and logged on the timeline as the owner. The engine never touches a stage, an outcome, a
 * discount, an owner or an approval: the only writes are tasks, communications through the normal send path, and its own tables.
 */

const MAX_STEPS_PER_ENROLMENT_PER_RUN = 10;
const STALE_CLAIM_MS = 10 * 60_000;

export type SweepResult = {
  enrollments: number;
  stepsDone: number;
  stepsSkipped: number;
  stepsFailed: number;
  paused: number;
  exited: number;
  completed: number;
};

export async function runDueSequences(options: { organizationId: string; now?: Date; limit?: number }): Promise<SweepResult> {
  const now = options.now ?? new Date();
  const result: SweepResult = { enrollments: 0, stepsDone: 0, stepsSkipped: 0, stepsFailed: 0, paused: 0, exited: 0, completed: 0 };
  const due = await findDueEnrollments(options.organizationId, now, options.limit ?? 100);
  for (const enrollment of due) {
    result.enrollments += 1;
    await processEnrollment(options.organizationId, enrollment.id, now, result);
  }
  return result;
}

type Enrollment = Awaited<ReturnType<typeof findDueEnrollments>>[number];

async function ownerContext(organizationId: string, membershipId: string | null): Promise<AuthContext | null> {
  if (!membershipId) return null;
  const m = await ownerUser(organizationId, membershipId);
  if (!m || m.status !== "ACTIVE") return null;
  return (await resolveActiveMembership(m.userId, organizationId)) ?? null;
}

async function processEnrollment(organizationId: string, id: string, now: Date, result: SweepResult) {
  for (let n = 0; n < MAX_STEPS_PER_ENROLMENT_PER_RUN; n++) {
    const [fresh] = (await findDueEnrollments(organizationId, now, 1000)).filter((e) => e.id === id);
    if (!fresh) return;
    const outcome = await runNextStep(organizationId, fresh, now, result);
    if (outcome !== "continue") return;
  }
}

async function exit(organizationId: string, e: Enrollment, reason: EndReason, text: string, now: Date, result: SweepResult) {
  const done = await transitionEnrollment(organizationId, e.id, ["ACTIVE"], { status: "EXITED", endedAt: now, endReason: reason, nextRunAt: null }, { kind: "EXIT", result: text });
  if (done) result.exited += 1;
}

async function runNextStep(organizationId: string, e: Enrollment, now: Date, result: SweepResult): Promise<"continue" | "stop"> {
  const sequence = await getSequenceRow(organizationId, e.sequenceId);
  if (!sequence) return "stop";
  const subjectRef = { type: e.subjectType as SubjectType, leadId: e.leadId, dealId: e.dealId };
  const subject = await loadSubject(organizationId, subjectRef);
  if (!subject.exists) {
    await exit(organizationId, e, "ARCHIVED", "The record no longer exists.", now, result);
    return "stop";
  }
  const why = exitReasonFor({ type: subjectRef.type, archivedAt: subject.archivedAt, closed: subject.closed }, sequence.exitRules);
  if (why) {
    await exit(organizationId, e, why, why === "ARCHIVED" ? "The record was archived." : subjectRef.type === "LEAD" ? "The lead was closed." : "The deal was closed.", now, result);
    return "stop";
  }

  const step = sequence.steps.find((s) => s.position === e.nextPosition);
  if (!step) {
    await advanceEnrollment(organizationId, e.id, { nextPosition: e.nextPosition, nextRunAt: null, lastStepAt: now, status: "COMPLETED", endedAt: now, endReason: "COMPLETED" });
    result.completed += 1;
    return "stop";
  }

  // A reply since the enrolment, or since the last step, pauses it: a person is talking now, not a timer.
  const since = e.lastStepAt ?? e.enrolledAt;
  if (await hasReplySince(organizationId, { leadId: e.leadId, dealId: e.dealId, contactId: subject.contactId }, since)) {
    const paused = await transitionEnrollment(organizationId, e.id, ["ACTIVE"], { status: "PAUSED", pausedAt: now, pauseReason: "REPLY" }, { kind: "PAUSE", result: "Paused because the person replied." });
    if (paused) result.paused += 1;
    return "stop";
  }

  const claim = await claimStep(organizationId, e.id, step.position);
  if (!claim) {
    // Held by another worker, or by a run that died half way: a claim older than the lease is closed as failed so the sequence moves on.
    const held = await getStepRun(organizationId, e.id, step.position);
    if (held && held.outcome === "PENDING" && now.getTime() - held.createdAt.getTime() > STALE_CLAIM_MS) {
      await finishStep(organizationId, held.id, "FAILED", "The run was interrupted; it was not repeated so nothing is sent twice.");
      result.stepsFailed += 1;
      await moveOn(organizationId, e, step.position, sequence.steps.map((s) => s.dayOffset), now, result);
      return "continue";
    }
    return "stop";
  }

  let outcome: "DONE" | "SKIPPED" | "FAILED" = "FAILED";
  let text = "The step did not run.";
  let links: { taskId?: string; communicationId?: string } = {};
  try {
    const r = await executeStep(organizationId, e, step, subject, now);
    outcome = r.outcome;
    text = r.result;
    links = r.links ?? {};
  } catch (err) {
    outcome = "FAILED";
    text = `Failed: ${err instanceof Error ? err.message : "unknown error"}`.slice(0, 500);
  }
  await finishStep(organizationId, claim, outcome, text, links);
  if (outcome === "DONE") result.stepsDone += 1;
  else if (outcome === "SKIPPED") result.stepsSkipped += 1;
  else result.stepsFailed += 1;
  await moveOn(organizationId, e, step.position, sequence.steps.map((s) => s.dayOffset), now, result);
  return "continue";
}

async function moveOn(organizationId: string, e: Enrollment, position: number, offsets: number[], now: Date, result: SweepResult) {
  const next = position + 1;
  if (next >= offsets.length) {
    await advanceEnrollment(organizationId, e.id, { nextPosition: next, nextRunAt: null, lastStepAt: now, status: "COMPLETED", endedAt: now, endReason: "COMPLETED" });
    result.completed += 1;
    return;
  }
  await advanceEnrollment(organizationId, e.id, { nextPosition: next, nextRunAt: dueAt(e.scheduleFrom, offsets[next]!), lastStepAt: now });
}

async function isDoNotContact(organizationId: string, subject: SubjectState): Promise<boolean> {
  const or: object[] = [];
  if (subject.contactId) or.push({ id: subject.contactId });
  if (subject.contactEmail) or.push({ email: { equals: subject.contactEmail.trim(), mode: "insensitive" } });
  if (or.length === 0) return false;
  const hit = await adminDb.contact.findFirst({ where: { organizationId, doNotContact: true, OR: or as never }, select: { id: true } });
  return hit !== null;
}

type Step = NonNullable<Awaited<ReturnType<typeof getSequenceRow>>>["steps"][number];
interface StepResult {
  outcome: "DONE" | "SKIPPED" | "FAILED";
  result: string;
  links?: { taskId?: string; communicationId?: string };
}

async function executeStep(organizationId: string, e: Enrollment, step: Step, subject: SubjectState, now: Date): Promise<StepResult> {
  const ownerId = subject.ownerMembershipId ?? e.enrolledByMembershipId;
  if (!ownerId) return { outcome: "SKIPPED", result: "Nobody owns this record, so there is nobody to remind." };
  const owner = await ownerContext(organizationId, ownerId);
  if (!owner) return { outcome: "SKIPPED", result: "The owner is no longer an active member." };
  const record = { leadId: e.leadId ?? undefined, dealId: e.dealId ?? undefined, companyId: subject.companyId ?? undefined, contactId: subject.contactId ?? undefined };

  if (step.kind === "TASK") {
    const task = await createStepTask({ organizationId, title: step.title, description: step.description, assigneeMembershipId: owner.membershipId, dueAt: now, priority: step.priority as "LOW" | "MEDIUM" | "HIGH", ...record });
    return { outcome: "DONE", result: "Created a task for the owner.", links: { taskId: task.id } };
  }

  // EMAIL: always rendered as the owner, so the merge fields only hold what the owner may see.
  if (!step.emailTemplateId) return { outcome: "SKIPPED", result: "The step has no email template." };
  let rendered;
  try {
    rendered = await renderTemplate(owner, step.emailTemplateId, { leadId: e.leadId ?? undefined, dealId: e.dealId ?? undefined, contactId: subject.contactId ?? undefined, companyId: subject.companyId ?? undefined });
  } catch (err) {
    return { outcome: "SKIPPED", result: `The template could not be used: ${err instanceof Error ? err.message : "unknown error"}` };
  }
  // A person marked do-not-contact gets no sequence email, drafted or sent (the contact on the record, or any contact with this address).
  if (await isDoNotContact(organizationId, subject)) return { outcome: "SKIPPED", result: "Not emailed: this person is marked do not contact." };
  const draftBody = `Draft prepared for you. Check it, then send it from the ${e.leadId ? "lead" : "deal"}.\n\nSubject: ${rendered.subject}\n\n${rendered.body}`;
  const draft = async (note: string): Promise<StepResult> => {
    const task = await createStepTask({ organizationId, title: step.title, description: `${note}${draftBody}`.slice(0, 20000), assigneeMembershipId: owner.membershipId, dueAt: now, priority: step.priority as "LOW" | "MEDIUM" | "HIGH", ...record });
    return { outcome: "DONE", result: `Prepared a draft email in a task for the owner.${note ? " " + note.trim() : ""}`, links: { taskId: task.id } };
  };
  if (step.emailMode === "DRAFT") return draft("");
  // SEND: only with an address and every merge field filled; otherwise it becomes a draft for a person to finish.
  if (rendered.missing.length > 0) return draft(`Not sent: these fields were empty: ${rendered.missing.join(", ")}.\n\n`);
  if (!subject.contactEmail) return draft("Not sent: there is no email address on the record.\n\n");
  const sent = await sendAndLogEmail(owner, { to: subject.contactEmail, subject: rendered.subject, body: rendered.body, templateId: step.emailTemplateId, ...record });
  return { outcome: "DONE", result: "Sent the approved template and logged it on the timeline.", links: { communicationId: sent.id } };
}
