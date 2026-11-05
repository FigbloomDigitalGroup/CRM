import type { AuthContext } from "../auth/context";
import { deny, hasPermission, requirePermission } from "../auth/context";
import { NotFoundError, ValidationError } from "../auth/errors";
import { buildPage, resolvePaging, type PageRequest } from "../lib/pagination";
import {
  cleanSteps,
  dueAt,
  EXIT_RULES,
  MAX_SEQUENCES,
  resumeAt,
  SUBJECT_TYPES,
  TRIGGERS,
  type SubjectType,
} from "../lib/sequences";
import { recordAuditEvent } from "../repositories/auditEvents";
import {
  activeTemplateIds,
  countSequences,
  createEnrollmentRow,
  createSequenceRow,
  deleteSequenceRow,
  findSequenceByName,
  getEnrollmentRow,
  getSequenceRow,
  listEnrollmentRows,
  listRunRows,
  listSequenceRows,
  loadSubject,
  sequenceNames,
  transitionEnrollment,
  updateSequenceRow,
} from "../repositories/followUps";
import { requireFeature } from "./featureService";
import { getDeal } from "./dealService";
import { getLead } from "./leadService";

/**
 * Follow-up sequences (FIG-1150, B6.18, design S6#2). See docs/SEQUENCES.md.
 *
 *   - Management (`cadences.manage`) builds sequences and switches them on. Anyone who can add tasks (`tasks.create`) can enrol the
 *     records they may open, and pause, resume or end an enrolment on them. People who cannot manage see only active sequences.
 *   - A sequence only reminds, drafts and (for an active, approved template Management chose to SEND) sends. It never moves a stage,
 *     sets a discount, changes an owner or approves anything (`src/lib/sequences.ts`, tested).
 *   - V1.1: needs the organisation to be on release V1.1.
 */

const MANAGE = "cadences.manage";
type Sequence = NonNullable<Awaited<ReturnType<typeof getSequenceRow>>>;

function presentSequence(s: Sequence) {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    subjectType: s.subjectType as SubjectType,
    trigger: s.trigger,
    isActive: s.isActive,
    exitRules: s.exitRules,
    running: s.running,
    steps: s.steps.map((st) => ({ position: st.position, dayOffset: st.dayOffset, kind: st.kind, title: st.title, description: st.description, priority: st.priority, emailTemplateId: st.emailTemplateId, emailMode: st.emailMode })),
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

async function gate(ctx: AuthContext) {
  await requireFeature(ctx.organizationId, "release.v11");
}

function cleanName(name: unknown): string {
  const n = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
  if (!n || n.length > 80) throw new ValidationError("A name of 1 to 80 characters is required.", [{ path: "name", message: "1 to 80 characters." }]);
  return n;
}

function cleanExitRules(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((r) => (EXIT_RULES as readonly unknown[]).includes(r))) {
    throw new ValidationError("exitRules is a list of CLOSED and ARCHIVED.", [{ path: "exitRules", message: "Use CLOSED, ARCHIVED or both." }]);
  }
  return [...new Set(value as string[])];
}

async function checkTemplates(ctx: AuthContext, steps: { emailTemplateId: string | null; kind: string }[]) {
  const ids = [...new Set(steps.map((s) => s.emailTemplateId).filter((x): x is string => Boolean(x)))];
  if (ids.length === 0) return;
  const ok = await activeTemplateIds(ctx.organizationId, ids);
  const bad = ids.filter((i) => !ok.has(i));
  if (bad.length > 0) throw new ValidationError("A step uses an email template that does not exist or is switched off.", [{ path: "steps", message: "Use an active email template.", code: "TEMPLATE_NOT_AVAILABLE" }]);
}

export async function listSequences(ctx: AuthContext) {
  await gate(ctx);
  const manager = hasPermission(ctx, MANAGE);
  if (!manager) requirePermission(ctx, "tasks.create");
  const rows = await listSequenceRows(ctx.organizationId, { activeOnly: !manager });
  return { items: rows.map((r) => presentSequence(r)) };
}

