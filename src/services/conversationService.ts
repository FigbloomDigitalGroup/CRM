import type { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { deny, hasPermission, requirePermission } from "../auth/context";
import { NotFoundError, ValidationError } from "../auth/errors";
import { linkedRecordsVisibleWhere } from "../auth/visibilityWhere";
import { adminDb } from "../db/adminClient";
import { cleanText } from "../lib/inputParsing";
import { buildPage, resolvePaging, type PageRequest } from "../lib/pagination";
import { recordAuditEvent } from "../repositories/auditEvents";
import { createCommunication } from "../repositories/communications";
import {
  claimWaitingCommunication,
  countActivities,
  countCommunications,
  getCommunicationRow,
  listActivityRows,
  listCommunicationRows,
  touchDealActivity,
  type ActivityRow,
  type CommunicationRow,
} from "../repositories/conversations";
import { getContact, createContact } from "./contactService";
import { getDeal } from "./dealService";
import { findDuplicates, type DuplicateCandidate } from "./duplicateService";
import { createLead, getLead } from "./leadService";
import { assertCanAccessLinkedRecords } from "./recordAccess";
import { rescoreLeadQuietly } from "./scoreEngine";

/**
 * The Conversations hub (FIG-1053, B3.07, design E1): every email, call, WhatsApp message, meeting and note in one
 * inbox-like list, plus the Needs-linking queue for messages that arrived without a matching record (the BCC webhook,
 * a forwarded email, a logged call to an unknown number).
 *
 *   read   : `communications.view`. A row is listed only when the caller may open every record it is linked to
 *            (`linkedRecordsVisibleWhere`), so nothing about a colleague's lead or deal leaks through a message.
 *   act    : `communications.create` and `leads.create` (Management and Sales). Delivery reads the queue read-only; an
 *            attempt to act is refused with the explained no-access and written to the audit log.
 *
 * Tabs: Email, WhatsApp, Calls, Meetings and Notes. Quick-logged calls and WhatsApp messages exist as an activity and a
 * communication; the hub shows the communication once.
 */

export const CONVERSATION_TABS = ["ALL", "EMAIL", "WHATSAPP", "CALLS", "MEETINGS", "NOTES"] as const;
export type ConversationTab = (typeof CONVERSATION_TABS)[number];

const TAB_CHANNELS: Record<ConversationTab, { channels?: string[]; activityTypes?: string[] } | "all"> = {
  ALL: "all",
  EMAIL: { channels: ["EMAIL"], activityTypes: ["EMAIL"] },
  WHATSAPP: { channels: ["WHATSAPP"], activityTypes: ["WHATSAPP"] },
  CALLS: { channels: ["PHONE"], activityTypes: ["CALL"] },
  MEETINGS: { channels: ["MEETING"], activityTypes: ["MEETING"] },
  NOTES: { activityTypes: ["NOTE"] },
};

const SUMMARY_PREVIEW = 240;
const MAX_MERGE_DEPTH = 5000;

export interface ConversationAccess {
  canView: boolean;
  canAct: boolean;
  readOnly: boolean;
  /** Shown beside the disabled controls when the role may read but not act. */
  notice: string | null;
}

export function conversationAccess(ctx: Pick<AuthContext, "permissionKeys">): ConversationAccess {
  const canView = ctx.permissionKeys.includes("communications.view");
  const canAct = ctx.permissionKeys.includes("communications.create") && ctx.permissionKeys.includes("leads.create");
  return {
    canView,
    canAct,
    readOnly: canView && !canAct,
    notice: canView && !canAct ? "You can read these messages. Linking one to a record, or turning it into a lead, is for Sales and Management." : null,
  };
}

async function requireAct(ctx: AuthContext, action: string, communicationId: string | null) {
  requirePermission(ctx, "communications.view");
  if (conversationAccess(ctx).canAct) return;
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "conversation.action_denied",
    entityType: "Communication",
    entityId: communicationId ?? undefined,
    metadata: { attempted: action, role: ctx.roleKey },
  });
  throw deny(ctx, "communications.create + leads.create", ["communications.create", "leads.create"]);
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

const personName = (p: { firstName: string; lastName: string | null } | null) => (p ? [p.firstName, p.lastName].filter(Boolean).join(" ") : null);

function preview(text: string | null | undefined): string | null {
  if (!text) return null;
  return text.length > SUMMARY_PREVIEW ? `${text.slice(0, SUMMARY_PREVIEW)}…` : text;
}

