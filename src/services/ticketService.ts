import type { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { deliverOrLog } from "../auth/email";
import { NotFoundError, ValidationError } from "../auth/errors";
import { enforceRateLimit } from "../auth/rateLimiter";
import { hashToken, newToken } from "../auth/twoStep/secretBox";
import { adminDb } from "../db/adminClient";
import { withOrgContext } from "../db/orgScopedClient";
import { buildPage, resolvePaging, type PageRequest } from "../lib/pagination";
import { recordAuditEvent } from "../repositories/auditEvents";
import { requireFeature } from "./featureService";

/**
 * Customer Support: tickets and satisfaction surveys (FIG-1155, B6.23). Decision-gated: everything here needs the
 * `customer_support.role` toggle (off by default, docs/DECISIONS.md 2.4) AND the `tickets.manage` permission, which only
 * Management and the Customer Support role hold. The key carries a V1.1 release minimum, so in V1 nothing here answers.
 *
 * What a ticket holds: a customer (company), optionally a contact, a title, a status (open, waiting on the client,
 * resolved), a priority, an owner and a thread (customer messages, replies, internal notes). It never holds a deal
 * value, a cost or a payment, and the role-limited customer view (`getSupportCustomerView`) selects its fields one by
 * one for the same reason (hard rule 7, docs/MASKING.md).
 */
export const TICKET_STATUSES = ["OPEN", "WAITING_ON_CLIENT", "RESOLVED"] as const;
export const TICKET_PRIORITIES = ["HIGH", "MEDIUM", "LOW"] as const;
export const MESSAGE_KINDS = ["CUSTOMER", "STAFF", "INTERNAL"] as const;
export const SURVEY_DAYS = 30;
const MAX_COMMENT = 1000;

type TicketStatus = (typeof TICKET_STATUSES)[number];
type TicketPriority = (typeof TICKET_PRIORITIES)[number];
type MessageKind = (typeof MESSAGE_KINDS)[number];

async function guard(ctx: AuthContext): Promise<void> {
  await requireFeature(ctx.organizationId, "customer_support.role");
  requirePermission(ctx, "tickets.manage");
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], field: string, fallback: T): T {
  if (value === undefined) return fallback;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new ValidationError(`${field} must be one of ${allowed.join(", ")}.`, [{ path: field, message: `Choose ${allowed.join(", ")}.` }]);
  }
  return value as T;
}

function cleanText(value: string | null | undefined, field: string, max: number, required = false): string | null {
  const text = (value ?? "").trim();
  if (!text) {
    if (required) throw new ValidationError(`${field} is required.`, [{ path: field, message: `${field} is required.` }]);
    return null;
  }
  if (text.length > max) throw new ValidationError(`${field} must be at most ${max} characters.`, [{ path: field, message: `At most ${max} characters.` }]);
  return text;
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

export interface TicketView {
  id: string;
  number: number;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  company: { id: string; name: string };
  contact: { id: string; name: string } | null;
  owner: { membershipId: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface TicketMessageView {
  id: string;
  kind: string;
  author: string;
  body: string;
  at: string;
}

const TICKET_INCLUDE_LOOKUP = async (tx: Prisma.TransactionClient, rows: { companyId: string; contactId: string | null; ownerMembershipId: string | null }[]) => {
  const companies = new Map((await tx.company.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.companyId))] } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  const contactIds = [...new Set(rows.map((r) => r.contactId).filter((x): x is string => !!x))];
  const contacts = new Map((await tx.contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, firstName: true, lastName: true } })).map((c) => [c.id, [c.firstName, c.lastName].filter(Boolean).join(" ")]));
  const ownerIds = [...new Set(rows.map((r) => r.ownerMembershipId).filter((x): x is string => !!x))];
  const owners = new Map((await tx.membership.findMany({ where: { id: { in: ownerIds } }, select: { id: true, user: { select: { name: true } } } })).map((m) => [m.id, m.user.name]));
  return { companies, contacts, owners };
};