export async function getSequence(ctx: AuthContext, id: string) {
  await gate(ctx);
  const manager = hasPermission(ctx, MANAGE);
  if (!manager) requirePermission(ctx, "tasks.create");
  const row = await getSequenceRow(ctx.organizationId, id);
  // A sequence that is switched off is invisible to people who cannot manage it.
  if (!row || (!manager && !row.isActive)) throw new NotFoundError("Sequence", id);
  return presentSequence(row);
}

export async function createSequence(
  ctx: AuthContext,
  input: { name: string; description?: string | null; subjectType: string; trigger?: string; exitRules?: unknown; steps: unknown },
) {
  requirePermission(ctx, MANAGE);
  await gate(ctx);
  const name = cleanName(input.name);
  if (!(SUBJECT_TYPES as readonly unknown[]).includes(input.subjectType)) throw new ValidationError("subjectType is LEAD or DEAL.", [{ path: "subjectType", message: "LEAD or DEAL." }]);
  const trigger = input.trigger ?? "MANUAL";
  if (!(TRIGGERS as readonly unknown[]).includes(trigger)) throw new ValidationError("trigger is MANUAL or WEBSITE_LEAD.", [{ path: "trigger", message: "MANUAL or WEBSITE_LEAD." }]);
  if (trigger === "WEBSITE_LEAD" && input.subjectType !== "LEAD") throw new ValidationError("Only a lead sequence can start from a new website lead.", [{ path: "trigger", message: "Use MANUAL for a deal sequence." }]);
  const { steps, problems } = cleanSteps(input.steps);
  if (problems.length > 0) throw new ValidationError("This sequence is not valid.", problems);
  await checkTemplates(ctx, steps);
  if (await findSequenceByName(ctx.organizationId, name)) throw new ValidationError("A sequence with this name already exists.", [{ path: "name", message: "Pick a different name.", code: "DUPLICATE_SEQUENCE" }]);
  if ((await countSequences(ctx.organizationId)) >= MAX_SEQUENCES) throw new ValidationError(`An organisation can have at most ${MAX_SEQUENCES} sequences.`, [{ path: "name", message: "Delete one first." }]);
  const row = await createSequenceRow({
    organizationId: ctx.organizationId,
    name,
    description: typeof input.description === "string" && input.description.trim() ? input.description.trim().slice(0, 500) : null,
    subjectType: input.subjectType,
    trigger,
    exitRules: input.exitRules === undefined ? ["CLOSED", "ARCHIVED"] : cleanExitRules(input.exitRules),
    createdByMembershipId: ctx.membershipId,
    steps,
  });
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "follow_up_sequence.created", entityType: "FollowUpSequence", entityId: row.id, newValue: { name, steps: steps.length } });
  return getSequence(ctx, row.id);
}

