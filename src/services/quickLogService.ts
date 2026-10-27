import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { ValidationError } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import { cleanText, parseOptionalDate } from "../lib/inputParsing";
import { createActivity } from "../repositories/activities";
import { recordAuditEvent } from "../repositories/auditEvents";
import { createCommunication } from "../repositories/communications";
import { touchDealActivity } from "../repositories/conversations";
import { createTask } from "../repositories/tasks";
import { resolveLinks, type LinkTarget } from "./conversationService";
import { whatsappLinkFor } from "./integrationRegistryService";
import { assertEligibleTaskAssignee } from "./ownerEligibility";
import { rescoreLeadQuietly } from "./scoreEngine";

/**
 * Quick-log (FIG-1054, B3.08, design C3 and M2): tapping call or WhatsApp on a record opens a prompt afterwards, and one
 * tap saves what happened. It writes the timeline activity and the conversation, updates "last contacted" and the lead
 * score signals, and can leave a follow-up task. Mobile may send the same request twice; the route wraps it in an
 * idempotency key so a double-tap logs once.
 *
 * "Reached" is the only outcome that counts as contact: a call nobody answered updates the timeline but not "last
 * contacted".
 */

export const QUICK_LOG_CHANNELS = ["CALL", "WHATSAPP"] as const;
export const QUICK_LOG_OUTCOMES = ["REACHED", "NO_ANSWER", "LEFT_MESSAGE"] as const;
export type QuickLogChannel = (typeof QUICK_LOG_CHANNELS)[number];
export type QuickLogOutcome = (typeof QUICK_LOG_OUTCOMES)[number];

/** Numbers without a country code are taken to be Kenyan, like the rest of the CRM's data. */
export const DEFAULT_COUNTRY_CODE = "254";

const OUTCOME_LABEL: Record<QuickLogOutcome, string> = { REACHED: "Reached", NO_ANSWER: "No answer", LEFT_MESSAGE: "Left a message" };
const MAX_NOTE = 2000;
const MAX_DURATION_SECONDS = 24 * 60 * 60;

/** `tel:` and `wa.me` forms of a phone number, or null when it has no digits to dial. */
export function dialLinks(phone: string | null | undefined): { tel: string; whatsapp: string; digits: string } | null {
  if (!phone) return null;
  const hasPlus = phone.trim().startsWith("+");
  let digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return null;
  if (!hasPlus) {
    if (digits.startsWith("00")) digits = digits.slice(2);
    else if (digits.startsWith("0")) digits = DEFAULT_COUNTRY_CODE + digits.slice(1);
    else if (digits.length <= 9) digits = DEFAULT_COUNTRY_CODE + digits;
  }
  return { tel: `tel:+${digits}`, whatsapp: `https://wa.me/${digits}`, digits };
}

interface Resolved {
  links: LinkTarget;
  /** Who or what the call is about, for the prompt and the timeline. */
  label: string;
  phone: string | null;
  contactId: string | null;
  leadId: string | null;
}

async function resolveTarget(ctx: AuthContext, target: LinkTarget): Promise<Resolved> {
  const given = [target.contactId, target.leadId, target.companyId, target.dealId].filter(Boolean);
  if (given.length !== 1) {
    throw new ValidationError("Say who this was about: one of contact, lead, company or deal.", [{ path: "contactId", message: "Give exactly one of contactId, leadId, companyId or dealId." }]);
  }
  const links = await resolveLinks(ctx, target);
  const org = ctx.organizationId;
  const contact = links.contactId ? await adminDb.contact.findFirst({ where: { id: links.contactId, organizationId: org }, select: { id: true, firstName: true, lastName: true, phone: true } }) : null;
  const company = links.companyId ? await adminDb.company.findFirst({ where: { id: links.companyId, organizationId: org }, select: { name: true, phone: true } }) : null;
  const phone = contact?.phone ?? company?.phone ?? null;
  const label = contact ? [contact.firstName, contact.lastName].filter(Boolean).join(" ") : (company?.name ?? "this record");
  return { links, label, phone, contactId: contact?.id ?? null, leadId: links.leadId ?? null };
}

/** What the prompt needs: the number to dial, or the code that says there is none. */
export async function getQuickLogPrompt(ctx: AuthContext, target: LinkTarget) {
  requirePermission(ctx, "communications.create");
  const r = await resolveTarget(ctx, target);
  const links = dialLinks(r.phone);
  // B4.03: the organisation's click-to-chat message, with the person's name filled in.
  const chat = await whatsappLinkFor(ctx.organizationId, r.phone, { name: r.label });
  return {
    label: r.label,
    phone: r.phone,
    hasPhone: links !== null,
    code: links ? null : ("NO_PHONE_ON_FILE" as const),
    telHref: links?.tel ?? null,
    whatsappHref: links?.whatsapp ?? null,
    whatsappMessageHref: chat?.href ?? null,
    whatsappMessage: chat?.message || null,
  };
}

export interface QuickLogInput extends LinkTarget {
  channel: QuickLogChannel;
  outcome: QuickLogOutcome;
  note?: string;
  durationSeconds?: number;
  /** A number used when there is none on file (or a different one was dialled). */
  phoneUsed?: string;
  followUp?: { title: string; dueOn?: string };
}

