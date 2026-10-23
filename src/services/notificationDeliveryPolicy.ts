import { adminDb } from "../db/adminClient";
import { ALWAYS_ON_TYPES, type NotificationTypeKey } from "../notifications/catalogue";
import {
  isInQuietHours,
  nextQuietEnd,
  startOfLocalDay,
  startOfNextLocalDay,
} from "../notifications/timeZone";
import { countEmailsSentSince } from "../repositories/notificationDeliveries";
import { getNotificationSettings } from "../repositories/notificationSettings";

/**
 * When an email may actually leave (FIG-1027, B1.11). The in-app notification
 * is always immediate; only email is shaped by the person's quiet hours and
 * daily cap, both measured on their own wall clock (their time zone, else the
 * organisation's).
 *
 *   - Quiet hours: nothing is sent inside the window. The email waits and goes
 *     out when the window ends. Overdue tasks are deferred too; "cannot be
 *     turned off" means it is never silenced, not that it wakes you at night.
 *   - Daily cap: once that many emails have gone out today, further emails are
 *     held and sent together as one digest at the start of the next day (after
 *     quiet hours). Overdue-task emails are exempt from the cap.
 */
export type EmailPlan =
  | { action: "send" }
  | { action: "defer"; until: Date; reason: "QUIET_HOURS" }
  | { action: "digest"; until: Date };

export async function memberTimeZone(organizationId: string, membershipId: string): Promise<string> {
  const row = await adminDb.membership.findFirst({
    where: { id: membershipId, organizationId },
    select: { user: { select: { timeZone: true } }, organization: { select: { timezone: true } } },
  });
  return row?.user.timeZone ?? row?.organization.timezone ?? "UTC";
}

export async function planEmail(
  organizationId: string,
  membershipId: string,
  type: NotificationTypeKey,
  now: Date = new Date(),
): Promise<EmailPlan> {
  const [timeZone, settings] = await Promise.all([
    memberTimeZone(organizationId, membershipId),
    getNotificationSettings(organizationId, membershipId),
  ]);
  const quiet = settings.quietHours;

  if (isInQuietHours(now, quiet, timeZone)) {
    return { action: "defer", until: nextQuietEnd(now, quiet, timeZone), reason: "QUIET_HOURS" };
  }

  if (!ALWAYS_ON_TYPES.includes(type)) {
    const sent = await countEmailsSentSince(organizationId, membershipId, startOfLocalDay(now, timeZone));
    if (sent >= settings.dailyEmailCap) {
      let until = startOfNextLocalDay(now, timeZone);
      if (isInQuietHours(until, quiet, timeZone)) until = nextQuietEnd(until, quiet, timeZone);
      return { action: "digest", until };
    }
  }
  return { action: "send" };
}