export function toCommunicationItem(c: CommunicationRow) {
  return {
    id: c.id,
    kind: "COMMUNICATION" as const,
    channel: c.channel,
    direction: c.direction,
    occurredAt: c.occurredAt,
    subject: c.subject,
    summary: preview(c.summary),
    durationSeconds: c.durationSeconds,
    counterparty: { name: c.counterpartyName ?? personName(c.contact), email: c.counterpartyEmail, phone: c.counterpartyPhone },
    link: { companyId: c.companyId, companyName: c.company?.name ?? null, contactId: c.contactId, contactName: personName(c.contact), leadId: c.leadId, dealId: c.dealId },
    ownerMembershipId: c.authorMembershipId,
    needsLinking: c.needsLinking,
    linkedAt: c.linkedAt,
    dismissedAt: c.dismissedAt,
    dismissReason: c.dismissReason,
  };
}

export function toActivityItem(a: ActivityRow) {
  return {
    id: a.id,
    kind: "ACTIVITY" as const,
    channel: a.type,
    direction: null,
    occurredAt: a.occurredAt,
    subject: a.subject,
    summary: preview(a.description),
    durationSeconds: null,
    counterparty: { name: personName(a.contact), email: null, phone: null },
    link: { companyId: a.companyId, companyName: a.company?.name ?? null, contactId: a.contactId, contactName: personName(a.contact), leadId: a.leadId, dealId: a.dealId },
    ownerMembershipId: a.authorMembershipId,
    needsLinking: false,
    linkedAt: null,
    dismissedAt: null,
    dismissReason: null,
  };
}

export type ConversationItem = ReturnType<typeof toCommunicationItem> | ReturnType<typeof toActivityItem>;

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

export interface ConversationFilters {
  tab?: string;
  direction?: string;
  /** Messages and notes by this person, or about records this person owns. */
  ownerMembershipId?: string;
  q?: string;
  from?: string;
  to?: string;
}

function ownerClause(ownerMembershipId: string): Prisma.CommunicationWhereInput & Prisma.ActivityWhereInput {
  return {
    OR: [
      { authorMembershipId: ownerMembershipId },
      { lead: { ownerMembershipId } },
      { deal: { ownerMembershipId } },
      { company: { ownerMembershipId } },
    ],
  };
}

function dateClause(filters: ConversationFilters): { occurredAt?: Prisma.DateTimeFilter } {
  const range: Prisma.DateTimeFilter = {};
  if (filters.from) {
    const d = new Date(filters.from);
    if (Number.isNaN(d.getTime())) throw new ValidationError("from is not a valid date.", [{ path: "from", message: "Use a date such as 2026-11-01." }]);
    range.gte = d;
  }
  if (filters.to) {
    const d = new Date(filters.to);
    if (Number.isNaN(d.getTime())) throw new ValidationError("to is not a valid date.", [{ path: "to", message: "Use a date such as 2026-11-30." }]);
    range.lte = d;
  }
  return Object.keys(range).length > 0 ? { occurredAt: range } : {};
}

interface BuiltWhere {
  communication: Prisma.CommunicationWhereInput;
  activity: Prisma.ActivityWhereInput;
}

function buildWhere(ctx: AuthContext, filters: ConversationFilters, tab: ConversationTab): BuiltWhere {
  const visible = linkedRecordsVisibleWhere(ctx);
  const dates = dateClause(filters);
  const q = filters.q?.trim();
  const direction = filters.direction;
  if (direction !== undefined && direction !== "INBOUND" && direction !== "OUTBOUND") {
    throw new ValidationError("direction must be INBOUND or OUTBOUND.", [{ path: "direction", message: "Use INBOUND or OUTBOUND." }]);
  }
  const comm: Prisma.CommunicationWhereInput[] = [visible, { needsLinking: false, dismissedAt: null }, dates];
  const act: Prisma.ActivityWhereInput[] = [visible, dates, { communications: { none: {} } }];
  const rule = TAB_CHANNELS[tab];
  if (rule !== "all") {
    comm.push(rule.channels ? { channel: { in: rule.channels as never[] } } : { id: "__none__" });
    act.push(rule.activityTypes ? { type: { in: rule.activityTypes as never[] } } : { id: "__none__" });
  }
  if (direction) {
    comm.push({ direction });
    act.push({ id: "__none__" }); // notes and logged activities have no direction
  }
  if (filters.ownerMembershipId) {
    comm.push(ownerClause(filters.ownerMembershipId));
    act.push(ownerClause(filters.ownerMembershipId));
  }
  if (q) {
    comm.push({
      OR: [
        { subject: { contains: q, mode: "insensitive" } },
        { summary: { contains: q, mode: "insensitive" } },
        { counterpartyName: { contains: q, mode: "insensitive" } },
        { counterpartyEmail: { contains: q, mode: "insensitive" } },
        { company: { name: { contains: q, mode: "insensitive" } } },
      ],
    });
    act.push({ OR: [{ subject: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }, { company: { name: { contains: q, mode: "insensitive" } } }] });
  }
  return { communication: { AND: comm }, activity: { AND: act } };
}

