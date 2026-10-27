import type { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { hasPermission, requirePermission } from "../auth/context";
import { ForbiddenError, ValidationError } from "../auth/errors";
import { maskAuditSnapshot, maskDeal } from "../auth/masking";
import { ownerRoleKeysForArea } from "../auth/areaOwners";
import { resolveScope } from "../auth/permissions";
import { dealVisibleWhere, linkedRecordsVisibleWhere } from "../auth/visibilityWhere";
import { ROLES } from "../../prisma/seedData";
import { fromCents, startOfDay, standingOf, toCents } from "../lib/payments";
import {
  companyDeals,
  companyHandoffs,
  companyInvoices,
  companyOpenTasks,
  companyServiceLinks,
  lifecycleStateNames,
  membershipNames,
  timelineActivities,
  timelineAudit,
  timelineCommunications,
  timelineLifecycle,
  type TimelineCursor,
} from "../repositories/customer360";
import { listRecurringRows } from "../repositories/recurringServices";
import { listAttachments } from "./attachmentService";
import { getCompany } from "./companyService";
import { listComments } from "./commentService";
import { getCustomerHealth } from "./scoreService";
import { getRecordTags } from "./tagService";
import { loadRenewalSettings } from "./renewalSettings";
import { toRecurringView } from "./recurringServiceService";

/**
 * The Customer 360 page (FIG-1047, B3.01, design C2): who they are, what they bought, what is open, what was said, what
 * they owe, what happens next, in one call that loads its sections independently.
 *
 * Every section answers with a status:
 *   `ok`            the data, with the scope it covers (organisation, own, read-only)
 *   `no_access`     the role may know the section exists but may not read it: what is needed, who owns it, and
 *                   why, instead of the section silently going missing (S4)
 *   `not_available` the feature is not in this release (tickets and the survey arrive with Customer Support)
 *
 * Masking: Delivery and Technical never receive deal values or payments; Finance gets payments; Sales sees a deal's value
 * only for deals they own (`maskDeal`). A message or note linked to a record the caller could not open is left out of the
 * timeline. An archived company is read-only data with `archived: true`.
 *
 * The page is built from a fixed number of database calls, however many deals, tasks or messages the customer has.
 */

export const SECTION_KEYS = [
  "profile",
  "services",
  "deals",
  "tasks",
  "timeline",
  "handoffs",
  "payments",
  "tickets",
  "nextFollowUp",
  "attachments",
  "comments",
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export type SectionResult<T = unknown> =
  | { status: "ok"; scope: "organisation" | "own" | "read-only"; data: T }
  | { status: "no_access"; requires: string[]; reason: string; yourRole: string; ownerRoles: string[] }
  | { status: "not_available"; reason: string };

const DEAL_LIMIT = 50;
const TASK_LIMIT = 50;
export const TIMELINE_DEFAULT_LIMIT = 25;
export const TIMELINE_MAX_LIMIT = 100;

const roleName = (key: string) => ROLES.find((r) => r.key === key)?.name ?? key;

function noAccess(ctx: AuthContext, area: string, requires: string[], reason: string): SectionResult<never> {
  const owners = ownerRoleKeysForArea(area)
    .filter((k) => !ROLES.find((r) => r.key === k)?.requiredFeature)
    .map(roleName)
    .sort();
  return { status: "no_access", requires, reason, yourRole: roleName(ctx.roleKey), ownerRoles: owners };
}

const ok = <T>(scope: "organisation" | "own" | "read-only", data: T): SectionResult<T> => ({ status: "ok", scope, data });

type Company = Awaited<ReturnType<typeof getCompany>>;

interface Environment {
  ctx: AuthContext;
  company: Company;
  now: Date;
  timeline: { cursor: TimelineCursor | null; limit: number };
}

// ---------------------------------------------------------------------------
// Cursor
// ---------------------------------------------------------------------------

export function encodeTimelineCursor(at: Date, id: string): string {
  return Buffer.from(JSON.stringify({ t: at.toISOString(), i: id })).toString("base64url");
}

export function decodeTimelineCursor(raw: string | undefined): TimelineCursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString()) as { t?: string; i?: string };
    const at = new Date(parsed.t ?? "");
    if (Number.isNaN(at.getTime()) || typeof parsed.i !== "string" || !parsed.i) throw new Error("bad");
    return { at, id: parsed.i };
  } catch {
    throw new ValidationError("The timeline cursor is not valid.", [{ path: "cursor", message: "Use the nextCursor of an earlier response." }]);
  }
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

