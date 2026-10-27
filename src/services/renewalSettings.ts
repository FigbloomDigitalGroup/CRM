import { adminDb } from "../db/adminClient";
import { DEFAULT_RENEWAL_SETTINGS, MAX_DUE_SOON_DAYS, MAX_GRACE_DAYS, type RenewalSettings } from "../lib/renewals";

/** The organisation's renewal window and lapse grace (FIG-1051). Kept apart from the service so the lifecycle job can read it without pulling in the payment code. */
export const RENEWAL_SETTINGS_KEY = "renewals.settings";

export async function loadRenewalSettings(organizationId: string): Promise<RenewalSettings> {
  const row = await adminDb.organizationSetting.findUnique({ where: { organizationId_key: { organizationId, key: RENEWAL_SETTINGS_KEY } } });
  const value = (row?.value ?? null) as Partial<RenewalSettings> | null;
  const whole = (n: unknown, fallback: number, min: number, max: number) => (typeof n === "number" && Number.isInteger(n) && n >= min && n <= max ? n : fallback);
  return {
    dueSoonDays: whole(value?.dueSoonDays, DEFAULT_RENEWAL_SETTINGS.dueSoonDays, 1, MAX_DUE_SOON_DAYS),
    graceDays: whole(value?.graceDays, DEFAULT_RENEWAL_SETTINGS.graceDays, 0, MAX_GRACE_DAYS),
  };
}