export async function listConversations(ctx: AuthContext, filters: ConversationFilters = {}, request: PageRequest = {}) {
  requirePermission(ctx, "communications.view");
  const tab = (filters.tab ?? "ALL") as ConversationTab;
  if (!(CONVERSATION_TABS as readonly string[]).includes(tab)) {
    throw new ValidationError(`Unknown tab "${tab}".`, [{ path: "tab", message: `Use one of ${CONVERSATION_TABS.join(", ")}.` }]);
  }
  const canSeeActivities = hasPermission(ctx, "activities.view");
  const paging = resolvePaging(request);
  const depth = Math.min(paging.skip + paging.take, MAX_MERGE_DEPTH);
  const where = buildWhere(ctx, filters, tab);

  const [comms, acts] = await Promise.all([
    listCommunicationRows(ctx.organizationId, where.communication, depth),
    canSeeActivities ? listActivityRows(ctx.organizationId, where.activity, depth) : Promise.resolve({ rows: [] as ActivityRow[], total: 0 }),
  ]);
  const merged: ConversationItem[] = [...comms.rows.map(toCommunicationItem), ...acts.rows.map(toActivityItem)].sort(
    (a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || b.id.localeCompare(a.id),
  );
  const items = merged.slice(paging.skip, paging.skip + paging.take);

  // Counts for every tab under the same other filters, so the tab badges match what each tab would list.
  const tabCounts = Object.fromEntries(
    await Promise.all(
      CONVERSATION_TABS.map(async (t) => {
        const w = buildWhere(ctx, filters, t);
        const [c, a] = await Promise.all([countCommunications(ctx.organizationId, w.communication), canSeeActivities ? countActivities(ctx.organizationId, w.activity) : Promise.resolve(0)]);
        return [t, c + a] as const;
      }),
    ),
  ) as Record<ConversationTab, number>;

  return { ...buildPage(items, comms.total + acts.total, paging), tab, tabCounts, access: conversationAccess(ctx) };
}

// ---------------------------------------------------------------------------
// The Needs-linking queue
// ---------------------------------------------------------------------------

export async function listNeedsLinking(ctx: AuthContext, filters: { q?: string } = {}, request: PageRequest = {}) {
  requirePermission(ctx, "communications.view");
  const paging = resolvePaging(request);
  const q = filters.q?.trim();
  const where: Prisma.CommunicationWhereInput = {
    needsLinking: true,
    dismissedAt: null,
    ...(q
      ? { OR: [{ subject: { contains: q, mode: "insensitive" } }, { summary: { contains: q, mode: "insensitive" } }, { counterpartyName: { contains: q, mode: "insensitive" } }, { counterpartyEmail: { contains: q, mode: "insensitive" } }] }
      : {}),
  };
  const { rows, total } = await listCommunicationRows(ctx.organizationId, where, paging.take, paging.skip);
  return { ...buildPage(rows.map(toCommunicationItem), total, paging), access: conversationAccess(ctx) };
}

export async function getConversation(ctx: AuthContext, id: string) {
  requirePermission(ctx, "communications.view");
  const row = await getCommunicationRow(ctx.organizationId, id);
  if (!row) throw new NotFoundError("Communication", id);
  const visible = await listCommunicationRows(ctx.organizationId, { AND: [{ id }, row.needsLinking ? {} : linkedRecordsVisibleWhere(ctx)] }, 1);
  if (visible.rows.length === 0) throw new NotFoundError("Communication", id);
  return toCommunicationItem(row);
}

// ---------------------------------------------------------------------------
// Actions on a waiting message
// ---------------------------------------------------------------------------

export interface LinkTarget {
  companyId?: string;
  contactId?: string;
  leadId?: string;
  dealId?: string;
}

async function waitingOrThrow(ctx: AuthContext, id: string) {
  const row = await getCommunicationRow(ctx.organizationId, id);
  if (!row) throw new NotFoundError("Communication", id);
  // A message that already belongs to a record answers 404 unless the caller may open that record.
  if (!row.needsLinking) {
    const visible = await listCommunicationRows(ctx.organizationId, { AND: [{ id }, linkedRecordsVisibleWhere(ctx)] }, 1);
    if (visible.rows.length === 0 && !row.dismissedAt) throw new NotFoundError("Communication", id);
  }
  return row;
}

/** The records a link implies: a lead brings its contact and company, a deal its company and contact, a contact its company. */
export async function resolveLinks(ctx: AuthContext, target: LinkTarget) {
  const given = [target.companyId, target.contactId, target.leadId, target.dealId].filter(Boolean);
  if (given.length === 0) throw new ValidationError("Pick the record to link this to.", [{ path: "leadId", message: "Give a company, contact, lead or deal." }]);
  await assertCanAccessLinkedRecords(ctx, target, { requireAtLeastOne: true, requireWritable: true });
  const links: LinkTarget = { ...target };
  if (target.dealId) {
    const deal = await getDeal(ctx, target.dealId);
    links.companyId = links.companyId ?? deal.companyId;
    links.contactId = links.contactId ?? deal.primaryContactId ?? undefined;
  }
  if (target.leadId) {
    const lead = await getLead(ctx, target.leadId);
    links.companyId = links.companyId ?? lead.companyId ?? undefined;
    links.contactId = links.contactId ?? lead.contactId ?? undefined;
  }
  if (target.contactId && !links.companyId) {
    const contact = await getContact(ctx, target.contactId);
    links.companyId = contact.companyId ?? undefined;
  }
  return links;
}

const primaryOf = (t: LinkTarget): [keyof LinkTarget, string] => {
  const key = (["dealId", "leadId", "contactId", "companyId"] as const).find((k) => t[k]);
  return [key!, t[key!]!];
};

/**
 * Links a waiting message to an existing record. Idempotent: linking it again to the same record returns it as it is;
 * linking one that already belongs to a different record is refused. Once linked it is on that record's timeline.
 */
export async function linkConversation(ctx: AuthContext, id: string, target: LinkTarget, now = new Date()) {
  await requireAct(ctx, "link", id);
  const row = await waitingOrThrow(ctx, id);
  if (!target.dealId && !target.leadId && !target.contactId && !target.companyId) {
    throw new ValidationError("Pick the record to link this to.", [{ path: "leadId", message: "Give a company, contact, lead or deal." }]);
  }
  const [key, value] = primaryOf(target);
  if (!row.needsLinking) {
    if (row.linkedAt && row[key] === value) return { item: toCommunicationItem(row), alreadyLinked: true };
    if (row.dismissedAt) throw new ValidationError("This message was dismissed.", [{ path: "id", message: "Dismissed messages cannot be linked.", code: "CONVERSATION_DISMISSED" }]);
    throw new ValidationError(row.linkedAt ? "This message is already linked to a different record." : "This message already belongs to a record.", [
      { path: "id", message: "Only a waiting message can be linked.", code: row.linkedAt ? "ALREADY_LINKED" : "NOT_IN_QUEUE" },
    ]);
  }
  const links = await resolveLinks(ctx, target);
  const claimed = await claimWaitingCommunication(ctx.organizationId, id, {
    needsLinking: false,
    companyId: links.companyId ?? null,
    contactId: links.contactId ?? null,
    leadId: links.leadId ?? null,
    dealId: links.dealId ?? null,
    linkedAt: now,
    linkedByMembershipId: ctx.membershipId,
  });
  const after = (await getCommunicationRow(ctx.organizationId, id))!;
  if (claimed.count === 0) {
    // Someone linked it a moment ago: the same record is a success, a different one is refused.
    if (after.linkedAt && after[key] === value) return { item: toCommunicationItem(after), alreadyLinked: true };
    throw new ValidationError("Someone linked this message a moment ago.", [{ path: "id", message: "Already linked.", code: "ALREADY_LINKED" }]);
  }
  if (links.dealId) await touchDealActivity(ctx.organizationId, links.dealId, row.occurredAt);
  if (links.leadId) await rescoreLeadQuietly(ctx.organizationId, links.leadId);
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "communication.linked",
    entityType: "Communication",
    entityId: id,
    newValue: { companyId: links.companyId ?? null, contactId: links.contactId ?? null, leadId: links.leadId ?? null, dealId: links.dealId ?? null },
  });
  return { item: toCommunicationItem(after), alreadyLinked: false };
}

