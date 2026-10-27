import type { AuthContext } from "../auth/context";
import { hasPermission, requirePermission } from "../auth/context";
import { NotFoundError, ValidationError, type ValidationIssue } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import { cleanText } from "../lib/inputParsing";
import { recordAuditEvent } from "../repositories/auditEvents";
import { createActivity } from "./activityService";
import { createContact } from "./contactService";
import { type DuplicateCandidate, findDuplicates } from "./duplicateService";
import { createLead } from "./leadService";
import { createTask } from "./taskService";

/**
 * Quick capture (FIG-1065, B4.08, mobile design M1): a lead in seconds from the phone. Name, phone, service, source, note.
 *
 * Sensible defaults: the caller owns it, the status is New, the source is the one the caller used last (else Physical
 * Meeting, else the first source in the list). A duplicate is warned about before anything is written, and the caller
 * chooses: open the existing record, create anyway, or merge (add what was just learned to the existing record).
 * An optional follow-up task goes in the same call. The route and the offline sync batch both wrap this in an
 * idempotency key, so a double tap or a replayed queue creates one lead.
 *
 * The warning is not an error: it is a 200 with `status: "DUPLICATE_WARNING"`, so the phone can show the choice without
 * parsing an error envelope, and nothing has been created yet.
 */

export const DUPLICATE_DECISIONS = ["OPEN_EXISTING", "CREATE_ANYWAY", "MERGE"] as const;
export type DuplicateDecision = (typeof DUPLICATE_DECISIONS)[number];

const MAX_NAME = 120;
const MAX_NOTE = 2000;
const MAX_FOLLOW_UP_TITLE = 200;

export interface QuickCaptureInput {
  name: string;
  phone?: string;
  email?: string;
  company?: string;
  serviceId?: string;
  sourceId?: string;
  note?: string;
  followUp?: { title: string; dueOn?: string };
  /** What to do about a duplicate the warning showed. Without it, a likely duplicate stops the capture. */
  duplicateDecision?: DuplicateDecision;
  /** The existing record the decision is about: a lead or a contact id from the warning. */
  duplicateId?: string;
}

function splitName(name: string): { firstName: string; lastName?: string } {
  const trimmed = name.trim().replace(/\s+/g, " ");
  const space = trimmed.indexOf(" ");
  return space === -1 ? { firstName: trimmed } : { firstName: trimmed.slice(0, space), lastName: trimmed.slice(space + 1) };
}

function summarise(c: DuplicateCandidate) {
  return { entityType: c.entityType, id: c.id, label: c.label, confidence: c.confidence, reasons: c.reasons };
}

/** Likely duplicates the caller may see: high or medium confidence, among contacts and (through them) leads. */
async function likelyDuplicates(ctx: AuthContext, query: { firstName: string; lastName?: string; phone?: string; email?: string }) {
  const contacts = await findDuplicates(ctx, {
    entity: "contact",
    firstName: query.firstName,
    lastName: query.lastName,
    phone: query.phone,
    email: query.email,
  });
  // The person is what is being captured; matching an existing company is not a duplicate (the capture links to it).
  const likely = contacts.candidates.filter((c) => c.entityType === "contact" && c.confidence !== "low");
  // A contact that already has an open lead is the stronger warning: show the lead.
  const leadsByContact = likely.length
    ? await adminDb.lead.findMany({
        where: { organizationId: ctx.organizationId, contactId: { in: likely.map((c) => c.id) }, archivedAt: null, convertedAt: null },
        select: { id: true, contactId: true, ownerMembershipId: true },
      })
    : [];
  const canSeeLeads = hasPermission(ctx, "leads.view.all");
  const out: ReturnType<typeof summarise>[] = [];
  for (const c of likely) {
    const lead = leadsByContact.find((l) => l.contactId === c.id);
    if (lead && (canSeeLeads || (hasPermission(ctx, "leads.view.own") && lead.ownerMembershipId === ctx.membershipId))) {
      out.push({ ...summarise(c), entityType: "lead" as never, id: lead.id, label: `${c.label} (open lead)` });
    } else {
      out.push(summarise(c));
    }
  }
  return { duplicates: out, hiddenCount: contacts.hiddenCount };
}

/** The status new leads start in: New, else the first active status. */
async function defaultStatusId(organizationId: string): Promise<string> {
  const status =
    (await adminDb.leadStatus.findFirst({ where: { organizationId, key: "NEW", isActive: true }, select: { id: true } })) ??
    (await adminDb.leadStatus.findFirst({ where: { organizationId, isActive: true }, orderBy: { sequence: "asc" }, select: { id: true } }));
  if (!status) throw new ValidationError("This organisation has no lead status configured.", [{ path: "(root)", message: "Ask Management to set up lead statuses." }]);
  return status.id;
}

