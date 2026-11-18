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

export async function sendLeadPoolEmail(
  to: string,
  args: { title: string; message: string; link: string },
  transportOverride?: MailTransport,
): Promise<void> {
  await deliverOrLog(
    "lead-pool",
    {
      to,
      subject: args.title,
      text: `${args.message}\n\nView it here: ${args.link}`,
      html: `<p><strong>${args.title}</strong></p><p>${args.message}</p><p><a href="${args.link}">View it here</a></p>`,
    },
    transportOverride,
  );
}

export async function sendDealWonHandoffEmail(
  to: string,
  args: { dealLabel: string; taskCount: number; link: string },
  transportOverride?: MailTransport,
): Promise<void> {
  const tasks = `${args.taskCount} onboarding task${args.taskCount === 1 ? "" : "s"}`;
  await deliverOrLog(
    "deal-won-handoff",
    {
      to,
      subject: `Deal won, handed off to you: ${args.dealLabel}`,
      text: `${args.dealLabel} was won and handed off to you, with ${tasks} assigned.

View it here: ${args.link}`,
      html: `<p><strong>${args.dealLabel}</strong> was won and handed off to you, with ${tasks} assigned.</p><p><a href="${args.link}">View it here</a></p>`,
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
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * FIG-598: "send and log emails from a lead/contact/deal." Unlike every
 * other function in this file, the subject/body is user-authored content,
 * not a fixed template -- `src/services/communicationService.ts#sendAndLogEmail`
 * is the only caller, and it already validates `to`/`subject` are non-empty
 * before this is reached.
 */
export async function sendComposedEmail(
  to: string,
  args: { subject: string; body: string },
  transportOverride?: MailTransport,
): Promise<void> {
  await deliverOrLog(
    "communication-email",
    {
      to,
      subject: args.subject,
      text: args.body,
      html: `<p>${escapeHtml(args.body).replace(/\n/g, "<br>")}</p>`,
    },
    transportOverride,
  );
}

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

/** B1.11: the email for the notification types that have no template of their own (mentions, renewals, proposals, stalled deals, support requests). */
export async function sendGenericNotificationEmail(
  to: string,
  args: { title: string; body: string; link: string },
  transportOverride?: MailTransport,
): Promise<void> {
  await deliverOrLog(
    "generic-notification",
    {
      to,
      subject: args.title,
      text: `${args.title}\n\n${args.body}\n\nView it here: ${args.link}`,
      html: `<p><strong>${escapeHtml(args.title)}</strong></p><p>${escapeHtml(args.body)}</p><p><a href="${escapeHtml(args.link)}">View it here</a></p>`,
    },
    transportOverride,
  );
}

/** B1.11: everything held back by the daily email cap, in one message. */
export async function sendNotificationDigestEmail(
  to: string,
  args: { items: { title: string; body: string; link: string | null }[] },
  transportOverride?: MailTransport,
): Promise<void> {
  const n = args.items.length;
  const lines = args.items.map((i) => `- ${i.title}${i.body && i.body !== i.title ? ` (${i.body})` : ""}${i.link ? `\n  ${i.link}` : ""}`);
  const rows = args.items
    .map(
      (i) =>
        `<li>${i.link ? `<a href="${escapeHtml(i.link)}">${escapeHtml(i.title)}</a>` : escapeHtml(i.title)}${
          i.body && i.body !== i.title ? ` <span>${escapeHtml(i.body)}</span>` : ""
        }</li>`,
    )
    .join("");
  await deliverOrLog(
    "notification-digest",
    {
      to,
      subject: `${n} more notification${n === 1 ? "" : "s"} for you`,
      text: `You reached your daily email limit, so these were held back:\n\n${lines.join("\n")}`,
      html: `<p>You reached your daily email limit, so these were held back:</p><ul>${rows}</ul>`,
    },
    transportOverride,
  );
}