export interface CreateLeadFromConversationInput {
  /** The company, when the lead is for an existing one. */
  companyId?: string;
  serviceInterestId?: string;
  leadStatusId?: string;
  firstName?: string;
  lastName?: string;
  /** Create the lead although the duplicate check found matching records. */
  confirmDuplicate?: boolean;
}

export type CreateLeadFromConversationResult =
  | { created: true; leadId: string; contactId: string; item: ConversationItem; alreadyCreated: false }
  | { created: true; leadId: string; contactId: string | null; item: ConversationItem; alreadyCreated: true }
  | { created: false; duplicateWarning: true; duplicates: DuplicateCandidate[] };

/** Turns a waiting message into a lead (and a contact for the sender), warning first when the sender looks like a record that exists. */
export async function createLeadFromConversation(ctx: AuthContext, id: string, input: CreateLeadFromConversationInput = {}): Promise<CreateLeadFromConversationResult> {
  await requireAct(ctx, "create_lead", id);
  const row = await waitingOrThrow(ctx, id);
  if (!row.needsLinking) {
    if (row.linkedAt && row.leadId) return { created: true, leadId: row.leadId, contactId: row.contactId, item: toCommunicationItem(row), alreadyCreated: true };
    throw new ValidationError(row.dismissedAt ? "This message was dismissed." : "This message already belongs to a record.", [
      { path: "id", message: "Only a waiting message can become a lead.", code: row.dismissedAt ? "CONVERSATION_DISMISSED" : "NOT_IN_QUEUE" },
    ]);
  }
  const email = row.counterpartyEmail;
  const display = row.counterpartyName ?? (email ? email.split("@")[0]! : null);
  if (!display && !input.firstName) {
    throw new ValidationError("There is no sender to make a lead from.", [{ path: "firstName", message: "Give the person's name." }]);
  }
  const [first, ...rest] = (display ?? "").split(/\s+/).filter(Boolean);
  const firstName = cleanText(input.firstName ?? first, "firstName", 80, { required: true })!;
  const lastName = cleanText(input.lastName ?? (rest.join(" ") || undefined), "lastName", 80);

  if (!input.confirmDuplicate) {
    const found = await findDuplicates(ctx, { entity: "lead", email, phone: row.counterpartyPhone, firstName, lastName, companyId: input.companyId });
    if (found.candidates.length > 0) return { created: false, duplicateWarning: true, duplicates: found.candidates };
  }

  const status = input.leadStatusId
    ? { id: input.leadStatusId }
    : await adminDb.leadStatus.findFirst({ where: { organizationId: ctx.organizationId, key: "NEW" }, select: { id: true } });
  if (!status) throw new ValidationError("This organisation has no New lead status.", [{ path: "leadStatusId", message: "Pick a lead status." }]);

  const { contact } = await createContact(ctx, { firstName, lastName: lastName ?? undefined, email: email ?? undefined, phone: row.counterpartyPhone ?? undefined, companyId: input.companyId });
  const sourceKey = row.channel === "EMAIL" || row.channel === "PHONE" || row.channel === "WHATSAPP" ? row.channel : "OTHER";
  const source = await adminDb.leadSource.findFirst({ where: { organizationId: ctx.organizationId, key: sourceKey }, select: { id: true } });
  const { lead } = await createLead(ctx, {
    leadStatusId: status.id,
    contactId: contact.id,
    companyId: input.companyId,
    serviceInterestId: input.serviceInterestId,
    leadSourceId: source?.id,
  });
  await adminDb.lead.update({
    where: { id: lead.id },
    data: { notes: row.subject ? `Started from a message: ${row.subject}` : "Started from a message that matched no record." },
  });

  const claimed = await claimWaitingCommunication(ctx.organizationId, id, {
    needsLinking: false,
    leadId: lead.id,
    contactId: contact.id,
    companyId: input.companyId ?? null,
    linkedAt: new Date(),
    linkedByMembershipId: ctx.membershipId,
  });
  const after = (await getCommunicationRow(ctx.organizationId, id))!;
  if (claimed.count === 0 && after.leadId !== lead.id) {
    throw new ValidationError("Someone dealt with this message a moment ago.", [{ path: "id", message: "Already handled.", code: "ALREADY_LINKED" }]);
  }
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "communication.lead_created",
    entityType: "Communication",
    entityId: id,
    newValue: { leadId: lead.id, contactId: contact.id },
    metadata: { confirmedDuplicate: input.confirmDuplicate === true },
  });
  return { created: true, leadId: lead.id, contactId: contact.id, item: toCommunicationItem(after), alreadyCreated: false };
}

