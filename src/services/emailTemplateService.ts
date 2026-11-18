import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { NotFoundError, ValidationError, type ValidationIssue } from "../auth/errors";
import { MERGE_FIELDS, renderMergeFields, unknownTokens, type MergeField } from "../lib/mergeFields";
import { recordAuditEvent } from "../repositories/auditEvents";
import {
  createEmailTemplate,
  deleteEmailTemplate,
  findEmailTemplateByName,
  getEmailTemplate,
  listEmailTemplates,
  updateEmailTemplate,
} from "../repositories/emailTemplates";
import { getCompany } from "./companyService";
import { getContact } from "./contactService";
import { getDeal } from "./dealService";
import { getLead } from "./leadService";

/**
 * Email templates (FIG-797). Management (`templates.manage`) writes them in
 * Settings; anyone who can send and log email (`communications.create`) can
 * pick one. Merge fields come from a fixed list, and a template naming any
 * other field is rejected when it is saved.
 */

export const MAX_SUBJECT = 200;
export const MAX_BODY = 20000;

function clean(input: { name?: string; subject?: string; body?: string }, partial: boolean) {
  const issues: ValidationIssue[] = [];
  const out: { name?: string; subject?: string; body?: string } = {};
  if (!partial || input.name !== undefined) {
    const name = (input.name ?? "").trim().replace(/\s+/g, " ");
    if (!name || name.length > 80) issues.push({ path: "name", message: "A name of 1 to 80 characters is required." });
    out.name = name;
  }
  if (!partial || input.subject !== undefined) {
    const subject = (input.subject ?? "").trim();
    if (!subject || subject.length > MAX_SUBJECT) issues.push({ path: "subject", message: `A subject of 1 to ${MAX_SUBJECT} characters is required.` });
    out.subject = subject;
  }
  if (!partial || input.body !== undefined) {
    const body = input.body ?? "";
    if (!body.trim() || body.length > MAX_BODY) issues.push({ path: "body", message: `A body of 1 to ${MAX_BODY} characters is required.` });
    out.body = body;
  }
  const unknown = unknownTokens(out.subject ?? "", out.body ?? "");
  for (const token of unknown) {
    issues.push({
      path: "body",
      message: `Unknown merge field {{${token}}}. Use one of: ${MERGE_FIELDS.map((f) => `{{${f}}}`).join(", ")}.`,
      code: "UNKNOWN_MERGE_FIELD",
    });
  }
  if (issues.length > 0) throw new ValidationError("This template is not valid.", issues);
  return out;
}

export function listMergeFields() {
  return [...MERGE_FIELDS];
}

export async function listTemplates(ctx: AuthContext, options: { includeInactive?: boolean } = {}) {
  if (options.includeInactive) requirePermission(ctx, "templates.manage");
  else if (!ctx.permissionKeys.includes("templates.manage")) requirePermission(ctx, "communications.create");
  return listEmailTemplates(ctx.organizationId, options.includeInactive === true);
}

export async function createTemplate(ctx: AuthContext, input: { name: string; subject: string; body: string }) {
  requirePermission(ctx, "templates.manage");
  const data = clean(input, false) as { name: string; subject: string; body: string };
  if (await findEmailTemplateByName(ctx.organizationId, data.name)) {
    throw new ValidationError("A template with this name already exists.", [{ path: "name", message: "Pick a different name.", code: "DUPLICATE_TEMPLATE" }]);
  }
  const template = await createEmailTemplate({ organizationId: ctx.organizationId, ...data, createdByMembershipId: ctx.membershipId });
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "email_template.created",
    entityType: "EmailTemplate",
    entityId: template.id,
    newValue: { name: template.name },
  });
  return template;
}

export async function updateTemplate(
  ctx: AuthContext,
  templateId: string,
  patch: { name?: string; subject?: string; body?: string; isActive?: boolean },
) {
  requirePermission(ctx, "templates.manage");
  const existing = await getEmailTemplate(ctx.organizationId, templateId);
  if (!existing) throw new NotFoundError("EmailTemplate", templateId);
  const data = clean(patch, true);
  // A partial edit is validated as the whole template it produces, so a body edit cannot leave a stale subject field behind.
  clean({ subject: data.subject ?? existing.subject, body: data.body ?? existing.body, name: data.name ?? existing.name }, false);
  if (data.name && data.name.toLowerCase() !== existing.name.toLowerCase()) {
    if (await findEmailTemplateByName(ctx.organizationId, data.name)) {
      throw new ValidationError("A template with this name already exists.", [{ path: "name", message: "Pick a different name.", code: "DUPLICATE_TEMPLATE" }]);
    }
  }
  const updated = await updateEmailTemplate(ctx.organizationId, templateId, { ...data, ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}) });
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: patch.isActive === false ? "email_template.deactivated" : "email_template.updated",
    entityType: "EmailTemplate",
    entityId: templateId,
    previousValue: { name: existing.name, subject: existing.subject, isActive: existing.isActive },
    newValue: { name: updated.name, subject: updated.subject, isActive: updated.isActive },
  });
  return updated;
}