export async function quickLog(ctx: AuthContext, input: QuickLogInput, now = new Date()) {
  requirePermission(ctx, "activities.create");
  requirePermission(ctx, "communications.create");
  if (!(QUICK_LOG_CHANNELS as readonly string[]).includes(input.channel)) {
    throw new ValidationError("channel is not valid.", [{ path: "channel", message: `Use ${QUICK_LOG_CHANNELS.join(" or ")}.` }]);
  }
  if (!(QUICK_LOG_OUTCOMES as readonly string[]).includes(input.outcome)) {
    throw new ValidationError("outcome is not valid.", [{ path: "outcome", message: `Use one of ${QUICK_LOG_OUTCOMES.join(", ")}.` }]);
  }
  const note = cleanText(input.note, "note", MAX_NOTE);
  let durationSeconds: number | undefined;
  if (input.durationSeconds !== undefined) {
    if (input.channel !== "CALL") throw new ValidationError("Only a call has a duration.", [{ path: "durationSeconds", message: "Leave this out for WhatsApp." }]);
    if (!Number.isInteger(input.durationSeconds) || input.durationSeconds < 0 || input.durationSeconds > MAX_DURATION_SECONDS) {
      throw new ValidationError("durationSeconds is not valid.", [{ path: "durationSeconds", message: `A whole number of seconds from 0 to ${MAX_DURATION_SECONDS}.` }]);
    }
    durationSeconds = input.durationSeconds;
  }
  if (input.followUp) requirePermission(ctx, "tasks.create");

  const target = await resolveTarget(ctx, { companyId: input.companyId, contactId: input.contactId, leadId: input.leadId, dealId: input.dealId });
  const phone = cleanText(input.phoneUsed, "phoneUsed", 40) ?? target.phone;
  if (!dialLinks(phone)) {
    throw new ValidationError(`There is no phone number on file for ${target.label}.`, [
      { path: "phoneUsed", message: "Add a phone number to the record, or say which number you used.", code: "NO_PHONE_ON_FILE" },
    ]);
  }

  const channelLabel = input.channel === "CALL" ? "Call" : "WhatsApp";
  const outcomeLabel = OUTCOME_LABEL[input.outcome];
  const activity = await createActivity({
    organizationId: ctx.organizationId,
    type: input.channel,
    subject: `${channelLabel}: ${outcomeLabel}`,
    description: note ?? undefined,
    outcome: input.outcome,
    occurredAt: now,
    authorMembershipId: ctx.membershipId,
    companyId: target.links.companyId,
    contactId: target.links.contactId,
    leadId: target.links.leadId,
    dealId: target.links.dealId,
  });
  const communication = await createCommunication({
    organizationId: ctx.organizationId,
    channel: input.channel === "CALL" ? "PHONE" : "WHATSAPP",
    direction: "OUTBOUND",
    occurredAt: now,
    subject: `${channelLabel} with ${target.label}`,
    summary: note ?? `${channelLabel}: ${outcomeLabel}.`,
    authorMembershipId: ctx.membershipId,
    activityId: activity.id,
    companyId: target.links.companyId,
    contactId: target.links.contactId,
    leadId: target.links.leadId,
    dealId: target.links.dealId,
    counterpartyName: target.label,
    counterpartyPhone: phone ?? undefined,
    durationSeconds,
  });

  // "Last contacted" moves only when someone was actually reached.
  let lastContactedAt: Date | null = null;
  if (input.outcome === "REACHED") {
    lastContactedAt = now;
    if (target.links.contactId) await adminDb.contact.updateMany({ where: { id: target.links.contactId, organizationId: ctx.organizationId }, data: { lastContactedAt: now } });
    if (target.links.leadId) await adminDb.lead.updateMany({ where: { id: target.links.leadId, organizationId: ctx.organizationId }, data: { lastContactedAt: now } });
  }
  if (target.links.dealId) await touchDealActivity(ctx.organizationId, target.links.dealId, now);
  if (target.links.leadId) await rescoreLeadQuietly(ctx.organizationId, target.links.leadId);

  let taskId: string | null = null;
  if (input.followUp) {
    await assertEligibleTaskAssignee(ctx.organizationId, ctx.membershipId);
    const task = await createTask({
      organizationId: ctx.organizationId,
      title: cleanText(input.followUp.title, "followUp.title", 200, { required: true })!,
      assigneeMembershipId: ctx.membershipId,
      createdByMembershipId: ctx.membershipId,
      dueAt: parseOptionalDate(input.followUp.dueOn, "followUp.dueOn") ?? undefined,
      companyId: target.links.companyId,
      contactId: target.links.contactId,
      leadId: target.links.leadId,
      dealId: target.links.dealId,
    });
    taskId = task.id;
  }

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "quick_log.created",
    entityType: "Communication",
    entityId: communication.id,
    metadata: { channel: input.channel, outcome: input.outcome, activityId: activity.id, taskId },
  });
  return { activityId: activity.id, communicationId: communication.id, taskId, lastContactedAt, link: target.links };
}
