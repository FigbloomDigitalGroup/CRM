import type { Prisma } from "@prisma/client";
import { canWorkAccounts } from "../auth/accountAccess";
import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { ValidationError } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import { withOrgContext } from "../db/orgScopedClient";
import { recordAuditEvent } from "../repositories/auditEvents";
import { cleanEmail, cleanOptionalText, cleanRequiredText, omitNull } from "./accountValidation";
import { prepareCustomFields } from "./customFieldService";
import { assertReferencesInOrganisation, createLead, type CreateLeadServiceInput } from "./leadService";
import { notifyLeadAssigned } from "./notificationService";
import { assertEligibleLeadOwner } from "./ownerEligibility";
import { checkQualificationForSave } from "./qualificationRules";
import { rescoreLeadQuietly } from "./scoreEngine";
import { emitTeamActivity, leadLabelFor } from "./teamActivityNotifier";
import { emitWebhookEvent } from "./webhookService";

/**
 * The person and company typed on the new-lead form (FIG-1675). Everything is optional; when any of it is present the lead, the
 * company and the contact are saved together in one transaction. `role` is stored on the contact's job title: the
 * contact-to-company link is `Contact.companyId`, so the role lives beside it and no migration is needed.
 */
export interface LeadIntakeInput {
  /** Create a company with this name (name only) instead of picking one with `companyId`. */
  newCompanyName?: string;
  contact?: { name?: string; email?: string; phone?: string; role?: string };
}

export type CreateLeadWithContactInput = CreateLeadServiceInput & LeadIntakeInput;

function splitPersonName(name: string): { firstName: string; lastName?: string } {
  const t = name.trim().replace(/\s+/g, " ");
  const i = t.indexOf(" ");
  return i === -1 ? { firstName: t } : { firstName: t.slice(0, i), lastName: t.slice(i + 1) };
}

/** Entry point for the lead create routes: plain create unless the form sent a person or a new company. */
export async function createLeadFromForm(ctx: AuthContext, input: CreateLeadWithContactInput) {
  const { newCompanyName, contact, ...plain } = input;
  if (newCompanyName === undefined && contact === undefined) return { ...(await createLead(ctx, plain)), contactReused: false, companyReused: false };
  return createLeadWithContact(ctx, plain, { newCompanyName, contact });
}

/**
 * New lead with its company and contact, all in ONE database transaction: either the lead, the company (picked or new), the
 * contact (reused when the organisation already has one with that email) and the links are saved, or nothing is.
 *
 * Permissions: creating a lead does NOT imply creating records elsewhere. A new company needs `companies.create` and a new
 * contact needs `contacts.create`; linking an existing company or reusing an existing contact needs neither. The check runs
 * before anything is written. An existing contact or company is never changed here. One team alert (the lead's) goes out,
 * none for the contact or company created with it.
 */