function present(
  t: { id: string; number: number; title: string; description: string | null; status: string; priority: string; companyId: string; contactId: string | null; ownerMembershipId: string | null; createdAt: Date; updatedAt: Date; resolvedAt: Date | null },
  lookup: Awaited<ReturnType<typeof TICKET_INCLUDE_LOOKUP>>,
): TicketView {
  return {
    id: t.id,
    number: t.number,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    company: { id: t.companyId, name: lookup.companies.get(t.companyId) ?? "" },
    contact: t.contactId ? { id: t.contactId, name: lookup.contacts.get(t.contactId) ?? "" } : null,
    owner: t.ownerMembershipId ? { membershipId: t.ownerMembershipId, name: lookup.owners.get(t.ownerMembershipId) ?? "" } : null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    resolvedAt: t.resolvedAt?.toISOString() ?? null,
  };
}

export interface CreateTicketInput {
  companyId: string;
  contactId?: string | null;
  title: string;
  description?: string | null;
  priority?: string;
  ownerMembershipId?: string | null;
}

export async function createTicket(ctx: AuthContext, input: CreateTicketInput): Promise<TicketView> {
  await guard(ctx);
  requirePermission(ctx, "companies.view");
  const title = cleanText(input.title, "title", 160, true)!;
  const description = cleanText(input.description, "description", 5000);
  const priority = oneOf<TicketPriority>(input.priority, TICKET_PRIORITIES, "priority", "MEDIUM");

  const created = await withOrgContext(ctx.organizationId, async (tx) => {
    const company = await tx.company.findFirst({ where: { id: input.companyId, archivedAt: null } });
    if (!company) throw new NotFoundError("Company", input.companyId);
    if (input.contactId) {
      const contact = await tx.contact.findFirst({ where: { id: input.contactId, companyId: company.id, archivedAt: null } });
      if (!contact) throw new ValidationError("That contact does not belong to this customer.", [{ path: "contactId", message: "Not a contact of this customer." }]);
    }
    if (input.ownerMembershipId) {
      const owner = await tx.membership.findFirst({ where: { id: input.ownerMembershipId, status: "ACTIVE" } });
      if (!owner) throw new ValidationError("The owner must be an active member.", [{ path: "ownerMembershipId", message: "Not an active member." }]);
    }
    // Running number per organisation, one at a time per organisation.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"tickets:" + ctx.organizationId}))`;
    const last = await tx.ticket.aggregate({ _max: { number: true } });
    return tx.ticket.create({
      data: {
        organizationId: ctx.organizationId,
        number: (last._max.number ?? 0) + 1,
        companyId: company.id,
        contactId: input.contactId ?? null,
        title,
        description,
        priority,
        ownerMembershipId: input.ownerMembershipId ?? null,
        openedByMembershipId: ctx.membershipId,
      },
    });
  });
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "ticket.created",
    entityType: "Ticket",
    entityId: created.id,
    metadata: { number: created.number, priority },
  });
  return withOrgContext(ctx.organizationId, async (tx) => present(created, await TICKET_INCLUDE_LOOKUP(tx, [created])));
}

export interface ListTicketsFilters {
  status?: string;
  priority?: string;
  ownerMembershipId?: string;
  companyId?: string;
  q?: string;
}

