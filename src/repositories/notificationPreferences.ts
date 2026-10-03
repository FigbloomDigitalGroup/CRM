import { withOrgContext } from "../db/orgScopedClient";

export type NotificationTypeKey = "LEAD_ASSIGNED" | "TASK_DUE" | "TASK_OVERDUE";

export const NOTIFICATION_TYPES: NotificationTypeKey[] = [
  "LEAD_ASSIGNED",
  "TASK_DUE",
  "TASK_OVERDUE",
];

/** No row for a (membership, type) means "both channels on" -- see the model's doc comment in schema.prisma. */
const DEFAULT_PREFERENCE = { emailEnabled: true, inAppEnabled: true } as const;

export async function listPreferencesForMembership(
  organizationId: string,
  membershipId: string,
) {
  return withOrgContext(organizationId, (tx) =>
    tx.notificationPreference.findMany({
      where: { organizationId, membershipId },
    }),
  );
}

/** Effective preference for every notification type, filling in the default for any type with no override row. */
export async function resolveEffectivePreferences(
  organizationId: string,
  membershipId: string,
): Promise<Record<NotificationTypeKey, { emailEnabled: boolean; inAppEnabled: boolean }>> {
  const rows = await listPreferencesForMembership(organizationId, membershipId);
  const byType = new Map(rows.map((r) => [r.type, r]));

  const result = {} as Record<
    NotificationTypeKey,
    { emailEnabled: boolean; inAppEnabled: boolean }
  >;
  for (const type of NOTIFICATION_TYPES) {
    const row = byType.get(type);
    result[type] = row
      ? { emailEnabled: row.emailEnabled, inAppEnabled: row.inAppEnabled }
      : { ...DEFAULT_PREFERENCE };
  }
  return result;
}

export async function resolveEffectivePreference(
  organizationId: string,
  membershipId: string,
  type: NotificationTypeKey,
) {
  return withOrgContext(organizationId, async (tx) => {
    const row = await tx.notificationPreference.findUnique({
      where: {
        organizationId_membershipId_type: { organizationId, membershipId, type },
      },
    });
    return row
      ? { emailEnabled: row.emailEnabled, inAppEnabled: row.inAppEnabled }
      : { ...DEFAULT_PREFERENCE };
  });
}

export async function upsertPreference(
  organizationId: string,
  membershipId: string,
  type: NotificationTypeKey,
  input: { emailEnabled?: boolean; inAppEnabled?: boolean },
) {
  return withOrgContext(organizationId, (tx) =>
    tx.notificationPreference.upsert({
      where: {
        organizationId_membershipId_type: { organizationId, membershipId, type },
      },
      update: input,
      create: {
        organizationId,
        membershipId,
        type,
        emailEnabled: input.emailEnabled ?? DEFAULT_PREFERENCE.emailEnabled,
        inAppEnabled: input.inAppEnabled ?? DEFAULT_PREFERENCE.inAppEnabled,
      },
    }),
  );
}