/** Takes a message out of the queue with a reason (spam, a newsletter, not for us). Idempotent. */
export async function dismissConversation(ctx: AuthContext, id: string, input: { reason: string }, now = new Date()) {
  await requireAct(ctx, "dismiss", id);
  const reason = cleanText(input.reason, "reason", 300, { required: true })!;
  const row = await waitingOrThrow(ctx, id);
  if (row.dismissedAt) return { item: toCommunicationItem(row), alreadyDismissed: true };
  if (!row.needsLinking) {
    throw new ValidationError("This message already belongs to a record.", [{ path: "id", message: "Only a waiting message can be dismissed.", code: "NOT_IN_QUEUE" }]);
  }
  const claimed = await claimWaitingCommunication(ctx.organizationId, id, { needsLinking: false, dismissedAt: now, dismissReason: reason, dismissedByMembershipId: ctx.membershipId });
  const after = (await getCommunicationRow(ctx.organizationId, id))!;
  if (claimed.count === 0 && !after.dismissedAt) {
    throw new ValidationError("Someone dealt with this message a moment ago.", [{ path: "id", message: "Already handled.", code: "ALREADY_LINKED" }]);
  }
  if (claimed.count > 0) {
    await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "communication.dismissed", entityType: "Communication", entityId: id, metadata: { reason } });
  }
  return { item: toCommunicationItem(after), alreadyDismissed: claimed.count === 0 };
}

