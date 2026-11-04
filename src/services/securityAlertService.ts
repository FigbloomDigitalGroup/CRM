import { deliverOrLog, type MailTransport } from "../auth/email";
import { adminDb } from "../db/adminClient";
import { recordAuthAuditEvent, type AuthAuditAction } from "./authAudit";

/**
 * Unusual-activity alerts (FIG-1134, B6.02). The person is emailed when
 * something happens to their sign-in security that they should be able to
 * react to: a backup code was used, a new device signed in to an account with
 * two-step, repeated wrong codes, two-step turned off or reset, a device was
 * trusted. Each alert also lands in the audit history of the person's
 * organisations. The text never contains a code, secret or token.
 */
export type SecurityAlertKind =
  | "backup_code_used"
  | "new_device"
  | "too_many_failures"
  | "two_step_disabled"
  | "two_step_reset_by_admin"
  | "trusted_device_added"
  | "backup_codes_regenerated";

const COPY: Record<SecurityAlertKind, { subject: string; body: string }> = {
  backup_code_used: { subject: "A backup code was used to sign in", body: "A backup code was used to sign in to your FigBloom CRM account. If that was you, consider generating new backup codes." },
  new_device: { subject: "New device signed in to your account", body: "Your FigBloom CRM account was signed in from a device we have not seen before." },
  too_many_failures: { subject: "Wrong verification codes were entered", body: "Several wrong two-step codes were entered for your FigBloom CRM account and sign-in was paused." },
  two_step_disabled: { subject: "Two-step sign-in was turned off", body: "Two-step sign-in was turned off on your FigBloom CRM account." },
  two_step_reset_by_admin: { subject: "Two-step sign-in was reset by an administrator", body: "An administrator reset two-step sign-in on your FigBloom CRM account. You will be asked to set it up again." },
  trusted_device_added: { subject: "A device is now trusted", body: "A device was marked as trusted for two-step sign-in on your FigBloom CRM account." },
  backup_codes_regenerated: { subject: "New backup codes were generated", body: "New two-step backup codes were generated for your FigBloom CRM account. The old ones no longer work." },
};

const AUDIT_ACTION: Record<SecurityAlertKind, AuthAuditAction | null> = {
  backup_code_used: "auth.two_step.backup_code_used",
  new_device: null, // already recorded as a NEW_DEVICE sign-in event
  too_many_failures: "auth.two_step.failed",
  two_step_disabled: "auth.two_step.disabled",
  two_step_reset_by_admin: "auth.two_step.admin_reset",
  trusted_device_added: "auth.two_step.trusted_device_added",
  backup_codes_regenerated: "auth.two_step.backup_codes_regenerated",
};

export async function sendSecurityAlert(
  userId: string,
  kind: SecurityAlertKind,
  details: { device?: string | null; place?: string | null; remaining?: number } = {},
  transport?: MailTransport,
): Promise<void> {
  const audit = AUDIT_ACTION[kind];
  if (audit) {
    await recordAuthAuditEvent(userId, audit, {
      ...(details.device ? { device: details.device } : {}),
      ...(details.place ? { place: details.place } : {}),
      ...(details.remaining !== undefined ? { remaining: details.remaining } : {}),
    });
  }
  const user = await adminDb.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user) return;
  await emailSecurityAlert(user.email, kind, details, transport);
}

/** The email alone (no audit entry): used for organisation users above and for platform admins (platformSignInService). */
export async function emailSecurityAlert(
  to: string,
  kind: SecurityAlertKind,
  details: { device?: string | null; place?: string | null; remaining?: number } = {},
  transport?: MailTransport,
): Promise<void> {
  const where = [details.device, details.place].filter(Boolean).join(", ");
  const remaining = details.remaining !== undefined ? ` You have ${details.remaining} backup codes left.` : "";
  const copy = COPY[kind];
  try {
    await deliverOrLog(
      "security-alert",
      {
        to,
        subject: copy.subject,
        text: `${copy.body}${where ? ` (${where})` : ""}${remaining}

If this was not you, change your password and contact your administrator.`,
        html: `<p>${copy.body}${where ? ` (${where})` : ""}${remaining}</p><p>If this was not you, change your password and contact your administrator.</p>`,
      },
      transport,
    );
  } catch (err) {
    // A mail outage must never block or fail a sign-in; the audit entry is the record.
    console.error("[security-alert] could not send:", err instanceof Error ? err.message : "unknown error");
  }
}