export async function updateSequence(
  ctx: AuthContext,
  id: string,
  patch: { name?: string; description?: string | null; trigger?: string; isActive?: boolean; exitRules?: unknown; steps?: unknown },
) {
  requirePermission(ctx, MANAGE);
  await gate(ctx);
  const row = await getSequenceRow(ctx.organizationId, id);
  if (!row) throw new NotFoundError("Sequence", id);
  const data: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const name = cleanName(patch.name);
    const clash = await findSequenceByName(ctx.organizationId, name);
    if (clash && clash.id !== id) throw new ValidationError("A sequence with this name already exists.", [{ path: "name", message: "Pick a different name.", code: "DUPLICATE_SEQUENCE" }]);
    data.name = name;
  }
  if (patch.description !== undefined) data.description = typeof patch.description === "string" && patch.description.trim() ? patch.description.trim().slice(0, 500) : null;
  if (patch.trigger !== undefined) {
    if (!(TRIGGERS as readonly unknown[]).includes(patch.trigger)) throw new ValidationError("trigger is MANUAL or WEBSITE_LEAD.", [{ path: "trigger", message: "MANUAL or WEBSITE_LEAD." }]);
    if (patch.trigger === "WEBSITE_LEAD" && row.subjectType !== "LEAD") throw new ValidationError("Only a lead sequence can start from a new website lead.", [{ path: "trigger", message: "Use MANUAL for a deal sequence." }]);
    data.trigger = patch.trigger;
  }
  if (patch.exitRules !== undefined) data.exitRules = cleanExitRules(patch.exitRules);
  let steps: ReturnType<typeof cleanSteps>["steps"] | undefined;
  if (patch.steps !== undefined) {
    const cleaned = cleanSteps(patch.steps);
    if (cleaned.problems.length > 0) throw new ValidationError("This sequence is not valid.", cleaned.problems);
    await checkTemplates(ctx, cleaned.steps);
    steps = cleaned.steps;
  }
  if (patch.isActive !== undefined) {
    if (patch.isActive && (steps ?? row.steps).length === 0) throw new ValidationError("A sequence needs a step before it can be switched on.", [{ path: "isActive", message: "Add a step." }]);
    data.isActive = patch.isActive;
  }
  await updateSequenceRow(ctx.organizationId, id, data, steps);
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: patch.isActive !== undefined && patch.isActive !== row.isActive ? (patch.isActive ? "follow_up_sequence.activated" : "follow_up_sequence.deactivated") : "follow_up_sequence.updated",
    entityType: "FollowUpSequence",
    entityId: id,
    previousValue: { name: row.name, isActive: row.isActive },
    newValue: { name: (data.name as string) ?? row.name, isActive: (data.isActive as boolean) ?? row.isActive, steps: steps?.length },
  });
  return getSequence(ctx, id);
}

export async function deleteSequence(ctx: AuthContext, id: string) {
  requirePermission(ctx, MANAGE);
  await gate(ctx);
  const row = await getSequenceRow(ctx.organizationId, id);
  if (!row) throw new NotFoundError("Sequence", id);
  if (row.running > 0) throw new ValidationError("This sequence still has running enrolments. Switch it off, or end them, first.", [{ path: "id", message: `${row.running} running.`, code: "SEQUENCE_IN_USE" }]);
  await deleteSequenceRow(ctx.organizationId, id);
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "follow_up_sequence.deleted", entityType: "FollowUpSequence", entityId: id, previousValue: { name: row.name } });
  return { id };
}

// ---- Enrolments ------------------------------------------------------------------------------------------------------------------------

/** The record must be one the caller may open (the lead or deal service answers 404 or 403 itself). */
async function openRecord(ctx: AuthContext, ref: { leadId?: string; dealId?: string }) {
  requirePermission(ctx, "tasks.create");
  if (ref.leadId && !ref.dealId) await getLead(ctx, ref.leadId);
  else if (ref.dealId && !ref.leadId) await getDeal(ctx, ref.dealId);
  else throw new ValidationError("Give either leadId or dealId.", [{ path: "leadId", message: "Exactly one of leadId and dealId." }]);
}