export interface LogUnlinkedInput {
  channel: "EMAIL" | "PHONE" | "WHATSAPP" | "SMS" | "MEETING" | "OTHER";
  direction: "INBOUND" | "OUTBOUND";
  summary: string;
  subject?: string;
  occurredAt?: string;
  counterpartyName?: string;
  counterpartyEmail?: string;
  counterpartyPhone?: string;
}

/** A person logs a call or message that matches no record yet (an unknown number): it waits in the queue to be linked. */
export async function logUnlinkedConversation(ctx: AuthContext, input: LogUnlinkedInput) {
  requirePermission(ctx, "communications.create");
  const summary = cleanText(input.summary, "summary", 4000, { required: true })!;
  const channels = ["EMAIL", "PHONE", "WHATSAPP", "SMS", "MEETING", "OTHER"];
  if (!channels.includes(input.channel)) throw new ValidationError("channel is not valid.", [{ path: "channel", message: `Use one of ${channels.join(", ")}.` }]);
  if (input.direction !== "INBOUND" && input.direction !== "OUTBOUND") throw new ValidationError("direction is not valid.", [{ path: "direction", message: "Use INBOUND or OUTBOUND." }]);
  const name = cleanText(input.counterpartyName, "counterpartyName", 120);
  const email = cleanText(input.counterpartyEmail, "counterpartyEmail", 200)?.toLowerCase() ?? null;
  const phone = cleanText(input.counterpartyPhone, "counterpartyPhone", 40);
  if (!name && !email && !phone) {
    throw new ValidationError("Say who it was with.", [{ path: "counterpartyName", message: "Give a name, an email or a phone number." }]);
  }
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : undefined;
  if (occurredAt && Number.isNaN(occurredAt.getTime())) throw new ValidationError("occurredAt is not valid.", [{ path: "occurredAt", message: "Use a date and time." }]);
  const created = await createCommunication({
    organizationId: ctx.organizationId,
    channel: input.channel,
    direction: input.direction,
    subject: cleanText(input.subject, "subject", 200) ?? undefined,
    summary,
    occurredAt,
    authorMembershipId: ctx.membershipId,
    needsLinking: true,
    counterpartyName: name ?? undefined,
    counterpartyEmail: email ?? undefined,
    counterpartyPhone: phone ?? undefined,
  });
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "communication.logged_unlinked", entityType: "Communication", entityId: created.id });
  return getConversation(ctx, created.id);
}
