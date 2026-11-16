import type { Prisma } from "@prisma/client";
import type { OrgScopedClient } from "../db/orgScopedClient";
import { withOrgContext } from "../db/orgScopedClient";
import type { TaskTypeValue } from "../repositories/tasks";

/**
 * One rule for how a lead, its follow-up and its tasks agree (P2-23, FIG-1677). Every path that logs or schedules something on a
 * lead calls this file, inside the same database transaction as the original action, so the lead's "Next follow-up", the open
 * follow-up task, the Tasks page and the Calendar can never drift. The rules are in `docs/TASK_CORRELATION.md`.
 *
 * It only creates and moves what the user asked for. It never moves a deal stage, sets a discount or approves anything (hard rule 9).
 */

export const OPEN_TASK_STATUSES = ["PENDING", "IN_PROGRESS"] as const;
/** The call-to-action kinds: scheduling one on a lead makes it the lead's next step when it comes first. */
export const CTA_TASK_TYPES: readonly TaskTypeValue[] = ["CALL", "MEETING", "EMAIL", "QUOTE", "VISIT"];

const TYPE_VERB: Record<TaskTypeValue, string> = {
  TASK: "Follow up with",
  CALL: "Call",
  MEETING: "Meet",
  EMAIL: "Email",
  QUOTE: "Send quote to",
  VISIT: "Visit",
};

export function isCallToAction(type: string | undefined | null): boolean {
  return !!type && (CTA_TASK_TYPES as readonly string[]).includes(type);
}

/** "Call Acme Ltd". The name is the lead's company or contact: never a deal value (hard rule 7). */
export function followUpTitle(type: TaskTypeValue | undefined, label: string): string {
  return `${TYPE_VERB[type ?? "TASK"]} ${label}`.slice(0, 200);
}

export async function leadLabelInTx(tx: OrgScopedClient, organizationId: string, leadId: string): Promise<string> {
  const lead = await tx.lead.findFirst({
    where: { id: leadId, organizationId },
    select: { company: { select: { name: true } }, contact: { select: { firstName: true, lastName: true } } },
  });
  if (lead?.company?.name) return lead.company.name;
  if (lead?.contact) return [lead.contact.firstName, lead.contact.lastName].filter(Boolean).join(" ") || "the lead";
  return "the lead";
}

export interface FollowUpChange {
  organizationId: string;
  actorMembershipId: string;
  leadId: string;
  /** The new "Next follow-up"; null clears it. */
  nextFollowUpAt: Date | null;
  /** Who does it. Default: the person already holding the open follow-up, else the lead's owner, else the actor. Must be eligible (the caller checks). */
  assigneeMembershipId: string;
  type?: TaskTypeValue;
  title?: string;
  sourceActivityId?: string;
}