export async function createLeadWithContact(ctx: AuthContext, input: CreateLeadServiceInput, intake: LeadIntakeInput) {
  requirePermission(ctx, "leads.create");
  const orgId = ctx.organizationId;
  const issues: { path: string; message: string }[] = [];

  const newCompanyName = intake.newCompanyName === undefined ? undefined : (cleanRequiredText(intake.newCompanyName, "Company name") ?? undefined);
  if (intake.newCompanyName !== undefined && !newCompanyName) issues.push({ path: "newCompanyName", message: "Enter the company name." });
  if (newCompanyName && input.companyId) issues.push({ path: "newCompanyName", message: "Pick an existing company or type a new one, not both." });
  let email: string | undefined;
  try {
    email = omitNull(cleanEmail(intake.contact?.email))?.toLowerCase();
  } catch {
    issues.push({ path: "contact.email", message: "Enter a valid email address." });
  }
  const phone = omitNull(cleanOptionalText(intake.contact?.phone, "Phone", 40));
  const role = omitNull(cleanOptionalText(intake.contact?.role, "Role", 80));
  const personName = cleanOptionalText(intake.contact?.name, "Name", 120) ?? undefined;
  const wantsContact = Boolean(email || phone || role || personName);
  if (wantsContact && !personName && !email) issues.push({ path: "contact.name", message: "Enter the person's name." });
  if (issues.length) throw new ValidationError("The new lead is not valid.", issues);

  let ownerMembershipId = ctx.membershipId;
  if (input.ownerMembershipId && input.ownerMembershipId !== ctx.membershipId) {
    requirePermission(ctx, "leads.assign");
    await assertEligibleLeadOwner(orgId, input.ownerMembershipId);
    ownerMembershipId = input.ownerMembershipId;
  }
  const status = await adminDb.leadStatus.findFirst({ where: { id: input.leadStatusId, organizationId: orgId }, select: { key: true } });
  await assertReferencesInOrganisation(orgId, input, status !== null);
  if (input.companyId) {
    const c = await adminDb.company.findFirst({ where: { id: input.companyId, organizationId: orgId }, select: { archivedAt: true } });
    if (c?.archivedAt) throw new ValidationError("That company is archived. Restore it or pick an active company.", [{ path: "companyId", message: "Pick an active company." }]);
  }

  // A company with the typed name is linked, not duplicated; a contact with the email is reused.
  const sameName = newCompanyName
    ? await adminDb.company.findFirst({ where: { organizationId: orgId, archivedAt: null, mergedIntoId: null, name: { equals: newCompanyName, mode: "insensitive" } }, select: { id: true } })
    : null;
  const existingContact = email
    ? await adminDb.contact.findFirst({ where: { organizationId: orgId, archivedAt: null, mergedIntoId: null, email: { equals: email, mode: "insensitive" } }, select: { id: true } })
    : null;
  const makeCompany = Boolean(newCompanyName && !sameName);
  const makeContact = wantsContact && !existingContact;
  if (makeCompany) requirePermission(ctx, "companies.create");
  if (makeContact) requirePermission(ctx, "contacts.create");

  const qualification = await checkQualificationForSave({ organizationId: orgId, serviceInterestId: input.serviceInterestId ?? null, existing: null, incoming: input.qualificationData, becomingQualified: status?.key === "QUALIFIED" });
  const custom = await prepareCustomFields(orgId, "LEAD", { incoming: input.customFields as Record<string, unknown> | undefined, mode: "create" });

  const done = await withOrgContext(orgId, async (tx) => {
    const audit = (action: string, entityType: string, entityId: string, newValue: Prisma.InputJsonValue) =>
      tx.auditEvent.create({ data: { organizationId: orgId, actorMembershipId: ctx.membershipId, action, entityType, entityId, newValue, metadata: { via: "new_lead" } } });
    let companyId = input.companyId ?? sameName?.id;
    let company: { id: string; name: string } | null = null;
    if (makeCompany && newCompanyName) {
      company = await tx.company.create({
        data: { organizationId: orgId, name: newCompanyName, createdByMembershipId: ctx.membershipId, ownerMembershipId: canWorkAccounts(ctx.permissionKeys, "companies") ? ctx.membershipId : undefined },
        select: { id: true, name: true },
      });
      companyId = company.id;
      await audit("company.created", "Company", company.id, { name: company.name });
    }
    let contactId = existingContact?.id;
    let contact: { id: string; firstName: string; lastName: string | null } | null = null;
    if (makeContact) {
      const n = splitPersonName(personName ?? (email as string).split("@")[0]);
      contact = await tx.contact.create({
        data: {
          organizationId: orgId,
          firstName: n.firstName,
          lastName: n.lastName,
          email,
          phone,
          jobTitle: role,
          companyId,
          createdByMembershipId: ctx.membershipId,
          ownerMembershipId: canWorkAccounts(ctx.permissionKeys, "contacts") ? ctx.membershipId : undefined,
        },
        select: { id: true, firstName: true, lastName: true },
      });
      contactId = contact.id;
      await audit("contact.created", "Contact", contact.id, { firstName: contact.firstName, companyId: companyId ?? null, jobTitle: role ?? null });
    }
    const lead = await tx.lead.create({
      data: {
        organizationId: orgId,
        leadStatusId: input.leadStatusId,
        companyId,
        contactId,
        leadSourceId: input.leadSourceId,
        temperature: input.temperature,
        serviceInterestId: input.serviceInterestId,
        ownerMembershipId,
        createdByMembershipId: ctx.membershipId,
        qualificationData: qualification.values as Prisma.InputJsonValue | undefined,
        customFields: custom?.values as Prisma.InputJsonValue | undefined,
      },
    });
    await audit("lead.created", "Lead", lead.id, { companyId: companyId ?? null, contactId: contactId ?? null });
    return { lead, company, contact };
  });

  if (ownerMembershipId !== ctx.membershipId) {
    await recordAuditEvent({ organizationId: orgId, actorMembershipId: ctx.membershipId, action: "lead.owner_reassigned", entityType: "Lead", entityId: done.lead.id, previousValue: { ownerMembershipId: ctx.membershipId }, newValue: { ownerMembershipId } });
    await notifyLeadAssigned(orgId, ownerMembershipId, { id: done.lead.id, label: "a new lead" });
  }
  await rescoreLeadQuietly(orgId, done.lead.id);
  if (done.company) await emitWebhookEvent({ organizationId: orgId, type: "company.created", record: done.company });
  if (done.contact) await emitWebhookEvent({ organizationId: orgId, type: "contact.created", record: done.contact });
  await emitWebhookEvent({ organizationId: orgId, type: "lead.created", record: done.lead });
  // One user action, one alert: the lead's. The contact and company made with it are not announced separately.
  await emitTeamActivity({ organizationId: orgId, eventKey: "LEAD_CREATED", actorMembershipId: ctx.membershipId, entityType: "Lead", entityId: done.lead.id, label: await leadLabelFor(orgId, done.lead), route: `leads/${done.lead.id}` });
  return { lead: done.lead, possibleDuplicates: [], duplicates: [], hiddenDuplicates: 0, contactReused: Boolean(existingContact), companyReused: Boolean(sameName) };
}
