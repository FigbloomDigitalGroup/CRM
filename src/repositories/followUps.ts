import { Prisma } from "@prisma/client";
import { adminDb } from "../db/adminClient";
import { type OrgScopedClient, withOrgContext } from "../db/orgScopedClient";
import type { EndReason, PauseReason, StepInput } from "../lib/sequences";

/** Data access for follow-up sequences, enrolments and the run log (FIG-1150). Every call runs inside the organisation's RLS context. */

const isUniqueViolation = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

// ---- Sequences -------------------------------------------------------------------------------------------------------------------------

export function listSequenceRows(organizationId: string, options: { activeOnly?: boolean } = {}) {
  return withOrgContext(organizationId, async (tx) => {
    const sequences = await tx.followUpSequence.findMany({ where: { organizationId, ...(options.activeOnly ? { isActive: true } : {}) }, orderBy: { name: "asc" } });
    const ids = sequences.map((s) => s.id);
    const steps = await tx.followUpStep.findMany({ where: { organizationId, sequenceId: { in: ids } }, orderBy: [{ sequenceId: "asc" }, { position: "asc" }] });
    const running = await tx.followUpEnrollment.groupBy({ by: ["sequenceId"], where: { organizationId, sequenceId: { in: ids }, status: { in: ["ACTIVE", "PAUSED"] } }, _count: { _all: true } });
    return sequences.map((s) => ({ ...s, steps: steps.filter((st) => st.sequenceId === s.id), running: running.find((r) => r.sequenceId === s.id)?._count._all ?? 0 }));
  });
}

export function getSequenceRow(organizationId: string, id: string) {
  return withOrgContext(organizationId, async (tx) => {
    const sequence = await tx.followUpSequence.findFirst({ where: { id, organizationId } });
    if (!sequence) return null;
    const [steps, running] = await Promise.all([
      tx.followUpStep.findMany({ where: { organizationId, sequenceId: id }, orderBy: { position: "asc" } }),
      tx.followUpEnrollment.count({ where: { organizationId, sequenceId: id, status: { in: ["ACTIVE", "PAUSED"] } } }),
    ]);
    return { ...sequence, steps, running };
  });
}

export function countSequences(organizationId: string) {
  return withOrgContext(organizationId, (tx) => tx.followUpSequence.count({ where: { organizationId } }));
}

export function findSequenceByName(organizationId: string, name: string) {
  return withOrgContext(organizationId, (tx) => tx.followUpSequence.findFirst({ where: { organizationId, name: { equals: name, mode: "insensitive" } } }));
}

export function activeTemplateIds(organizationId: string, ids: string[]) {
  return withOrgContext(organizationId, async (tx) => new Set((await tx.emailTemplate.findMany({ where: { organizationId, id: { in: ids }, isActive: true }, select: { id: true } })).map((t) => t.id)));
}

async function writeSteps(tx: OrgScopedClient, organizationId: string, sequenceId: string, steps: StepInput[]) {
  await tx.followUpStep.deleteMany({ where: { organizationId, sequenceId } });
  if (steps.length > 0) await tx.followUpStep.createMany({ data: steps.map((s) => ({ organizationId, sequenceId, ...s })) });
}

export function createSequenceRow(input: { organizationId: string; name: string; description: string | null; subjectType: string; trigger: string; exitRules: string[]; createdByMembershipId: string; steps: StepInput[] }) {
  const { steps, ...data } = input;
  return withOrgContext(input.organizationId, async (tx) => {
    const sequence = await tx.followUpSequence.create({ data });
    await writeSteps(tx, input.organizationId, sequence.id, steps);
    return sequence;
  });
}

export function updateSequenceRow(organizationId: string, id: string, data: Prisma.FollowUpSequenceUncheckedUpdateInput, steps?: StepInput[]) {
  return withOrgContext(organizationId, async (tx) => {
    const updated = await tx.followUpSequence.update({ where: { id, organizationId }, data });
    if (steps) await writeSteps(tx, organizationId, id, steps);
    return updated;
  });
}