async function profileSection(env: Environment) {
  const { ctx, company } = env;
  const [states, tags, health] = await Promise.all([
    lifecycleStateNames(ctx.organizationId),
    getRecordTags(ctx, "company", company.id).catch(() => []),
    getCustomerHealth(ctx, company.id).catch(() => null),
  ]);
  const state = states.find((s) => s.id === company.lifecycleStateId);
  return ok(company.archivedAt ? "read-only" : "organisation", {
    id: company.id,
    name: company.name,
    industry: company.industry,
    website: company.website,
    location: company.location,
    phone: company.phone,
    email: company.email,
    notes: company.notes,
    archived: company.archivedAt !== null,
    archivedAt: company.archivedAt,
    archiveReason: company.archiveReason,
    mergedIntoId: company.mergedIntoId,
    owner: company.owner ? { membershipId: company.owner.id, name: company.owner.user.name } : null,
    lifecycle: { state: state ? { id: state.id, key: state.key, name: state.name } : null, changedAt: company.lifecycleChangedAt, manual: company.lifecycleManual },
    contacts: company.contacts.filter((c) => !c.archivedAt).map((c) => ({ id: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(" "), email: c.email, phone: c.phone, jobTitle: c.jobTitle })),
    tags,
    health,
    createdAt: company.createdAt,
  });
}

async function servicesSection(env: Environment): Promise<SectionResult> {
  const { ctx, company, now } = env;
  if (!hasPermission(ctx, "company_services.view")) {
    return noAccess(ctx, "Company services", ["company_services.view"], "Services and renewals are for roles that look after customers.");
  }
  const [links, recurring, settings] = await Promise.all([
    companyServiceLinks(ctx.organizationId, company.id),
    listRecurringRows(ctx.organizationId, { companyId: company.id }, [{ renewsOn: "asc" }, { id: "asc" }], undefined, 100),
    loadRenewalSettings(ctx.organizationId),
  ]);
  const today = startOfDay(now);
  return ok(company.archivedAt ? "read-only" : "organisation", {
    services: links.map((l) => ({ id: l.id, serviceId: l.serviceId, name: l.service.name, status: l.status, startDate: l.startDate, endDate: l.endDate, notes: l.notes })),
    recurring: recurring.rows.map((r) => toRecurringView(ctx, r, today, settings)),
  });
}

function dealScope(ctx: AuthContext) {
  return resolveScope(ctx, "deals", "view").scope;
}

async function dealsSection(env: Environment): Promise<SectionResult> {
  const { ctx, company } = env;
  const visible = dealVisibleWhere(ctx);
  if (visible === null) return noAccess(ctx, "Deals", ["deals.view.all", "deals.view.own", "deals.view.won"], "Your role cannot open deals.");
  const { rows, total } = await companyDeals(ctx.organizationId, company.id, visible, DEAL_LIMIT);
  const scope = dealScope(ctx);
  return ok(scope === "organisation" ? "organisation" : scope === "own" ? "own" : "read-only", {
    total,
    items: rows.map((d) => {
      const masked = maskDeal(ctx, { ownerMembershipId: d.ownerMembershipId, value: d.value ? fromCents(toCents(d.value)) : null });
      return {
        id: d.id,
        stage: d.pipelineStage.name,
        outcome: d.outcome,
        service: d.service?.name ?? null,
        value: masked.value as string | null,
        valueMasked: masked.valueMasked,
        currency: d.currency,
        expectedCloseDate: d.expectedCloseDate,
        wonAt: d.wonAt,
        lostAt: d.lostAt,
        archived: d.archivedAt !== null,
        owner: d.owner ? { membershipId: d.owner.id, name: d.owner.user.name } : null,
      };
    }),
  });
}