export async function enrol(ctx: AuthContext, sequenceId: string, ref: { leadId?: string; dealId?: string }, now: Date = new Date()) {
  await gate(ctx);
  await openRecord(ctx, ref);
  const sequence = await getSequenceRow(ctx.organizationId, sequenceId);
  if (!sequence || !sequence.isActive) throw new NotFoundError("Sequence", sequenceId);
  const type: SubjectType = ref.leadId ? "LEAD" : "DEAL";
  if (sequence.subjectType !== type) throw new ValidationError(`This sequence is for ${sequence.subjectType === "LEAD" ? "leads" : "deals"}.`, [{ path: type === "LEAD" ? "leadId" : "dealId", message: "Wrong kind of record for this sequence." }]);
  const state = await loadSubject(ctx.organizationId, { type, leadId: ref.leadId ?? null, dealId: ref.dealId ?? null });
  if (!state.exists || state.archivedAt || state.closed) throw new ValidationError("A closed or archived record cannot be enrolled.", [{ path: type === "LEAD" ? "leadId" : "dealId", message: "The record is closed or archived.", code: "RECORD_CLOSED" }]);
  // A SEND step emails unattended as the record owner, so only the owner or a person who manages sequences may start it.
  const sends = sequence.steps.some((s) => s.kind === "EMAIL" && s.emailMode === "SEND");
  if (sends && state.ownerMembershipId !== ctx.membershipId && !hasPermission(ctx, MANAGE)) {
    throw new ValidationError("This sequence sends emails for the record owner, so only the owner or someone who manages sequences can start it.", [{ path: "sequenceId", message: "Ask the record owner, or choose a draft-only sequence.", code: "SEQUENCE_SEND_OWNER_ONLY" }]);
  }
  const first = sequence.steps[0]!;
  const row = await createEnrollmentRow({
    organizationId: ctx.organizationId,
    sequenceId,
    subjectType: type,
    leadId: ref.leadId,
    dealId: ref.dealId,
    enrolledByMembershipId: ctx.membershipId,
    enrolledAt: now,
    nextRunAt: dueAt(now, first.dayOffset),
    status: "ACTIVE",
  });
  if (!row) throw new ValidationError("This record is already in this sequence.", [{ path: "sequenceId", message: "Already enrolled.", code: "ALREADY_ENROLLED" }]);
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "follow_up_enrolment.created", entityType: "FollowUpEnrollment", entityId: row.id, newValue: { sequence: sequence.name, ...ref } });
  return presentEnrollment(row, sequence.name);
}

/**
 * Enrols a new lead in every active sequence that starts from new website leads. Runs after the lead is saved, for the system
 * (no person), and never throws into the caller: a sequence problem must not fail a public form.
 */
export async function autoEnrolLead(organizationId: string, leadId: string, now: Date = new Date()): Promise<number> {
  try {
    await requireFeature(organizationId, "release.v11");
    const sequences = (await listSequenceRows(organizationId, { activeOnly: true })).filter((s) => s.trigger === "WEBSITE_LEAD" && s.steps.length > 0);
    let n = 0;
    for (const s of sequences) {
      const row = await createEnrollmentRow({ organizationId, sequenceId: s.id, subjectType: "LEAD", leadId, enrolledByMembershipId: null, enrolledAt: now, nextRunAt: dueAt(now, s.steps[0]!.dayOffset), status: "ACTIVE" });
      if (row) n += 1;
    }
    return n;
  } catch {
    return 0;
  }
}

type EnrollmentRow = NonNullable<Awaited<ReturnType<typeof getEnrollmentRow>>>;
function presentEnrollment(e: EnrollmentRow, sequenceName: string | null) {
  return {
    id: e.id,
    sequenceId: e.sequenceId,
    sequenceName,
    subjectType: e.subjectType as SubjectType,
    leadId: e.leadId,
    dealId: e.dealId,
    status: e.status,
    nextPosition: e.nextPosition,
    nextRunAt: e.nextRunAt,
    enrolledAt: e.enrolledAt,
    lastStepAt: e.lastStepAt,
    pausedAt: e.pausedAt,
    pauseReason: e.pauseReason,
    endedAt: e.endedAt,
    endReason: e.endReason,
  };
}

async function loadEnrollment(ctx: AuthContext, id: string) {
  const row = await getEnrollmentRow(ctx.organizationId, id);
  if (!row) throw new NotFoundError("FollowUpEnrollment", id);
  // Same visibility as the record itself: someone who cannot open the lead or deal gets the same 404 or 403 they get on the record.
  await openRecord(ctx, { leadId: row.leadId ?? undefined, dealId: row.dealId ?? undefined });
  return row;
}

export async function getEnrollment(ctx: AuthContext, id: string) {
  await gate(ctx);
  const row = await loadEnrollment(ctx, id);
  const [names, runs] = await Promise.all([sequenceNames(ctx.organizationId, [row.sequenceId]), listRunRows(ctx.organizationId, id)]);
  return {
    ...presentEnrollment(row, names.get(row.sequenceId) ?? null),
    runs: runs.map((r) => ({ id: r.id, at: r.createdAt, kind: r.kind, position: r.position, outcome: r.outcome, result: r.result, taskId: r.taskId, communicationId: r.communicationId })),
  };
}