export async function listTickets(ctx: AuthContext, filters: ListTicketsFilters = {}, page: PageRequest = {}) {
  await guard(ctx);
  const paging = resolvePaging(page);
  const where: Prisma.TicketWhereInput = {
    ...(filters.status ? { status: oneOf(filters.status, TICKET_STATUSES, "status", "OPEN") } : {}),
    ...(filters.priority ? { priority: oneOf(filters.priority, TICKET_PRIORITIES, "priority", "MEDIUM") } : {}),
    ...(filters.ownerMembershipId ? { ownerMembershipId: filters.ownerMembershipId } : {}),
    ...(filters.companyId ? { companyId: filters.companyId } : {}),
    ...(filters.q?.trim() ? { title: { contains: filters.q.trim(), mode: "insensitive" as const } } : {}),
  };
  return withOrgContext(ctx.organizationId, async (tx) => {
    const [rows, total] = await Promise.all([
      tx.ticket.findMany({ where, orderBy: [{ createdAt: "desc" }, { number: "desc" }], skip: paging.skip, take: paging.take }),
      tx.ticket.count({ where }),
    ]);
    const lookup = await TICKET_INCLUDE_LOOKUP(tx, rows);
    return buildPage(rows.map((r) => present(r, lookup)), total, paging);
  });
}

