import type { Prisma } from "@prisma/client";
import { withOrgContext } from "../db/orgScopedClient";
import type { DeliveryMode } from "../notifications/teamActivity";

/** FIG-1600: storage for the team-activity preferences and the digest queue. Both tables are tenant tables (row-level security). */

export interface TeamPreferenceRow {
  membershipId: string;
  eventKey: string;
  inAppEnabled: boolean;
  emailEnabled: boolean;
  pushEnabled: boolean;
  mode: string | null;
}

export function listTeamPreferences(organizationId: string, membershipIds: string[]): Promise<TeamPreferenceRow[]> {
  return withOrgContext(organizationId, (tx) =>
    tx.teamActivityPreference.findMany({
      where: { organizationId, membershipId: { in: membershipIds } },
      select: { membershipId: true, eventKey: true, inAppEnabled: true, emailEnabled: true, pushEnabled: true, mode: true },
    }),
  );
}

export function upsertTeamPreference(
  organizationId: string,
  membershipId: string,
  eventKey: string,
  change: { inAppEnabled?: boolean; emailEnabled?: boolean; pushEnabled?: boolean; mode?: DeliveryMode },
) {
  return withOrgContext(organizationId, (tx) =>
    tx.teamActivityPreference.upsert({
      where: { organizationId_membershipId_eventKey: { organizationId, membershipId, eventKey } },
      update: change,
      create: { organizationId, membershipId, eventKey, ...change },
    }),
  );
}

export interface PendingInput {
  organizationId: string;
  recipientMembershipId: string;
  eventKey: string;
  actorMembershipId: string | null;
  entityType: string;
  entityId: string;
  label: string;
  path: string;
  detail: Prisma.InputJsonValue | null;
}

export function addPending(input: PendingInput) {
  const { detail, ...rest } = input;
  return withOrgContext(input.organizationId, (tx) =>
    tx.teamActivityPending.create({ data: { ...rest, ...(detail === null ? {} : { detail }) } }),
  );
}

/**
 * One transaction for the fan-out of a single event: read the recipients' preferences, let `decide` choose what to hold for a
 * digest, and queue those rows together. A request that creates a lead pays for one extra round trip, however many managers there are.
 */
export function readPrefsAndQueue<R>(
  organizationId: string,
  membershipIds: string[],
  decide: (prefs: TeamPreferenceRow[]) => { rows: PendingInput[]; result: R },
): Promise<R> {
  return withOrgContext(organizationId, async (tx) => {
    const prefs = await tx.teamActivityPreference.findMany({
      where: { organizationId, membershipId: { in: membershipIds } },
      select: { membershipId: true, eventKey: true, inAppEnabled: true, emailEnabled: true, pushEnabled: true, mode: true },
    });
    const { rows, result } = decide(prefs);
    if (rows.length > 0) {
      await tx.teamActivityPending.createMany({
        data: rows.map(({ detail, ...rest }) => ({ ...rest, ...(detail === null ? {} : { detail }) })),
      });
    }
    return result;
  });
}

export function listUndispatched(organizationId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.teamActivityPending.findMany({ where: { organizationId, dispatchedAt: null }, orderBy: { createdAt: "asc" } }),
  );
}

export function markDispatched(organizationId: string, ids: string[], now: Date) {
  return withOrgContext(organizationId, (tx) =>
    tx.teamActivityPending.updateMany({ where: { organizationId, id: { in: ids }, dispatchedAt: null }, data: { dispatchedAt: now } }),
  );
}

export function countTeamNotificationsSince(organizationId: string, membershipId: string, since: Date) {
  return withOrgContext(organizationId, (tx) =>
    tx.notification.count({ where: { organizationId, membershipId, type: "TEAM_ACTIVITY", createdAt: { gte: since } } }),
  );
}

/** Held items that were already sent are tidied away after a week. */
export function deleteDispatchedBefore(organizationId: string, cutoff: Date) {
  return withOrgContext(organizationId, (tx) =>
    tx.teamActivityPending.deleteMany({ where: { organizationId, dispatchedAt: { not: null, lt: cutoff } } }),
  );
}