export function deleteSequenceRow(organizationId: string, id: string) {
  return withOrgContext(organizationId, (tx) => tx.followUpSequence.delete({ where: { id, organizationId } }));
}

// ---- Enrolments ------------------------------------------------------------------------------------------------------------------------

export async function createEnrollmentRow(input: {
  organizationId: string;
  sequenceId: string;
  subjectType: "LEAD" | "DEAL";
  leadId?: string;
  dealId?: string;
  enrolledByMembershipId: string | null;
  enrolledAt: Date;
  nextRunAt: Date | null;
  status: "ACTIVE" | "COMPLETED";
}) {
  try {
    return await withOrgContext(input.organizationId, async (tx) => {
      const row = await tx.followUpEnrollment.create({
        data: {
          organizationId: input.organizationId,
          sequenceId: input.sequenceId,
          subjectType: input.subjectType,
          leadId: input.leadId,
          dealId: input.dealId,
          enrolledByMembershipId: input.enrolledByMembershipId,
          enrolledAt: input.enrolledAt,
          scheduleFrom: input.enrolledAt,
          nextRunAt: input.nextRunAt,
          status: input.status,
        },
      });
      await tx.followUpRun.create({ data: { organizationId: input.organizationId, enrollmentId: row.id, kind: "ENROL", result: "Enrolled.", actorMembershipId: input.enrolledByMembershipId } });
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
}

export function getEnrollmentRow(organizationId: string, id: string) {
  return withOrgContext(organizationId, (tx) => tx.followUpEnrollment.findFirst({ where: { id, organizationId } }));
}

export function listEnrollmentRows(organizationId: string, filter: { leadId?: string; dealId?: string; sequenceId?: string; status?: string; skip: number; take: number }) {
  const where: Prisma.FollowUpEnrollmentWhereInput = {
    organizationId,
    ...(filter.leadId ? { leadId: filter.leadId } : {}),
    ...(filter.dealId ? { dealId: filter.dealId } : {}),
    ...(filter.sequenceId ? { sequenceId: filter.sequenceId } : {}),
    ...(filter.status ? { status: filter.status } : {}),
  };
  return withOrgContext(organizationId, async (tx) => {
    const [rows, total] = await Promise.all([
      tx.followUpEnrollment.findMany({ where, orderBy: [{ enrolledAt: "desc" }, { id: "asc" }], skip: filter.skip, take: filter.take }),
      tx.followUpEnrollment.count({ where }),
    ]);
    return { rows, total };
  });
}

export function listRunRows(organizationId: string, enrollmentId: string) {
  return withOrgContext(organizationId, (tx) => tx.followUpRun.findMany({ where: { organizationId, enrollmentId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }));
}

export function sequenceNames(organizationId: string, ids: string[]) {
  return withOrgContext(organizationId, async (tx) => new Map((await tx.followUpSequence.findMany({ where: { organizationId, id: { in: ids } }, select: { id: true, name: true } })).map((s) => [s.id, s.name])));
}

/** Pause, resume or end an enrolment, with its log row, only when it is in one of the states the change is allowed from. */
export function transitionEnrollment(
  organizationId: string,
  id: string,
  from: ("ACTIVE" | "PAUSED")[],
  data: Prisma.FollowUpEnrollmentUncheckedUpdateInput,
  log: { kind: "PAUSE" | "RESUME" | "EXIT"; result: string; actorMembershipId?: string | null },
) {
  return withOrgContext(organizationId, async (tx) => {
    const changed = await tx.followUpEnrollment.updateMany({ where: { id, organizationId, status: { in: from } }, data });
    if (changed.count === 0) return null;
    await tx.followUpRun.create({ data: { organizationId, enrollmentId: id, kind: log.kind, result: log.result, actorMembershipId: log.actorMembershipId ?? null } });
    return tx.followUpEnrollment.findFirstOrThrow({ where: { id, organizationId } });
  });
}

// ---- Engine ----------------------------------------------------------------------------------------------------------------------------

/** Enrolments whose next step is due, for sequences that are switched on, oldest first. */
export function findDueEnrollments(organizationId: string, now: Date, limit: number) {
  return withOrgContext(organizationId, async (tx) => {
    const active = await tx.followUpSequence.findMany({ where: { organizationId, isActive: true }, select: { id: true } });
    return tx.followUpEnrollment.findMany({
      where: { organizationId, status: "ACTIVE", nextRunAt: { lte: now }, sequenceId: { in: active.map((s) => s.id) } },
      orderBy: [{ nextRunAt: "asc" }, { id: "asc" }],
      take: limit,
    });
  });
}

/** Claims a step: false when another worker (or an earlier run) already holds it. */
export async function claimStep(organizationId: string, enrollmentId: string, position: number): Promise<string | null> {
  try {
    const row = await withOrgContext(organizationId, (tx) =>
      tx.followUpRun.create({ data: { organizationId, enrollmentId, kind: "STEP", position, outcome: "PENDING", result: "Running." }, select: { id: true } }),
    );
    return row.id;
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
}

export function finishStep(organizationId: string, runId: string, outcome: "DONE" | "SKIPPED" | "FAILED", result: string, links: { taskId?: string; communicationId?: string } = {}) {
  return withOrgContext(organizationId, (tx) =>
    tx.followUpRun.update({ where: { id: runId }, data: { outcome, result, taskId: links.taskId ?? null, communicationId: links.communicationId ?? null } }),
  );
}

export function getStepRun(organizationId: string, enrollmentId: string, position: number) {
  return withOrgContext(organizationId, (tx) => tx.followUpRun.findFirst({ where: { organizationId, enrollmentId, kind: "STEP", position } }));
}

export function stepsOf(organizationId: string, sequenceId: string) {
  return withOrgContext(organizationId, (tx) => tx.followUpStep.findMany({ where: { organizationId, sequenceId }, orderBy: { position: "asc" } }));
}

export function advanceEnrollment(organizationId: string, id: string, data: { nextPosition: number; nextRunAt: Date | null; lastStepAt: Date; status?: "ACTIVE" | "COMPLETED"; endedAt?: Date; endReason?: EndReason }) {
  return withOrgContext(organizationId, (tx) =>
    tx.followUpEnrollment.updateMany({
      where: { id, organizationId, status: "ACTIVE" },
      data: { nextPosition: data.nextPosition, nextRunAt: data.nextRunAt, lastStepAt: data.lastStepAt, ...(data.status ? { status: data.status } : {}), ...(data.endedAt ? { endedAt: data.endedAt, endReason: data.endReason } : {}) },
    }),
  );
}

export interface SubjectState {
  exists: boolean;
  archivedAt: Date | null;
  closed: boolean;
  ownerMembershipId: string | null;
  contactId: string | null;
  contactEmail: string | null;
  companyId: string | null;
}

/** The record an enrolment is on: whether it still exists, is archived or closed, who owns it and who to write to. */
export function loadSubject(organizationId: string, subject: { type: "LEAD" | "DEAL"; leadId: string | null; dealId: string | null }): Promise<SubjectState> {
  return withOrgContext(organizationId, async (tx) => {
    const none: SubjectState = { exists: false, archivedAt: null, closed: false, ownerMembershipId: null, contactId: null, contactEmail: null, companyId: null };
    if (subject.type === "LEAD" && subject.leadId) {
      const lead = await tx.lead.findFirst({ where: { id: subject.leadId, organizationId }, include: { leadStatus: { select: { key: true } }, contact: { select: { email: true } } } });
      if (!lead) return none;
      const { leadIsClosed } = await import("../lib/sequences");
      return { exists: true, archivedAt: lead.archivedAt, closed: leadIsClosed({ statusKey: lead.leadStatus.key, convertedAt: lead.convertedAt }), ownerMembershipId: lead.ownerMembershipId, contactId: lead.contactId, contactEmail: lead.contact?.email ?? null, companyId: lead.companyId };
    }
    if (subject.type === "DEAL" && subject.dealId) {
      const deal = await tx.deal.findFirst({ where: { id: subject.dealId, organizationId }, include: { primaryContact: { select: { email: true } } } });
      if (!deal) return none;
      return { exists: true, archivedAt: deal.archivedAt, closed: deal.outcome !== "OPEN", ownerMembershipId: deal.ownerMembershipId, contactId: deal.primaryContactId, contactEmail: deal.primaryContact?.email ?? null, companyId: deal.companyId };
    }
    return none;
  });
}

/** An inbound message after `since` on the record, or on its contact: the person wrote back. */
export function hasReplySince(organizationId: string, subject: { leadId: string | null; dealId: string | null; contactId: string | null }, since: Date) {
  const or: Prisma.CommunicationWhereInput[] = [];
  if (subject.leadId) or.push({ leadId: subject.leadId });
  if (subject.dealId) or.push({ dealId: subject.dealId });
  if (subject.contactId) or.push({ contactId: subject.contactId });
  if (or.length === 0) return Promise.resolve(false);
  return withOrgContext(organizationId, async (tx) => (await tx.communication.count({ where: { organizationId, direction: "INBOUND", occurredAt: { gt: since }, OR: or } })) > 0);
}

export function ownerUser(organizationId: string, membershipId: string) {
  return adminDb.membership.findFirst({ where: { id: membershipId, organizationId }, select: { userId: true, status: true } });
}

export function createStepTask(input: { organizationId: string; title: string; description: string | null; assigneeMembershipId: string; dueAt: Date; priority: "LOW" | "MEDIUM" | "HIGH"; leadId?: string; dealId?: string; companyId?: string; contactId?: string }) {
  return withOrgContext(input.organizationId, (tx) =>
    tx.task.create({
      data: {
        organizationId: input.organizationId,
        title: input.title,
        description: input.description ?? undefined,
        assigneeMembershipId: input.assigneeMembershipId,
        createdByMembershipId: input.assigneeMembershipId,
        dueAt: input.dueAt,
        priority: input.priority,
        leadId: input.leadId,
        dealId: input.dealId,
        companyId: input.companyId,
        contactId: input.contactId,
      },
      select: { id: true },
    }),
  );
}

/**
 * A reply was logged: every running enrolment on that lead or deal, or on a lead or deal whose contact wrote, is paused.
 * Returns how many were paused. Called after a communication is stored and never throws into the caller.
 */
export function pauseEnrollmentsForReply(organizationId: string, comm: { leadId: string | null; dealId: string | null; contactId: string | null; occurredAt: Date }) {
  return withOrgContext(organizationId, async (tx) => {
    const leadIds = new Set<string>();
    const dealIds = new Set<string>();
    if (comm.leadId) leadIds.add(comm.leadId);
    if (comm.dealId) dealIds.add(comm.dealId);
    if (comm.contactId) {
      for (const l of await tx.lead.findMany({ where: { organizationId, contactId: comm.contactId }, select: { id: true } })) leadIds.add(l.id);
      for (const d of await tx.deal.findMany({ where: { organizationId, primaryContactId: comm.contactId }, select: { id: true } })) dealIds.add(d.id);
    }
    if (leadIds.size === 0 && dealIds.size === 0) return 0;
    const running = await tx.followUpEnrollment.findMany({
      where: { organizationId, status: "ACTIVE", OR: [{ leadId: { in: [...leadIds] } }, { dealId: { in: [...dealIds] } }] },
      select: { id: true, enrolledAt: true },
    });
    // A message from before the person was enrolled is not a reply to the sequence.
    const toPause = running.filter((e) => comm.occurredAt > e.enrolledAt);
    for (const e of toPause) {
      await tx.followUpEnrollment.updateMany({ where: { id: e.id, organizationId, status: "ACTIVE" }, data: { status: "PAUSED", pausedAt: new Date(), pauseReason: "REPLY" as PauseReason } });
      await tx.followUpRun.create({ data: { organizationId, enrollmentId: e.id, kind: "PAUSE", result: "Paused because the person replied." } });
    }
    return toPause.length;
  });
}