function openFollowUp(tx: OrgScopedClient, organizationId: string, leadId: string) {
  return tx.task.findFirst({
    where: { organizationId, leadId, isFollowUp: true, archivedAt: null, status: { in: [...OPEN_TASK_STATUSES] } },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Sets, moves or clears the lead's follow-up. The open follow-up task is created or moved, never duplicated (the database also allows
 * only one open follow-up task per lead). The lead's field and the task always carry the same date and time. Idempotent.
 */
export async function applyLeadFollowUp(tx: OrgScopedClient, change: FollowUpChange) {
  const { organizationId, leadId } = change;
  const existing = await openFollowUp(tx, organizationId, leadId);
  await tx.lead.update({ where: { id: leadId, organizationId }, data: { nextFollowUpAt: change.nextFollowUpAt } });
  if (!change.nextFollowUpAt) {
    if (existing) await tx.task.update({ where: { id: existing.id }, data: { status: "CANCELLED", completedAt: null } });
    return null;
  }
  if (existing) {
    const data: Prisma.TaskUncheckedUpdateInput = {};
    if (existing.dueAt?.getTime() !== change.nextFollowUpAt.getTime()) data.dueAt = change.nextFollowUpAt;
    if (change.type && change.type !== existing.type) data.type = change.type;
    if (change.title && change.title !== existing.title) data.title = change.title;
    return Object.keys(data).length ? tx.task.update({ where: { id: existing.id }, data }) : existing;
  }
  const type = change.type ?? "TASK";
  const title = change.title ?? followUpTitle(type, await leadLabelInTx(tx, organizationId, leadId));
  const lead = await tx.lead.findFirst({ where: { id: leadId, organizationId }, select: { companyId: true, contactId: true } });
  return tx.task.create({
    data: {
      organizationId,
      title,
      type,
      dueAt: change.nextFollowUpAt,
      assigneeMembershipId: change.assigneeMembershipId,
      createdByMembershipId: change.actorMembershipId,
      leadId,
      companyId: lead?.companyId ?? undefined,
      contactId: lead?.contactId ?? undefined,
      isFollowUp: true,
      sourceActivityId: change.sourceActivityId,
    },
  });
}

/**
 * A call-to-action task has just been created on a lead. If it comes before the lead's current follow-up (or there is none) it becomes
 * the follow-up: the earlier one stays as an ordinary open task, and the lead's field moves to this one's time. Otherwise it is just a task.
 */
export async function promoteIfNextStep(tx: OrgScopedClient, task: { id: string; organizationId: string; leadId: string | null; dueAt: Date | null; type: string; status: string }) {
  if (!task.leadId || !task.dueAt || !isCallToAction(task.type) || !(OPEN_TASK_STATUSES as readonly string[]).includes(task.status)) return false;
  const current = await openFollowUp(tx, task.organizationId, task.leadId);
  if (current?.dueAt && current.dueAt.getTime() <= task.dueAt.getTime()) return false;
  if (current) await tx.task.update({ where: { id: current.id }, data: { isFollowUp: false } });
  await tx.task.update({ where: { id: task.id }, data: { isFollowUp: true } });
  await tx.lead.update({ where: { id: task.leadId, organizationId: task.organizationId }, data: { nextFollowUpAt: task.dueAt } });
  return true;
}

type TaskRow = { id: string; organizationId: string; leadId: string | null; isFollowUp: boolean; status: string; dueAt: Date | null };

/**
 * A follow-up task was edited or its status changed: carry it to the lead, in the same transaction as the edit.
 * Completed: the lead's Next follow-up clears and its last-contacted time updates. Cancelled: it clears. Moved: the lead moves with it.
 */
export async function syncLeadAfterTaskChange(tx: OrgScopedClient, before: TaskRow, after: TaskRow, now = new Date()) {
  if (!after.isFollowUp || !after.leadId) return;
  const wasOpen = (OPEN_TASK_STATUSES as readonly string[]).includes(before.status);
  const isOpenNow = (OPEN_TASK_STATUSES as readonly string[]).includes(after.status);
  const where = { id: after.leadId, organizationId: after.organizationId };
  if (isOpenNow) {
    if (!wasOpen || before.dueAt?.getTime() !== after.dueAt?.getTime()) await tx.lead.update({ where, data: { nextFollowUpAt: after.dueAt } });
    return;
  }
  if (wasOpen) {
    await tx.lead.update({ where, data: after.status === "COMPLETED" ? { nextFollowUpAt: null, lastContactedAt: now } : { nextFollowUpAt: null } });
  }
}

/** Updates a task and carries the change to its lead in one transaction. Reopening a follow-up while another is open turns it into an ordinary task. */
export async function updateTaskLinked(
  organizationId: string,
  taskId: string,
  data: Prisma.TaskUncheckedUpdateInput,
) {
  return withOrgContext(organizationId, async (tx) => {
    const before = await tx.task.findFirstOrThrow({ where: { id: taskId, organizationId } });
    const reopening =
      before.isFollowUp && before.leadId && !(OPEN_TASK_STATUSES as readonly string[]).includes(before.status) && typeof data.status === "string" && (OPEN_TASK_STATUSES as readonly string[]).includes(data.status);
    const next = { ...data };
    if (reopening) {
      const other = await openFollowUp(tx, organizationId, before.leadId!);
      if (other && other.id !== taskId) next.isFollowUp = false;
    }
    const after = await tx.task.update({ where: { id: taskId, organizationId }, data: next });
    await syncLeadAfterTaskChange(tx, before, after);
    return after;
  });
}

/** An archived follow-up no longer is the lead's next step. */
export async function clearFollowUpOnArchive(organizationId: string, task: { id: string; leadId: string | null; isFollowUp: boolean; status: string }) {
  if (!task.isFollowUp || !task.leadId || !(OPEN_TASK_STATUSES as readonly string[]).includes(task.status)) return;
  await withOrgContext(organizationId, async (tx) => {
    await tx.lead.update({ where: { id: task.leadId!, organizationId }, data: { nextFollowUpAt: null } });
  });
}

/** Restoring an archived follow-up puts it back as the lead's next step unless another one has taken its place. */
export async function restoreFollowUp(organizationId: string, task: { id: string; leadId: string | null; isFollowUp: boolean; status: string; dueAt: Date | null }) {
  if (!task.isFollowUp || !task.leadId || !(OPEN_TASK_STATUSES as readonly string[]).includes(task.status)) return;
  await withOrgContext(organizationId, async (tx) => {
    const other = await tx.task.findFirst({
      where: { organizationId, leadId: task.leadId!, isFollowUp: true, archivedAt: null, status: { in: [...OPEN_TASK_STATUSES] }, id: { not: task.id } },
      select: { id: true },
    });
    if (other) await tx.task.update({ where: { id: task.id }, data: { isFollowUp: false } });
    else await tx.lead.update({ where: { id: task.leadId!, organizationId }, data: { nextFollowUpAt: task.dueAt } });
  });
}
