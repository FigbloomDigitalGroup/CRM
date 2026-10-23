import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { ValidationError } from "../auth/errors";
import { sendComposedEmail } from "../notifications/email";
import { recordAuditEvent } from "../repositories/auditEvents";
import {
  createCommunication as createCommunicationRecord,
  listCommunications as listCommunicationsRecord,
  type CreateCommunicationInput,
} from "../repositories/communications";
import { assertTemplateUsable } from "./emailTemplateService";
import { touchDealActivity } from "../repositories/deals";
import { rescoreCompanyQuietly, rescoreLeadQuietly } from "./scoreEngine";
import { assertCanAccessLinkedRecords, type LinkedRecordIds } from "./recordAccess";

export type CreateCommunicationServiceInput = Omit<
  CreateCommunicationInput,
  "organizationId" | "authorMembershipId"
>;

/**
 * "Permission-gated and audited" (FIG-598 AC) -- unlike Activity (never
 * audited, see IMPLEMENTATION_NOTES.md), every Communication create gets
 * its own audit event. There's no previous/new-value pair the way an
 * ownership change has one; the create itself, with enough of its own
 * fields to be useful in the audit log, is the event.
 */
export async function createCommunication(
  ctx: AuthContext,
  input: CreateCommunicationServiceInput,
) {
  await assertCanAccessLinkedRecords(ctx, input, { requireAtLeastOne: true, requireWritable: true });
  requirePermission(ctx, "communications.create");

  const communication = await createCommunicationRecord({
    ...input,
    organizationId: ctx.organizationId,
    authorMembershipId: ctx.membershipId,
  });

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "communication.logged",
    entityType: "Communication",
    entityId: communication.id,
    newValue: {
      channel: communication.channel,
      direction: communication.direction,
      subject: communication.subject,
      companyId: communication.companyId,
      contactId: communication.contactId,
      leadId: communication.leadId,
      dealId: communication.dealId,
    },
  });

  await rescoreLeadQuietly(ctx.organizationId, communication.leadId);
  if (communication.dealId) await touchDealActivity(ctx.organizationId, communication.dealId);
  await rescoreCompanyQuietly(ctx.organizationId, communication.companyId);
  return communication;
}

async function listCommunicationsFor(ctx: AuthContext, ids: LinkedRecordIds) {
  await assertCanAccessLinkedRecords(ctx, ids);
  requirePermission(ctx, "communications.view");
  return listCommunicationsRecord(ctx.organizationId, ids);
}

export function listCommunicationsForCompany(ctx: AuthContext, companyId: string) {
  return listCommunicationsFor(ctx, { companyId });
}

export function listCommunicationsForContact(ctx: AuthContext, contactId: string) {
  return listCommunicationsFor(ctx, { contactId });
}

export function listCommunicationsForLead(ctx: AuthContext, leadId: string) {
  return listCommunicationsFor(ctx, { leadId });
}

export function listCommunicationsForDeal(ctx: AuthContext, dealId: string) {
  return listCommunicationsFor(ctx, { dealId });
}

export interface SendEmailServiceInput {
  to: string;
  subject: string;
  body: string;
  companyId?: string;
  contactId?: string;
  leadId?: string;
  dealId?: string;
  /** The template the subject and body started from (FIG-797). The text may have been edited since; it is recorded on the communication. */
  templateId?: string;
}

/**
 * "Send and log emails from a lead/contact/deal" (FIG-598 AC) -- reuses the
 * exact SMTP-or-log transport already wired for every other outbound email
 * in this project (FIG-592/597), so this genuinely sends real mail once
 * `SMTP_HOST` is configured, not a stand-in. A send that actually throws
 * (SMTP configured but the real attempt failed) surfaces as a
 * `ValidationError` and logs nothing -- logging a Communication for an
 * email that was never sent would be a false record, worse than no record.
 */
export async function sendAndLogEmail(ctx: AuthContext, input: SendEmailServiceInput) {
  await assertCanAccessLinkedRecords(ctx, input, { requireAtLeastOne: true, requireWritable: true });
  requirePermission(ctx, "communications.create");

  if (!input.to.trim()) {
    throw new ValidationError("A recipient email address is required.");
  }
  if (!input.subject.trim()) {
    throw new ValidationError("A subject is required.");
  }

  if (input.templateId) await assertTemplateUsable(ctx, input.templateId, input.subject, input.body);

  try {
    await sendComposedEmail(input.to, { subject: input.subject, body: input.body });
  } catch (err) {
    throw new ValidationError(
      `Failed to send email: ${err instanceof Error ? err.message : "unknown error"}.`,
    );
  }

  const communication = await createCommunicationRecord({
    organizationId: ctx.organizationId,
    channel: "EMAIL",
    direction: "OUTBOUND",
    subject: input.subject,
    summary: input.body,
    authorMembershipId: ctx.membershipId,
    companyId: input.companyId,
    contactId: input.contactId,
    leadId: input.leadId,
    dealId: input.dealId,
    emailTemplateId: input.templateId,
  });

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "communication.logged",
    entityType: "Communication",
    entityId: communication.id,
    newValue: {
      templateId: input.templateId,
      channel: "EMAIL",
      direction: "OUTBOUND",
      subject: input.subject,
      to: input.to,
      companyId: input.companyId,
      contactId: input.contactId,
      leadId: input.leadId,
      dealId: input.dealId,
    },
  });

  await rescoreLeadQuietly(ctx.organizationId, input.leadId);
  if (input.dealId) await touchDealActivity(ctx.organizationId, input.dealId);
  await rescoreCompanyQuietly(ctx.organizationId, input.companyId);
  return communication;
}