export async function removeTemplate(ctx: AuthContext, templateId: string) {
  requirePermission(ctx, "templates.manage");
  const existing = await getEmailTemplate(ctx.organizationId, templateId);
  if (!existing) throw new NotFoundError("EmailTemplate", templateId);
  await deleteEmailTemplate(ctx.organizationId, templateId);
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "email_template.deleted",
    entityType: "EmailTemplate",
    entityId: templateId,
    previousValue: { name: existing.name },
  });
  return { id: templateId };
}

export interface RenderContextIds {
  contactId?: string;
  companyId?: string;
  leadId?: string;
  dealId?: string;
}

/** The values the merge fields take for the records the email is about, using only what the caller may open. */
async function valuesFor(ctx: AuthContext, ids: RenderContextIds): Promise<Partial<Record<MergeField, string | null>>> {
  const values: Partial<Record<MergeField, string | null>> = {};
  let ownerName: string | null = null;
  let contactId = ids.contactId;
  let companyId = ids.companyId;

  if (ids.dealId) {
    const deal = await getDeal(ctx, ids.dealId);
    contactId = contactId ?? deal.primaryContactId ?? undefined;
    companyId = companyId ?? deal.companyId;
    ownerName = (await ownerNameOf(ctx, deal.ownerMembershipId)) ?? ownerName;
  }
  if (ids.leadId) {
    const lead = await getLead(ctx, ids.leadId);
    contactId = contactId ?? lead.contactId ?? undefined;
    companyId = companyId ?? lead.companyId ?? undefined;
    ownerName = (await ownerNameOf(ctx, lead.ownerMembershipId)) ?? ownerName;
  }
  if (contactId) {
    const contact = await getContact(ctx, contactId);
    values["contact.firstName"] = contact.firstName;
    values["contact.lastName"] = contact.lastName;
    values["contact.fullName"] = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
    values["contact.email"] = contact.email;
    values["contact.jobTitle"] = contact.jobTitle;
    companyId = companyId ?? contact.companyId ?? undefined;
    ownerName = ownerName ?? contact.owner?.user.name ?? null;
  }
  if (companyId) {
    const company = await getCompany(ctx, companyId);
    values["company.name"] = company.name;
    values["company.website"] = company.website;
    ownerName = ownerName ?? company.owner?.user.name ?? null;
  }
  values["owner.name"] = ownerName;
  values["sender.name"] = await ownerNameOf(ctx, ctx.membershipId);
  return values;
}

async function ownerNameOf(ctx: AuthContext, membershipId: string | null): Promise<string | null> {
  if (!membershipId) return null;
  const { adminDb } = await import("../db/adminClient");
  const m = await adminDb.membership.findFirst({ where: { id: membershipId, organizationId: ctx.organizationId }, select: { user: { select: { name: true } } } });
  return m?.user.name ?? null;
}

/** Fills a template for the records an email is about; the form puts the result in the editable subject and body. */
export async function renderTemplate(ctx: AuthContext, templateId: string, ids: RenderContextIds) {
  requirePermission(ctx, "communications.create");
  const template = await getEmailTemplate(ctx.organizationId, templateId);
  if (!template || !template.isActive) throw new NotFoundError("EmailTemplate", templateId);
  const values = await valuesFor(ctx, ids);
  const subject = renderMergeFields(template.subject, values);
  const body = renderMergeFields(template.body, values);
  return { templateId, subject: subject.text, body: body.text, missing: [...new Set([...subject.missing, ...body.missing])] };
}

/** At send time: the template must exist and be in use, and no unfilled `{{field}}` may be left in the text. */
export async function assertTemplateUsable(ctx: AuthContext, templateId: string, subject: string, body: string) {
  const template = await getEmailTemplate(ctx.organizationId, templateId);
  if (!template || !template.isActive) throw new NotFoundError("EmailTemplate", templateId);
  const left = unknownTokens(subject, body);
  const filled = [...subject.matchAll(/\{\{[^}]*\}\}/g), ...body.matchAll(/\{\{[^}]*\}\}/g)];
  if (left.length > 0 || filled.length > 0) {
    throw new ValidationError("The email still contains merge fields that were not filled in.", [
      { path: "body", message: `Replace or remove ${[...new Set(filled.map((m) => m[0]))].join(", ")} before sending.`, code: "UNFILLED_MERGE_FIELD" },
    ]);
  }
  return template;
}