export async function getTicket(ctx: AuthContext, ticketId: string): Promise<TicketView & { messages: TicketMessageView[] }> {
  await guard(ctx);
  return withOrgContext(ctx.organizationId, async (tx) => {
    const ticket = await tx.ticket.findFirst({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundError("Ticket", ticketId);
    const [lookup, messages] = await Promise.all([
      TICKET_INCLUDE_LOOKUP(tx, [ticket]),
      tx.ticketMessage.findMany({ where: { ticketId }, orderBy: { createdAt: "asc" } }),
    ]);
    const authorIds = [...new Set(messages.map((m) => m.authorMembershipId).filter((x): x is string => !!x))];
    const authors = new Map((await tx.membership.findMany({ where: { id: { in: authorIds } }, select: { id: true, user: { select: { name: true } } } })).map((m) => [m.id, m.user.name]));
    return {
      ...present(ticket, lookup),
      messages: messages.map((m) => ({
        id: m.id,
        kind: m.kind,
        author: m.authorMembershipId ? (authors.get(m.authorMembershipId) ?? "Former member") : (m.authorLabel ?? "Customer"),
        body: m.body,
        at: m.createdAt.toISOString(),
      })),
    };
  });
}

export interface UpdateTicketInput {
  title?: string;
  status?: string;
  priority?: string;
  ownerMembershipId?: string | null;
}

export async function updateTicket(ctx: AuthContext, ticketId: string, input: UpdateTicketInput): Promise<TicketView> {
  await guard(ctx);
  const result = await withOrgContext(ctx.organizationId, async (tx) => {
    const ticket = await tx.ticket.findFirst({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundError("Ticket", ticketId);
    const data: Prisma.TicketUncheckedUpdateInput = {};
    const changes: Record<string, string | null> = {};
    if (input.title !== undefined) {
      data.title = cleanText(input.title, "title", 160, true)!;
    }
    if (input.status !== undefined) {
      const status = oneOf<TicketStatus>(input.status, TICKET_STATUSES, "status", "OPEN");
      if (status !== ticket.status) {
        data.status = status;
        data.resolvedAt = status === "RESOLVED" ? new Date() : null;
        changes.status = `${ticket.status} to ${status}`;
      }
    }
    if (input.priority !== undefined) {
      const priority = oneOf<TicketPriority>(input.priority, TICKET_PRIORITIES, "priority", "MEDIUM");
      if (priority !== ticket.priority) {
        data.priority = priority;
        changes.priority = `${ticket.priority} to ${priority}`;
      }
    }
    if (input.ownerMembershipId !== undefined && input.ownerMembershipId !== ticket.ownerMembershipId) {
      if (input.ownerMembershipId) {
        const owner = await tx.membership.findFirst({ where: { id: input.ownerMembershipId, status: "ACTIVE" } });
        if (!owner) throw new ValidationError("The owner must be an active member.", [{ path: "ownerMembershipId", message: "Not an active member." }]);
      }
      data.ownerMembershipId = input.ownerMembershipId;
      changes.owner = "changed";
    }
    const saved = Object.keys(data).length > 0 ? await tx.ticket.update({ where: { id: ticket.id }, data: { ...data, updatedAt: new Date() } }) : ticket;
    return { saved, changes, lookup: await TICKET_INCLUDE_LOOKUP(tx, [saved]) };
  });
  if (Object.keys(result.changes).length > 0) {
    await recordAuditEvent({
      organizationId: ctx.organizationId,
      actorMembershipId: ctx.membershipId,
      action: "ticket.updated",
      entityType: "Ticket",
      entityId: ticketId,
      metadata: result.changes,
    });
  }
  return present(result.saved, result.lookup);
}

export async function addTicketMessage(ctx: AuthContext, ticketId: string, input: { kind: string; body: string; authorLabel?: string | null }): Promise<TicketMessageView> {
  await guard(ctx);
  const kind = oneOf<MessageKind>(input.kind, MESSAGE_KINDS, "kind", "STAFF");
  const body = cleanText(input.body, "body", 5000, true)!;
  const label = kind === "CUSTOMER" ? cleanText(input.authorLabel, "authorLabel", 120) : null;
  const row = await withOrgContext(ctx.organizationId, async (tx) => {
    const ticket = await tx.ticket.findFirst({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundError("Ticket", ticketId);
    const message = await tx.ticketMessage.create({
      data: {
        organizationId: ctx.organizationId,
        ticketId,
        kind,
        body,
        authorMembershipId: kind === "CUSTOMER" ? null : ctx.membershipId,
        authorLabel: label,
      },
    });
    await tx.ticket.update({ where: { id: ticketId }, data: { updatedAt: new Date() } });
    return message;
  });
  return { id: row.id, kind: row.kind, author: kind === "CUSTOMER" ? (label ?? "Customer") : "You", body: row.body, at: row.createdAt.toISOString() };
}

// ---------------------------------------------------------------------------
// Satisfaction surveys
// ---------------------------------------------------------------------------

function appUrl(): string {
  return process.env.APP_BASE_URL ?? "http://localhost:3000";
}

export interface SurveyView {
  id: string;
  companyId: string;
  ticketId: string | null;
  sentAt: string;
  expiresAt: string;
  status: "WAITING" | "ANSWERED" | "EXPIRED";
  score: number | null;
  comment: string | null;
}

function presentSurvey(s: { id: string; companyId: string; ticketId: string | null; sentAt: Date; expiresAt: Date; respondedAt: Date | null; score: number | null; comment: string | null }): SurveyView {
  return {
    id: s.id,
    companyId: s.companyId,
    ticketId: s.ticketId,
    sentAt: s.sentAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
    status: s.respondedAt ? "ANSWERED" : s.expiresAt.getTime() <= Date.now() ? "EXPIRED" : "WAITING",
    score: s.score,
    comment: s.comment,
  };
}

/** Emails the customer's contact a one-question survey (1 to 5, optional comment). For a ticket, only once it is resolved, and only one open survey per ticket. */
export async function sendSurvey(ctx: AuthContext, input: { ticketId?: string | null; companyId?: string; contactId?: string | null }): Promise<SurveyView> {
  await guard(ctx);
  const token = newToken();
  const row = await withOrgContext(ctx.organizationId, async (tx) => {
    let companyId = input.companyId;
    let contactId = input.contactId ?? null;
    let ticketId: string | null = null;
    if (input.ticketId) {
      const ticket = await tx.ticket.findFirst({ where: { id: input.ticketId } });
      if (!ticket) throw new NotFoundError("Ticket", input.ticketId);
      if (ticket.status !== "RESOLVED") throw new ValidationError("Send a survey once the ticket is resolved.");
      const open = await tx.satisfactionSurvey.count({ where: { ticketId: ticket.id, respondedAt: null, expiresAt: { gt: new Date() } } });
      if (open > 0) throw new ValidationError("A survey for this ticket is already waiting for an answer.");
      ticketId = ticket.id;
      companyId = ticket.companyId;
      contactId = contactId ?? ticket.contactId;
    }
    if (!companyId) throw new ValidationError("Choose a ticket or a customer.");
    const company = await tx.company.findFirst({ where: { id: companyId } });
    if (!company) throw new NotFoundError("Company", companyId);
    const contact = contactId
      ? await tx.contact.findFirst({ where: { id: contactId, companyId: company.id, archivedAt: null } })
      : await tx.contact.findFirst({ where: { companyId: company.id, archivedAt: null, email: { not: null } }, orderBy: { createdAt: "asc" } });
    if (!contact?.email) throw new ValidationError("This customer has no contact with an email address to send the survey to.");
    return tx.satisfactionSurvey.create({
      data: {
        organizationId: ctx.organizationId,
        companyId: company.id,
        contactId: contact.id,
        ticketId,
        tokenHash: hashToken(token),
        sentToEmail: contact.email,
        sentByMembershipId: ctx.membershipId,
        expiresAt: new Date(Date.now() + SURVEY_DAYS * 24 * 60 * 60 * 1000),
      },
    });
  });
  const org = await adminDb.organization.findUnique({ where: { id: ctx.organizationId }, select: { name: true } });
  const link = `${appUrl()}/survey/${token}`;
  await deliverOrLog("satisfaction-survey", {
    to: row.sentToEmail,
    subject: `How did ${org?.name ?? "we"} do?`,
    text: `We would like to know how we did. It takes one click.\n\n${link}\n\nThe link works once and expires in ${SURVEY_DAYS} days.`,
    html: `<p>We would like to know how we did. It takes one click.</p><p><a href="${link}">${link}</a></p><p>The link works once and expires in ${SURVEY_DAYS} days.</p>`,
  }).catch((err) => console.error("[survey] could not send:", err instanceof Error ? err.message : "unknown error"));
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "survey.sent", entityType: "SatisfactionSurvey", entityId: row.id });
  return presentSurvey(row);
}

export async function listSurveys(ctx: AuthContext, filters: { companyId?: string } = {}, page: PageRequest = {}) {
  await guard(ctx);
  const paging = resolvePaging(page);
  const where: Prisma.SatisfactionSurveyWhereInput = filters.companyId ? { companyId: filters.companyId } : {};
  return withOrgContext(ctx.organizationId, async (tx) => {
    const [rows, total, answered] = await Promise.all([
      tx.satisfactionSurvey.findMany({ where, orderBy: { sentAt: "desc" }, skip: paging.skip, take: paging.take }),
      tx.satisfactionSurvey.count({ where }),
      tx.satisfactionSurvey.aggregate({ where: { ...where, respondedAt: { not: null } }, _avg: { score: true }, _count: { _all: true } }),
    ]);
    return {
      ...buildPage(rows.map(presentSurvey), total, paging),
      summary: { sent: total, answered: answered._count._all, averageScore: answered._avg.score === null ? null : Math.round(answered._avg.score * 10) / 10 },
    };
  });
}

// ---- the customer's side: a link with a token, no sign-in ----

async function limitSurvey(ip: string | null): Promise<void> {
  await enforceRateLimit("SURVEY_RESPONSE", [{ scope: "ip", key: ip, windowMs: 15 * 60_000, max: 60 }]);
}

async function findSurvey(token: string) {
  if (!token || token.length > 200) return null;
  const row = await adminDb.satisfactionSurvey.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row) return null;
  const org = await adminDb.organization.findUnique({ where: { id: row.organizationId }, select: { name: true } });
  return { row, organizationName: org?.name ?? "" };
}

/** What the survey page needs: the organisation's name and whether the link still works. Nothing else about the organisation or the customer. */
export async function openSurvey(token: string, ip: string | null): Promise<{ status: "open" | "answered" | "expired" | "unknown"; organizationName?: string }> {
  await limitSurvey(ip);
  const found = await findSurvey(token);
  if (!found) return { status: "unknown" };
  if (found.row.respondedAt) return { status: "answered", organizationName: found.organizationName };
  if (found.row.expiresAt.getTime() <= Date.now()) return { status: "expired", organizationName: found.organizationName };
  return { status: "open", organizationName: found.organizationName };
}

/** One answer per link. */
export async function answerSurvey(token: string, input: { score: number; comment?: string | null }, ip: string | null): Promise<{ thanks: true }> {
  await limitSurvey(ip);
  if (!Number.isInteger(input.score) || input.score < 1 || input.score > 5) {
    throw new ValidationError("Choose a score from 1 to 5.", [{ path: "score", message: "Choose 1 to 5." }]);
  }
  const comment = cleanText(input.comment, "comment", MAX_COMMENT);
  const found = await findSurvey(token);
  if (!found || found.row.respondedAt || found.row.expiresAt.getTime() <= Date.now()) {
    throw new ValidationError("This link is not valid any more.");
  }
  const done = await withOrgContext(found.row.organizationId, (tx) =>
    tx.satisfactionSurvey.updateMany({ where: { id: found.row.id, respondedAt: null }, data: { score: input.score, comment, respondedAt: new Date() } }),
  );
  if (done.count !== 1) throw new ValidationError("This link is not valid any more.");
  return { thanks: true };
}

// ---------------------------------------------------------------------------
// The role-limited customer view
// ---------------------------------------------------------------------------

/**
 * What Customer Support sees of a customer: who they are, their contacts, which services they have and since when, their
 * tickets and satisfaction answers. Fields are chosen one by one: no deals, values, costs, margins, payments, invoices or
 * internal notes about the commercial relationship are read at all, so there is nothing to mask and nothing to leak.
 */
export async function getSupportCustomerView(ctx: AuthContext, companyId: string) {
  await guard(ctx);
  requirePermission(ctx, "companies.view");
  return withOrgContext(ctx.organizationId, async (tx) => {
    const company = await tx.company.findFirst({
      where: { id: companyId, archivedAt: null },
      select: { id: true, name: true, industry: true, location: true, phone: true, email: true, lifecycleStateId: true },
    });
    if (!company) throw new NotFoundError("Company", companyId);
    const [lifecycle, contacts, services, tickets, surveys] = await Promise.all([
      company.lifecycleStateId ? tx.customerLifecycleState.findFirst({ where: { id: company.lifecycleStateId }, select: { name: true } }) : null,
      tx.contact.findMany({ where: { companyId, archivedAt: null }, select: { id: true, firstName: true, lastName: true, jobTitle: true, email: true, phone: true }, orderBy: { createdAt: "asc" } }),
      tx.companyService.findMany({ where: { companyId }, select: { id: true, status: true, startDate: true, service: { select: { name: true } } }, orderBy: { createdAt: "asc" } }),
      tx.ticket.findMany({ where: { companyId }, select: { id: true, number: true, title: true, status: true, priority: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 50 }),
      tx.satisfactionSurvey.findMany({ where: { companyId, respondedAt: { not: null } }, select: { id: true, score: true, comment: true, respondedAt: true }, orderBy: { respondedAt: "desc" }, take: 20 }),
    ]);
    return {
      company: { id: company.id, name: company.name, industry: company.industry, location: company.location, phone: company.phone, email: company.email, lifecycle: lifecycle?.name ?? null },
      contacts: contacts.map((c) => ({ id: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(" "), jobTitle: c.jobTitle, email: c.email, phone: c.phone })),
      services: services.map((s) => ({ id: s.id, name: s.service.name, status: s.status, since: s.startDate?.toISOString().slice(0, 10) ?? null })),
      tickets: tickets.map((t) => ({ id: t.id, number: t.number, title: t.title, status: t.status, priority: t.priority, openedAt: t.createdAt.toISOString() })),
      satisfaction: surveys.map((s) => ({ id: s.id, score: s.score, comment: s.comment, answeredAt: s.respondedAt?.toISOString() ?? null })),
    };
  });
}
