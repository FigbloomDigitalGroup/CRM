import { withOrgContext } from "../db/orgScopedClient";
import {
  ALWAYS_ON_TYPES,
  NOTIFICATION_TYPES,
  type NotificationTypeKey,
} from "../notifications/catalogue";

export { NOTIFICATION_TYPES };
export type { NotificationTypeKey };

export interface EffectivePreference {
  emailEnabled: boolean;
  inAppEnabled: boolean;
}

/** No row for a (membership, type) means "both channels on" -- see the model's doc comment in schema.prisma. */
const DEFAULT_PREFERENCE: EffectivePreference = { emailEnabled: true, inAppEnabled: true };

/** Types that can never be switched off (overdue tasks): whatever an old row says, both channels are on. */
function applyAlwaysOn(type: NotificationTypeKey, pref: EffectivePreference): EffectivePreference {
  return ALWAYS_ON_TYPES.includes(type) ? { emailEnabled: true, inAppEnabled: true } : pref;
}

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
): Promise<Record<NotificationTypeKey, EffectivePreference>> {
  const rows = await listPreferencesForMembership(organizationId, membershipId);
  const byType = new Map(rows.map((r) => [r.type, r]));

  const result = {} as Record<NotificationTypeKey, EffectivePreference>;
  for (const type of NOTIFICATION_TYPES) {
    const row = byType.get(type);
    result[type] = applyAlwaysOn(
      type,
      row ? { emailEnabled: row.emailEnabled, inAppEnabled: row.inAppEnabled } : { ...DEFAULT_PREFERENCE },
    );
  }
  return result;
}

export async function resolveEffectivePreference(
  organizationId: string,
  membershipId: string,
  type: NotificationTypeKey,
): Promise<EffectivePreference> {
  return withOrgContext(organizationId, async (tx) => {
    const row = await tx.notificationPreference.findUnique({
      where: {
        organizationId_membershipId_type: { organizationId, membershipId, type },
      },
    });
    return applyAlwaysOn(
      type,
      row ? { emailEnabled: row.emailEnabled, inAppEnabled: row.inAppEnabled } : { ...DEFAULT_PREFERENCE },
    );
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
