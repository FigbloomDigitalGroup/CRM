import { deliverOrLog, type MailTransport } from "../auth/email";

/**
 * Business notification emails (FIG-597) -- reuse the exact SMTP-or-log
 * transport from `src/auth/email.ts` (FIG-592) rather than a parallel
 * system. Deliberately no templating engine, same as that file: a plain
 * function per notification type composing `subject`/`text`/`html` inline.
 */

export async function sendLeadAssignedEmail(
  to: string,
  args: { leadLabel: string; link: string },
  transportOverride?: MailTransport,
): Promise<void> {
  await deliverOrLog(
    "lead-assigned",
    {
      to,
      subject: `New lead assigned to you: ${args.leadLabel}`,
      text: `You've been assigned a new lead: ${args.leadLabel}.\n\nView it here: ${args.link}`,
      html: `<p>You've been assigned a new lead: <strong>${args.leadLabel}</strong>.</p><p><a href="${args.link}">View it here</a></p>`,
    },
    transportOverride,
  );
}

export async function sendTaskDueEmail(
  to: string,
  args: { taskTitle: string; link: string },
  transportOverride?: MailTransport,
): Promise<void> {
  await deliverOrLog(
    "task-due",
    {
      to,
      subject: `Task due today: ${args.taskTitle}`,
      text: `Your task "${args.taskTitle}" is due today.\n\nView it here: ${args.link}`,
      html: `<p>Your task <strong>${args.taskTitle}</strong> is due today.</p><p><a href="${args.link}">View it here</a></p>`,
    },
    transportOverride,
  );
}

export async function sendTaskOverdueEmail(
  to: string,
  args: { taskTitle: string; link: string },
  transportOverride?: MailTransport,
): Promise<void> {
  await deliverOrLog(
    "task-overdue",
    {
      to,
      subject: `Task overdue: ${args.taskTitle}`,
      text: `Your task "${args.taskTitle}" is now overdue.\n\nView it here: ${args.link}`,
      html: `<p>Your task <strong>${args.taskTitle}</strong> is now overdue.</p><p><a href="${args.link}">View it here</a></p>`,
    },
    transportOverride,
  );
}

/**
 * The one notification email with no CRM account on the other end -- an
 * external enquirer, not a membership. No deep link (there's nothing in
 * the CRM for them to click through to), org-configurable (FIG-597 AC),
 * off by default -- see `src/services/notificationService.ts`'s
 * `getWebsiteAcknowledgementSetting`/`setWebsiteAcknowledgementSetting`.
 */
export async function sendWebsiteLeadAcknowledgementEmail(
  to: string,
  args: { organizationName: string; enquirerName: string },
  transportOverride?: MailTransport,
): Promise<void> {
  await deliverOrLog(
    "website-lead-acknowledgement",
    {
      to,
      subject: `Thanks for reaching out to ${args.organizationName}`,
      text: `Hi ${args.enquirerName},\n\nThanks for getting in touch with ${args.organizationName}. We've received your enquiry and someone will follow up with you shortly.`,
      html: `<p>Hi ${args.enquirerName},</p><p>Thanks for getting in touch with ${args.organizationName}. We've received your enquiry and someone will follow up with you shortly.</p>`,
    },
    transportOverride,
  );
}