function taskVisibility(ctx: AuthContext): Prisma.TaskWhereInput | null {
  if (hasPermission(ctx, "tasks.view.all")) return {};
  if (hasPermission(ctx, "tasks.view.own")) return { assigneeMembershipId: ctx.membershipId };
  return null;
}

async function tasksSection(env: Environment): Promise<SectionResult> {
  const { ctx, company } = env;
  const visible = taskVisibility(ctx);
  if (visible === null) return noAccess(ctx, "Tasks", ["tasks.view.all", "tasks.view.own"], "Your role does not work tasks. Finance keeps follow-up notes instead.");
  const { rows, total } = await companyOpenTasks(ctx.organizationId, company.id, visible, TASK_LIMIT);
  return ok(hasPermission(ctx, "tasks.view.all") ? "organisation" : "own", {
    total,
    items: rows.map((t) => ({ id: t.id, title: t.title, priority: t.priority, status: t.status, dueAt: t.dueAt, assignee: t.assignee ? { membershipId: t.assignee.id, name: t.assignee.user.name } : null, dealId: t.dealId, leadId: t.leadId })),
  });
}

interface TimelineItem {
  kind: "ACTIVITY" | "COMMUNICATION" | "LIFECYCLE" | "AUDIT";
  id: string;
  at: Date;
  title: string;
  detail: string | null;
  [key: string]: unknown;
}

const clip = (text: string | null | undefined, max = 240) => (text ? (text.length > max ? `${text.slice(0, max)}…` : text) : null);