export async function listEnrollments(ctx: AuthContext, query: { leadId?: string; dealId?: string; sequenceId?: string; status?: string; paging?: PageRequest } = {}) {
  await gate(ctx);
  if (query.leadId || query.dealId) await openRecord(ctx, { leadId: query.leadId, dealId: query.dealId });
  else if (!hasPermission(ctx, MANAGE)) throw deny(ctx, MANAGE, [MANAGE]);
  if (query.status !== undefined && !["ACTIVE", "PAUSED", "COMPLETED", "EXITED"].includes(query.status)) throw new ValidationError("Unknown status.", [{ path: "status", message: "ACTIVE, PAUSED, COMPLETED or EXITED." }]);
  const paging = resolvePaging(query.paging);
  const { rows, total } = await listEnrollmentRows(ctx.organizationId, { leadId: query.leadId, dealId: query.dealId, sequenceId: query.sequenceId, status: query.status, skip: paging.skip, take: paging.take });
  const names = await sequenceNames(ctx.organizationId, [...new Set(rows.map((r) => r.sequenceId))]);
  return buildPage(rows.map((r) => presentEnrollment(r, names.get(r.sequenceId) ?? null)), total, paging);
}

export async function pauseEnrollment(ctx: AuthContext, id: string, now: Date = new Date()) {
  await gate(ctx);
  const row = await loadEnrollment(ctx, id);
  const changed = await transitionEnrollment(ctx.organizationId, id, ["ACTIVE"], { status: "PAUSED", pausedAt: now, pauseReason: "MANUAL" }, { kind: "PAUSE", result: "Paused by a person.", actorMembershipId: ctx.membershipId });
  if (!changed) throw new ValidationError("Only a running enrolment can be paused.", [{ path: "id", message: `It is ${row.status.toLowerCase()}.` }]);
  return presentEnrollment(changed, null);
}

/** Resumes a paused enrolment: the next step keeps the gap it had to the one before, counted from now. */
export async function resumeEnrollment(ctx: AuthContext, id: string, now: Date = new Date()) {
  await gate(ctx);
  const row = await loadEnrollment(ctx, id);
  const sequence = await getSequenceRow(ctx.organizationId, row.sequenceId);
  const next = sequence?.steps.find((s) => s.position === row.nextPosition);
  if (!sequence || !next) throw new ValidationError("There is nothing left to run in this enrolment.", [{ path: "id", message: "No next step." }]);
  const previous = sequence.steps.find((s) => s.position === row.nextPosition - 1);
  const changed = await transitionEnrollment(
    ctx.organizationId,
    id,
    ["PAUSED"],
    // A reply that paused it was before now, so the engine will not pause it again for the same message.
    { status: "ACTIVE", pausedAt: null, pauseReason: null, nextRunAt: resumeAt(now, previous?.dayOffset ?? null, next.dayOffset), scheduleFrom: new Date(now.getTime() - (previous?.dayOffset ?? next.dayOffset) * 86_400_000), lastStepAt: now },
    { kind: "RESUME", result: "Resumed by a person.", actorMembershipId: ctx.membershipId },
  );
  if (!changed) throw new ValidationError("Only a paused enrolment can be resumed.", [{ path: "id", message: `It is ${row.status.toLowerCase()}.` }]);
  return presentEnrollment(changed, null);
}

export async function endEnrollment(ctx: AuthContext, id: string, now: Date = new Date()) {
  await gate(ctx);
  const row = await loadEnrollment(ctx, id);
  const changed = await transitionEnrollment(ctx.organizationId, id, ["ACTIVE", "PAUSED"], { status: "EXITED", endedAt: now, endReason: "MANUAL", nextRunAt: null }, { kind: "EXIT", result: "Ended by a person.", actorMembershipId: ctx.membershipId });
  if (!changed) throw new ValidationError("This enrolment has already ended.", [{ path: "id", message: `It is ${row.status.toLowerCase()}.` }]);
  return presentEnrollment(changed, null);
}