/** The source the caller used last, else Physical Meeting, else the first active source. */
async function defaultSourceId(ctx: AuthContext): Promise<string | undefined> {
  const last = await adminDb.lead.findFirst({
    where: { organizationId: ctx.organizationId, createdByMembershipId: ctx.membershipId, leadSource: { isActive: true } },
    orderBy: { createdAt: "desc" },
    select: { leadSourceId: true },
  });
  if (last?.leadSourceId) return last.leadSourceId;
  const physical = await adminDb.leadSource.findFirst({ where: { organizationId: ctx.organizationId, key: "PHYSICAL_MEETING", isActive: true }, select: { id: true } });
  if (physical) return physical.id;
  return (await adminDb.leadSource.findFirst({ where: { organizationId: ctx.organizationId, isActive: true }, orderBy: { sequence: "asc" }, select: { id: true } }))?.id;
}

function validate(input: QuickCaptureInput): { name: string; phone?: string; email?: string; company?: string; note?: string } {
  const issues: ValidationIssue[] = [];
  const name = cleanText(input.name, "name", MAX_NAME, { required: true }) ?? "";
  const phone = cleanText(input.phone, "phone", 40) ?? undefined;
  const email = cleanText(input.email, "email", 200) ?? undefined;
  const company = cleanText(input.company, "company", 200) ?? undefined;
  const note = cleanText(input.note, "note", MAX_NOTE) ?? undefined;
  if (!phone && !email) issues.push({ path: "phone", message: "Add a phone number or an email so someone can follow up." });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) issues.push({ path: "email", message: "That does not look like an email address." });
  if (input.followUp) {
    const title = cleanText(input.followUp.title, "followUp.title", MAX_FOLLOW_UP_TITLE);
    if (!title) issues.push({ path: "followUp.title", message: "Name the follow-up." });
  }
  if (input.duplicateDecision !== undefined && !(DUPLICATE_DECISIONS as readonly string[]).includes(input.duplicateDecision)) {
    issues.push({ path: "duplicateDecision", message: `Use one of: ${DUPLICATE_DECISIONS.join(", ")}.` });
  }
  if ((input.duplicateDecision === "OPEN_EXISTING" || input.duplicateDecision === "MERGE") && !input.duplicateId) {
    issues.push({ path: "duplicateId", message: "Say which existing record you mean." });
  }
  if (issues.length > 0) throw new ValidationError("The capture is not valid.", issues);
  return { name, phone, email, company, note };
}

async function followUpFor(ctx: AuthContext, input: QuickCaptureInput, links: { leadId?: string; contactId?: string }) {
  if (!input.followUp) return null;
  const task = await createTask(ctx, {
    title: input.followUp.title,
    dueAt: input.followUp.dueOn,
    priority: "MEDIUM",
    ...links,
  });
  return { id: task.id, title: task.title, dueAt: task.dueAt };
}

/** Resolves the existing record a decision is about, among the caller's visible leads and contacts. */
async function resolveExisting(ctx: AuthContext, id: string): Promise<{ type: "lead"; id: string; contactId: string | null } | { type: "contact"; id: string }> {
  const lead = await adminDb.lead.findFirst({ where: { id, organizationId: ctx.organizationId }, select: { id: true, contactId: true, ownerMembershipId: true, archivedAt: true } });
  if (lead) {
    const may = hasPermission(ctx, "leads.view.all") || (hasPermission(ctx, "leads.view.own") && lead.ownerMembershipId === ctx.membershipId);
    if (!may) throw new NotFoundError("Lead", id);
    return { type: "lead", id: lead.id, contactId: lead.contactId };
  }
  const contact = await adminDb.contact.findFirst({ where: { id, organizationId: ctx.organizationId }, select: { id: true } });
  if (contact && hasPermission(ctx, "contacts.view")) return { type: "contact", id: contact.id };
  throw new NotFoundError("Record", id);
}

/** The status, source and company a new capture will use, looked up together; unknown ids are refused here, before anything is written. */
async function prepareCreate(ctx: AuthContext, input: QuickCaptureInput, company: string | undefined) {
  const organizationId = ctx.organizationId;
  const [statusId, sourceId, serviceOk, companyId] = await Promise.all([
    defaultStatusId(organizationId),
    input.sourceId
      ? adminDb.leadSource.findFirst({ where: { id: input.sourceId, organizationId, isActive: true }, select: { id: true } }).then((s) => s?.id)
      : defaultSourceId(ctx),
    input.serviceId
      ? adminDb.service.findFirst({ where: { id: input.serviceId, organizationId, isActive: true }, select: { id: true } }).then((s) => s !== null)
      : Promise.resolve(true),
    company
      ? adminDb.company.findFirst({ where: { organizationId, archivedAt: null, name: { equals: company, mode: "insensitive" } }, select: { id: true } }).then((c) => c?.id)
      : Promise.resolve(undefined),
  ]);
  if (input.sourceId && !sourceId) throw new ValidationError("Unknown lead source.", [{ path: "sourceId", message: "Choose one of the organisation's lead sources." }]);
  if (!serviceOk) throw new ValidationError("Unknown service.", [{ path: "serviceId", message: "Choose one of the organisation's services." }]);
  return { statusId, sourceId, companyId };
}