async function timelineSection(env: Environment): Promise<SectionResult> {
  const { ctx, company, timeline } = env;
  const canActivities = hasPermission(ctx, "activities.view");
  const canMessages = hasPermission(ctx, "communications.view");
  if (!canActivities && !canMessages) {
    return noAccess(ctx, "Communications", ["activities.view", "communications.view"], "Your role cannot read the customer's history.");
  }
  const take = timeline.limit + 1;
  const visible = linkedRecordsVisibleWhere(ctx);
  const [activities, communications, lifecycle, audits, states] = await Promise.all([
    canActivities ? timelineActivities(ctx.organizationId, company.id, visible, timeline.cursor, take) : Promise.resolve([]),
    canMessages ? timelineCommunications(ctx.organizationId, company.id, visible, timeline.cursor, take) : Promise.resolve([]),
    timelineLifecycle(ctx.organizationId, company.id, timeline.cursor, take),
    hasPermission(ctx, "audit.view") ? timelineAudit(ctx.organizationId, company.id, timeline.cursor, take) : Promise.resolve([]),
    lifecycleStateNames(ctx.organizationId),
  ]);
  const stateName = new Map(states.map((s) => [s.id, s.name]));
  const items: TimelineItem[] = [
    ...activities.map((a): TimelineItem => ({ kind: "ACTIVITY", id: a.id, at: a.occurredAt, title: a.subject ?? `${a.type.toLowerCase()} logged`, detail: clip(a.description), type: a.type, outcome: a.outcome, authorMembershipId: a.authorMembershipId, dealId: a.dealId, leadId: a.leadId })),
    ...communications.map((c): TimelineItem => ({ kind: "COMMUNICATION", id: c.id, at: c.occurredAt, title: c.subject ?? `${c.channel.toLowerCase()} ${c.direction.toLowerCase()}`, detail: clip(c.summary), channel: c.channel, direction: c.direction, authorMembershipId: c.authorMembershipId, dealId: c.dealId, leadId: c.leadId })),
    ...lifecycle.map((e): TimelineItem => ({ kind: "LIFECYCLE", id: e.id, at: e.createdAt, title: `Lifecycle: ${e.fromStateId ? `${stateName.get(e.fromStateId) ?? "?"} to ` : "set to "}${stateName.get(e.toStateId) ?? "?"}`, detail: e.note, reason: e.reason, actorMembershipId: e.actorMembershipId })),
    ...audits.map((e): TimelineItem => ({ kind: "AUDIT", id: e.id, at: e.createdAt, title: e.action, detail: null, actorMembershipId: e.actorMembershipId, newValue: maskAuditSnapshot(ctx, "Company", e.newValue), previousValue: maskAuditSnapshot(ctx, "Company", e.previousValue) })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime() || b.id.localeCompare(a.id));
  const page = items.slice(0, timeline.limit);
  const last = page[page.length - 1];
  const more = items.length > timeline.limit;
  return ok("organisation", { items: page, nextCursor: more && last ? encodeTimelineCursor(last.at, last.id) : null, limit: timeline.limit });
}

async function handoffsSection(env: Environment): Promise<SectionResult> {
  const { ctx, company } = env;
  const visible = dealVisibleWhere(ctx);
  if (visible === null) return noAccess(ctx, "Handoff", ["deals.view.all", "deals.view.own", "deals.view.won"], "Your role cannot open deals, so it cannot see their handoffs.");
  const rows = await companyHandoffs(ctx.organizationId, company.id, visible);
  const names = await membershipNames(ctx.organizationId, rows.map((r) => r.deliveryOwnerMembershipId).filter((i): i is string => !!i));
  const nameOf = new Map(names.map((n) => [n.id, n.user.name]));
  return ok("read-only", {
    items: rows.map((h) => ({ id: h.id, dealId: h.dealId, status: h.status, startDate: h.startDate, deliveryOwner: h.deliveryOwnerMembershipId ? { membershipId: h.deliveryOwnerMembershipId, name: nameOf.get(h.deliveryOwnerMembershipId) ?? null } : null, ownerTakenAt: h.ownerTakenAt, deliveredAt: h.deliveredAt })),
  });
}

async function paymentsSection(env: Environment): Promise<SectionResult> {
  const { ctx, company, now } = env;
  if (!hasPermission(ctx, "finance.view.payments")) {
    return noAccess(ctx, "Finance", ["finance.view.payments"], "Payments are visible to Finance and Management only.");
  }
  const { invoices, notes } = await companyInvoices(ctx.organizationId, company.id);
  let invoiced = 0;
  let received = 0;
  let overdue = 0;
  const items = invoices.map((i) => {
    const s = standingOf({ status: i.status, amountCents: toCents(i.amount), paidCents: i.payments.reduce((sum, p) => sum + toCents(p.amount), 0), dueOn: i.dueOn }, now);
    if (i.status !== "VOID" && i.status !== "DRAFT") {
      invoiced += toCents(i.amount);
      received += s.paidCents;
      if (s.overdue) overdue += 1;
    }
    return { id: i.id, number: i.number, dealId: i.dealId, status: s.status, amount: fromCents(toCents(i.amount)), currency: i.currency, paid: fromCents(s.paidCents), balance: fromCents(s.balanceCents), dueOn: i.dueOn, daysOverdue: s.daysOverdue };
  });
  return ok("organisation", {
    totals: { invoiced: fromCents(invoiced), received: fromCents(received), outstanding: fromCents(Math.max(0, invoiced - received)), overdueInvoices: overdue },
    items,
    followUpNotes: notes.map((n) => ({ dealId: n.dealId, note: n.note, ownerMembershipId: n.ownerMembershipId, nextOn: n.nextOn })),
  });
}

function ticketsSection(): SectionResult {
  return { status: "not_available", reason: "Tickets and the satisfaction survey arrive with the Customer Support role (V1.1)." };
}

async function nextFollowUpSection(env: Environment): Promise<SectionResult> {
  const { ctx, company, now } = env;
  const taskVisible = taskVisibility(ctx);
  const canNotes = hasPermission(ctx, "finance.view.payments");
  if (taskVisible === null && !canNotes) {
    return noAccess(ctx, "Tasks", ["tasks.view.all", "tasks.view.own", "finance.view.payments"], "Your role keeps no follow-ups on customers.");
  }
  const candidates: { at: Date | null; source: "TASK" | "PAYMENT_NOTE"; id: string; title: string }[] = [];
  if (taskVisible !== null) {
    const { rows } = await companyOpenTasks(ctx.organizationId, company.id, taskVisible, 5);
    for (const t of rows) candidates.push({ at: t.dueAt, source: "TASK", id: t.id, title: t.title });
  }
  if (canNotes) {
    const { notes } = await companyInvoices(ctx.organizationId, company.id);
    for (const n of notes) if (n.nextOn) candidates.push({ at: n.nextOn, source: "PAYMENT_NOTE", id: n.dealId, title: n.note });
  }
  const dated = candidates.filter((c) => c.at).sort((a, b) => a.at!.getTime() - b.at!.getTime());
  const next = dated[0] ?? candidates[0] ?? null;
  return ok(taskVisible !== null && hasPermission(ctx, "tasks.view.all") ? "organisation" : "own", {
    next: next ? { source: next.source, id: next.id, title: next.title, at: next.at, overdue: next.at ? next.at.getTime() < now.getTime() : false } : null,
  });
}

async function extrasSection<T>(ctx: AuthContext, area: string, requires: string[], load: () => Promise<T>): Promise<SectionResult<T>> {
  try {
    return ok("organisation", await load());
  } catch (err) {
    if (err instanceof ForbiddenError) return noAccess(ctx, area, requires, `Your role cannot open this part of the customer.`) as SectionResult<T>;
    throw err;
  }
}

const LOADERS: Record<SectionKey, (env: Environment) => Promise<SectionResult> | SectionResult> = {
  profile: profileSection,
  services: servicesSection,
  deals: dealsSection,
  tasks: tasksSection,
  timeline: timelineSection,
  handoffs: handoffsSection,
  payments: paymentsSection,
  tickets: () => ticketsSection(),
  nextFollowUp: nextFollowUpSection,
  attachments: (env) => extrasSection(env.ctx, "Attachments", ["attachments.manage"], async () => ({ items: (await listAttachments(env.ctx, "company", env.company.id)).map((a) => ({ id: a.id, name: a.file.name, uploadedByMembershipId: a.uploadedByMembershipId, createdAt: a.createdAt })) })),
  comments: (env) => extrasSection(env.ctx, "Comments", ["companies.view"], () => listComments(env.ctx, "company", env.company.id)),
};

export interface Customer360Options {
  /** Which sections to load; all of them when omitted. */
  sections?: string[];
  /** The timeline's `nextCursor` from an earlier response. */
  cursor?: string;
  limit?: number;
}

export async function getCustomer360(ctx: AuthContext, companyId: string, options: Customer360Options = {}, now = new Date()) {
  requirePermission(ctx, "companies.view");
  const requested = options.sections && options.sections.length > 0 ? options.sections : [...SECTION_KEYS];
  const unknown = requested.filter((s) => !(SECTION_KEYS as readonly string[]).includes(s));
  if (unknown.length > 0) {
    throw new ValidationError(`Unknown section: ${unknown.join(", ")}.`, [{ path: "sections", message: `Use any of ${SECTION_KEYS.join(", ")}.` }]);
  }
  const limit = Math.min(Math.max(Math.floor(options.limit ?? TIMELINE_DEFAULT_LIMIT), 1), TIMELINE_MAX_LIMIT);
  const company = await getCompany(ctx, companyId);
  const env: Environment = { ctx, company, now, timeline: { cursor: decodeTimelineCursor(options.cursor), limit } };
  const keys = [...new Set(requested)] as SectionKey[];
  const results = await Promise.all(keys.map(async (k) => [k, await LOADERS[k](env)] as const));
  return {
    company: { id: company.id, name: company.name, archived: company.archivedAt !== null, readOnly: company.archivedAt !== null },
    sections: Object.fromEntries(results) as Partial<Record<SectionKey, SectionResult>>,
    requested: keys,
  };
}
