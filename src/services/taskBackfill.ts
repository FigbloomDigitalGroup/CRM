import { adminDb } from "../db/adminClient";
import { followUpTitle } from "./taskLinkService";

/**
 * Backfills for P2-22 and P2-23. Additive only (nothing is deleted or changed on an existing row), idempotent (a second run finds nothing to do:
 * the task has a unique source activity, and a lead with an open follow-up task is skipped), dry run unless told to apply.
 *
 *  1. Calls and meetings that were added from the Calendar before the fix are timeline activities with no task, so the Tasks page never showed
 *     them. They are told apart from a call that was logged after it happened by their time: the call was dated later than the moment it was saved.
 *     Each gets a task (type CALL or MEETING, due at that time, owned by the person who added it, linked to the same record) that points back at the activity.
 *  2. Open leads with a Next follow-up but no open follow-up task get one, owned by the lead's owner, due at the same date and time.
 */
export interface BackfillReport {
  dryRun: boolean;
  calendarActivities: { found: number; created: number };
  leadFollowUps: { found: number; created: number; skippedNoOwner: number };
}

const SCHEDULED_AHEAD_MS = 60_000;

export async function backfillTaskLinks(options: { apply?: boolean; organizationId?: string } = {}): Promise<BackfillReport> {
  const apply = options.apply === true;
  const orgWhere = options.organizationId ? { organizationId: options.organizationId } : {};
  const report: BackfillReport = { dryRun: !apply, calendarActivities: { found: 0, created: 0 }, leadFollowUps: { found: 0, created: 0, skippedNoOwner: 0 } };

  const candidates = await adminDb.activity.findMany({
    where: { ...orgWhere, type: { in: ["CALL", "MEETING"] }, tasks: { none: {} } },
    select: { id: true, organizationId: true, type: true, subject: true, description: true, occurredAt: true, createdAt: true, authorMembershipId: true, companyId: true, contactId: true, leadId: true, dealId: true },
  });
  const orphans = candidates.filter((a) => a.occurredAt.getTime() - a.createdAt.getTime() > SCHEDULED_AHEAD_MS);
  report.calendarActivities.found = orphans.length;
  if (apply) {
    for (const a of orphans) {
      try {
        await adminDb.task.create({
          data: {
            organizationId: a.organizationId,
            title: a.subject?.trim() || (a.type === "CALL" ? "Call" : "Meeting"),
            description: a.description ?? undefined,
            type: a.type === "CALL" ? "CALL" : "MEETING",
            dueAt: a.occurredAt,
            assigneeMembershipId: a.authorMembershipId,
            createdByMembershipId: a.authorMembershipId,
            companyId: a.companyId,
            contactId: a.contactId,
            leadId: a.leadId,
            dealId: a.dealId,
            sourceActivityId: a.id,
          },
        });
        report.calendarActivities.created += 1;
      } catch (err) {
        if ((err as { code?: string }).code !== "P2002") throw err; // already has its task: a parallel run got there first
      }
    }
  }

  const leads = await adminDb.lead.findMany({
    where: { ...orgWhere, nextFollowUpAt: { not: null }, archivedAt: null, tasks: { none: { isFollowUp: true, archivedAt: null, status: { in: ["PENDING", "IN_PROGRESS"] } } } },
    select: {
      id: true, organizationId: true, nextFollowUpAt: true, ownerMembershipId: true, createdByMembershipId: true, companyId: true, contactId: true,
      company: { select: { name: true } }, contact: { select: { firstName: true, lastName: true } },
    },
  });
  report.leadFollowUps.found = leads.length;
  if (apply) {
    for (const l of leads) {
      const assignee = l.ownerMembershipId ?? l.createdByMembershipId;
      if (!assignee) {
        report.leadFollowUps.skippedNoOwner += 1;
        continue;
      }
      const label = l.company?.name ?? ([l.contact?.firstName, l.contact?.lastName].filter(Boolean).join(" ") || "the lead");
      try {
        await adminDb.task.create({
          data: { organizationId: l.organizationId, title: followUpTitle("TASK", label), type: "TASK", dueAt: l.nextFollowUpAt, assigneeMembershipId: assignee, createdByMembershipId: assignee, leadId: l.id, companyId: l.companyId, contactId: l.contactId, isFollowUp: true },
        });
        report.leadFollowUps.created += 1;
      } catch (err) {
        if ((err as { code?: string }).code !== "P2002") throw err;
      }
    }
  }
  return report;
}