export async function quickCapture(ctx: AuthContext, input: QuickCaptureInput) {
  requirePermission(ctx, "leads.create");
  requirePermission(ctx, "contacts.create");
  const clean = validate(input);
  const { firstName, lastName } = splitName(clean.name);

  // The lookups a creation needs run alongside the duplicate check: they do not depend on it, and a phone is slow enough already.
  const wantsCreate = input.duplicateDecision === undefined || input.duplicateDecision === "CREATE_ANYWAY";
  const prepared = wantsCreate ? prepareCreate(ctx, input, clean.company) : null;
  prepared?.catch(() => undefined); // surfaced below if we get that far; never an unhandled rejection if we stop early

  // 1. Duplicates first, before anything is written.
  if (input.duplicateDecision === undefined) {
    const found = await likelyDuplicates(ctx, { firstName, lastName, phone: clean.phone, email: clean.email });
    if (found.duplicates.length > 0 || found.hiddenCount > 0) {
      return {
        status: "DUPLICATE_WARNING" as const,
        created: false as const,
        duplicates: found.duplicates,
        hiddenDuplicates: found.hiddenCount,
        options: [...DUPLICATE_DECISIONS],
      };
    }
  }

  // 2. Open or merge: no new record.
  if (input.duplicateDecision === "OPEN_EXISTING") {
    const existing = await resolveExisting(ctx, input.duplicateId!);
    return { status: "OPENED_EXISTING" as const, created: false as const, existing: { type: existing.type, id: existing.id } };
  }
  if (input.duplicateDecision === "MERGE") {
    const existing = await resolveExisting(ctx, input.duplicateId!);
    const contactId = existing.type === "lead" ? existing.contactId : existing.id;
    if (contactId) {
      // Fill in what the existing contact is missing, never overwrite what it has.
      const contact = await adminDb.contact.findFirst({ where: { id: contactId, organizationId: ctx.organizationId }, select: { phone: true, email: true } });
      const fill: { phone?: string; email?: string } = {};
      if (contact && !contact.phone && clean.phone) fill.phone = clean.phone;
      if (contact && !contact.email && clean.email) fill.email = clean.email;
      if (Object.keys(fill).length > 0) await adminDb.contact.update({ where: { id: contactId }, data: fill });
    }
    const links = existing.type === "lead" ? { leadId: existing.id } : { contactId: existing.id };
    if (clean.note) {
      await createActivity(ctx, { type: "NOTE", subject: "Quick capture: met again", description: clean.note, ...links });
    }
    const followUp = await followUpFor(ctx, input, links);
    await recordAuditEvent({
      organizationId: ctx.organizationId,
      actorMembershipId: ctx.membershipId,
      action: "quick_capture.merged",
      entityType: existing.type === "lead" ? "Lead" : "Contact",
      entityId: existing.id,
      metadata: { note: Boolean(clean.note), followUp: Boolean(followUp) },
    });
    return { status: "MERGED" as const, created: false as const, mergedInto: { type: existing.type, id: existing.id }, followUpTask: followUp };
  }

  // 3. Create: contact, then lead, then the optional follow-up.
  const { statusId, sourceId, companyId } = await prepared!;

  // The duplicate check ran at the top of this call (and the caller chose), so the create steps do not repeat it.
  const contactResult = await createContact(ctx, { firstName, lastName, phone: clean.phone, email: clean.email, companyId }, { skipDuplicateCheck: true });
  const contact = contactResult.contact;
  let lead;
  try {
    lead = (await createLead(ctx, { leadStatusId: statusId, leadSourceId: sourceId, serviceInterestId: input.serviceId, contactId: contact.id, companyId }, { skipDuplicateCheck: true })).lead;
  } catch (err) {
    // Nothing half-made: the contact this call created goes too.
    await adminDb.contact.delete({ where: { id: contact.id } }).catch(() => undefined);
    throw err;
  }
  const notes = [clean.note, clean.company && !companyId ? `Company: ${clean.company}` : undefined].filter(Boolean).join("\n");
  // The note and the follow-up task do not depend on each other.
  const [, followUp] = await Promise.all([
    notes ? adminDb.lead.update({ where: { id: lead.id }, data: { notes } }) : Promise.resolve(null),
    followUpFor(ctx, input, { leadId: lead.id }),
  ]);

  return {
    status: "CREATED" as const,
    created: true as const,
    lead: { id: lead.id, statusId: lead.leadStatusId, sourceId: lead.leadSourceId, serviceId: lead.serviceInterestId, ownerMembershipId: lead.ownerMembershipId, createdAt: lead.createdAt },
    contact: { id: contact.id, name: clean.name },
    followUpTask: followUp,
    duplicatesIgnored: input.duplicateDecision === "CREATE_ANYWAY",
  };
}
