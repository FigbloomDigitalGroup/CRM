import { withOrgContext } from "../db/orgScopedClient";
import { EMAIL_CAP_DEFAULT, QUIET_HOURS_DEFAULT } from "../notifications/catalogue";

export interface MemberNotificationSettings {
  quietHours: { enabled: boolean; start: string; end: string };
  dailyEmailCap: number;
}

/** Absence of a row means the defaults: quiet hours off (20:00-07:00 once on), 20 emails a day. */
export async function getNotificationSettings(
  organizationId: string,
  membershipId: string,
): Promise<MemberNotificationSettings> {
  const row = await withOrgContext(organizationId, (tx) =>
    tx.notificationSetting.findFirst({ where: { organizationId, membershipId } }),
  );
  return {
    quietHours: row
      ? { enabled: row.quietHoursEnabled, start: row.quietHoursStart, end: row.quietHoursEnd }
      : { ...QUIET_HOURS_DEFAULT },
    dailyEmailCap: row?.dailyEmailCap ?? EMAIL_CAP_DEFAULT,
  };
}

export async function saveNotificationSettings(
  organizationId: string,
  membershipId: string,
  next: MemberNotificationSettings,
) {
  const data = {
    quietHoursEnabled: next.quietHours.enabled,
    quietHoursStart: next.quietHours.start,
    quietHoursEnd: next.quietHours.end,
    dailyEmailCap: next.dailyEmailCap,
  };
  return withOrgContext(organizationId, (tx) =>
    tx.notificationSetting.upsert({
      where: { organizationId_membershipId: { organizationId, membershipId } },
      update: data,
      create: { organizationId, membershipId, ...data },
    }),
  );
}
