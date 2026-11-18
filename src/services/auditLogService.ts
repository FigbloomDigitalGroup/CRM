import { stringifyCsv as stringify } from "../lib/csv";
import type { AuthContext } from "../auth/context";
import { deny, hasPermission, requirePermission } from "../auth/context";
import { ValidationError } from "../auth/errors";
import { PAYMENT_ENTITIES, maskAuditSnapshot } from "../auth/masking";
import { adminDb } from "../db/adminClient";
import { parseDateOnly } from "../lib/inputParsing";
import { buildPage, resolvePaging, type PageRequest } from "../lib/pagination";
import { type AuditLogFilter, auditFacets, listAuditLog } from "../repositories/auditLog";
import { recordAuditEvent } from "../repositories/auditEvents";
import { assertBulkExportAllowed } from "./exportService";

/**
 * The organisation-wide audit log (FIG-799, B4.09, Settings > Audit log).
 *
 * Management (`audit.view`) can ask "what did this person change this week?" across every record:
 * filter by actor, entity type, action and date range, page through, follow each row to the record it
 * touched, and export what the filters show. Rows for records that were deleted or archived still render:
 * the row carries what it knew at the time, and says the record is gone or archived.
 *
 * Masking applies here like everywhere: payment records (`PAYMENT_ENTITIES`) are left out entirely for anyone
 * without `finance.view.payments`, and money fields in deal and service snapshots are blanked for anyone
 * without `deals.view.value`. Reading the log is itself not audited; exporting it is.
 */
export const MAX_AUDIT_EXPORT_ROWS = 20_000;
const PERMISSION = "audit.view";

export interface AuditLogQuery {
  actorMembershipId?: string;
  entityType?: string;
  entityId?: string;
  /** An exact action such as "lead.owner_reassigned", or a prefix ending in "*" such as "membership.*". */
  action?: string;
  /** YYYY-MM-DD, inclusive. */
  dateFrom?: string;
  /** YYYY-MM-DD, inclusive. */
  dateTo?: string;
}

function hiddenEntityTypes(ctx: AuthContext): string[] {
  return hasPermission(ctx, "finance.view.payments") ? [] : [...PAYMENT_ENTITIES];
}

function toFilter(ctx: AuthContext, query: AuditLogQuery): AuditLogFilter {
  const filter: AuditLogFilter = {
    actorMembershipId: query.actorMembershipId || undefined,
    entityType: query.entityType || undefined,
    entityId: query.entityId || undefined,
    excludeEntityTypes: hiddenEntityTypes(ctx),
  };
  if (filter.entityType && filter.excludeEntityTypes?.includes(filter.entityType)) {
    // Asking for a type you may not see is a refusal, not an empty page that hints it exists.
    throw deny(ctx, "finance.view.payments", ["finance.view.payments"]);
  }
  if (query.action) {
    const prefix = query.action.endsWith("*");
    filter.action = prefix ? query.action.slice(0, -1) : query.action;
    filter.actionPrefix = prefix || undefined;
  }
  if (query.dateFrom) filter.from = parseDateOnly(query.dateFrom, "dateFrom");
  if (query.dateTo) {
    const end = parseDateOnly(query.dateTo, "dateTo");
    filter.to = new Date(end.getTime() + 24 * 60 * 60 * 1000);
  }
  if (filter.from && filter.to && filter.from >= filter.to) {
    throw new ValidationError("dateFrom must not be after dateTo.", [{ path: "dateFrom", message: "Start the range on or before its last day." }]);
  }
  return filter;
}

/** Where a record opens in the app. Types without a screen of their own have no link. */
const LINK_SEGMENT: Record<string, string> = {
  Lead: "leads",
  Contact: "contacts",
  Company: "companies",
  Deal: "deals",
  Task: "tasks",
  RecurringService: "renewals",
  Invoice: "payments",
};

interface EntityInfo {
  label: string | null;
  exists: boolean;
  archived: boolean;
}

/** Names and states for the records on one page of the log, in one query per type. */
async function describeEntities(organizationId: string, rows: { entityType: string; entityId: string | null }[]) {
  const idsByType = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.entityId) continue;
    (idsByType.get(r.entityType) ?? idsByType.set(r.entityType, new Set()).get(r.entityType)!).add(r.entityId);
  }
  const info = new Map<string, EntityInfo>();
  const key = (type: string, id: string) => `${type}:${id}`;
  const put = (type: string, id: string, label: string | null, archived = false) => info.set(key(type, id), { label, exists: true, archived });
  const ids = (type: string) => [...(idsByType.get(type) ?? [])];
  const where = (type: string) => ({ organizationId, id: { in: ids(type) } });

  const queries: Promise<void>[] = [];
  if (idsByType.has("Lead")) {
    queries.push(
      adminDb.lead
        .findMany({ where: where("Lead"), select: { id: true, archivedAt: true, contact: { select: { firstName: true, lastName: true } }, company: { select: { name: true } } } })
        .then((list) => list.forEach((l) => put("Lead", l.id, l.contact ? [l.contact.firstName, l.contact.lastName].filter(Boolean).join(" ") : (l.company?.name ?? null), l.archivedAt !== null))),
    );
  }
  if (idsByType.has("Contact")) {
    queries.push(
      adminDb.contact
        .findMany({ where: where("Contact"), select: { id: true, firstName: true, lastName: true, archivedAt: true } })
        .then((list) => list.forEach((c) => put("Contact", c.id, [c.firstName, c.lastName].filter(Boolean).join(" "), c.archivedAt !== null))),
    );
  }
  if (idsByType.has("Company")) {
    queries.push(
      adminDb.company
        .findMany({ where: where("Company"), select: { id: true, name: true, archivedAt: true } })
        .then((list) => list.forEach((c) => put("Company", c.id, c.name, c.archivedAt !== null))),
    );
  }
  if (idsByType.has("Deal")) {
    queries.push(
      adminDb.deal
        .findMany({ where: where("Deal"), select: { id: true, archivedAt: true, company: { select: { name: true } } } })
        .then((list) => list.forEach((d) => put("Deal", d.id, d.company.name, d.archivedAt !== null))),
    );
  }
  if (idsByType.has("Task")) {
    queries.push(
      adminDb.task
        .findMany({ where: where("Task"), select: { id: true, title: true, archivedAt: true } })
        .then((list) => list.forEach((t) => put("Task", t.id, t.title, t.archivedAt !== null))),
    );
  }
  if (idsByType.has("Membership")) {
    queries.push(
      adminDb.membership
        .findMany({ where: where("Membership"), select: { id: true, user: { select: { name: true } } } })
        .then((list) => list.forEach((m) => put("Membership", m.id, m.user.name))),
    );
  }
  if (idsByType.has("Invoice")) {
    queries.push(
      adminDb.invoice
        .findMany({ where: where("Invoice"), select: { id: true, number: true, voidedAt: true } })
        .then((list) => list.forEach((i) => put("Invoice", i.id, i.number, i.voidedAt !== null))),
    );
  }
  if (idsByType.has("RecurringService")) {
    queries.push(
      adminDb.recurringService
        .findMany({ where: where("RecurringService"), select: { id: true, company: { select: { name: true } }, service: { select: { name: true } } } })
        .then((list) => list.forEach((s) => put("RecurringService", s.id, `${s.service.name} (${s.company.name})`))),
    );
  }
  await Promise.all(queries);
  return { info, key };
}

async function actorNames(organizationId: string, rows: { actorMembershipId: string | null; actorUserId: string | null }[]) {
  const membershipIds = [...new Set(rows.map((r) => r.actorMembershipId).filter((x): x is string => !!x))];
  const userIds = [...new Set(rows.filter((r) => !r.actorMembershipId && r.actorUserId).map((r) => r.actorUserId!))];
  const [memberships, users] = await Promise.all([
    membershipIds.length > 0
      ? adminDb.membership.findMany({ where: { organizationId, id: { in: membershipIds } }, select: { id: true, role: { select: { key: true } }, user: { select: { name: true, email: true } } } })
      : Promise.resolve([]),
    userIds.length > 0 ? adminDb.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : Promise.resolve([]),
  ]);
  return {
    byMembership: new Map(memberships.map((m) => [m.id, { name: m.user.name, email: m.user.email, roleKey: m.role.key }])),
    byUser: new Map(users.map((u) => [u.id, { name: u.name, email: u.email }])),
  };
}

async function shape(ctx: AuthContext, rows: Awaited<ReturnType<typeof listAuditLog>>["rows"], orgSlug: string | null) {
  const [entities, actors] = await Promise.all([describeEntities(ctx.organizationId, rows), actorNames(ctx.organizationId, rows)]);
  return rows.map((r) => {
    const found = r.entityId ? entities.info.get(entities.key(r.entityType, r.entityId)) : undefined;
    const segment = LINK_SEGMENT[r.entityType];
    const snapshotLabel = labelFromSnapshot(r.newValue) ?? labelFromSnapshot(r.previousValue) ?? labelFromSnapshot(r.metadata);
    const membership = r.actorMembershipId ? actors.byMembership.get(r.actorMembershipId) : undefined;
    const user = !membership && r.actorUserId ? actors.byUser.get(r.actorUserId) : undefined;
    return {
      id: r.id,
      at: r.createdAt,
      action: r.action,
      actor: membership
        ? { membershipId: r.actorMembershipId, name: membership.name, email: membership.email, roleKey: membership.roleKey }
        : user
          ? { membershipId: null, name: user.name, email: user.email, roleKey: null }
          : { membershipId: null, name: "System", email: null, roleKey: null },
      entity: {
        type: r.entityType,
        id: r.entityId,
        // A record that is gone still renders: its name falls back to what the event itself recorded.
        label: found?.label ?? snapshotLabel,
        exists: r.entityId ? (found?.exists ?? false) : false,
        archived: found?.archived ?? false,
        // Only records that exist and have a screen link anywhere.
        link: found?.exists && segment && r.entityId && orgSlug ? { path: `/o/${orgSlug}/${segment}/${r.entityId}`, api: `/api/orgs/${orgSlug}/${segment === "renewals" ? "recurring-services" : segment === "payments" ? "invoices" : segment}/${r.entityId}` } : null,
      },
      previousValue: maskAuditSnapshot(ctx, r.entityType, r.previousValue),
      newValue: maskAuditSnapshot(ctx, r.entityType, r.newValue),
      metadata: maskAuditSnapshot(ctx, r.entityType, r.metadata),
    };
  });
}

function labelFromSnapshot(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const s = snapshot as Record<string, unknown>;
  for (const key of ["name", "title", "label", "number"]) {
    if (typeof s[key] === "string" && s[key]) return s[key] as string;
  }
  return null;
}

async function orgSlugOf(organizationId: string): Promise<string | null> {
  const org = await adminDb.organization.findUnique({ where: { id: organizationId }, select: { slug: true } });
  return org?.slug ?? null;
}

export async function listOrganizationAuditLog(ctx: AuthContext, query: AuditLogQuery = {}, request: PageRequest = {}) {
  requirePermission(ctx, PERMISSION);
  const filter = toFilter(ctx, query);
  const paging = resolvePaging(request);
  const { rows, total } = await listAuditLog(ctx.organizationId, filter, { skip: paging.skip, take: paging.take });
  const items = await shape(ctx, rows, await orgSlugOf(ctx.organizationId));
  return buildPage(items, total, paging);
}

/** What the filter controls offer: entity types, actions and the people who have acted. */
export async function getAuditLogFilters(ctx: AuthContext) {
  requirePermission(ctx, PERMISSION);
  const facets = await auditFacets(ctx.organizationId, hiddenEntityTypes(ctx));
  const ids = facets.actorMembershipIds.map((a) => a.membershipId).filter((x): x is string => !!x);
  const people = ids.length > 0
    ? await adminDb.membership.findMany({ where: { organizationId: ctx.organizationId, id: { in: ids } }, select: { id: true, user: { select: { name: true } }, role: { select: { key: true } } } })
    : [];
  const countOf = new Map(facets.actorMembershipIds.map((a) => [a.membershipId, a.count]));
  return {
    entityTypes: facets.entityTypes,
    actions: facets.actions,
    actors: people.map((p) => ({ membershipId: p.id, name: p.user.name, roleKey: p.role.key, events: countOf.get(p.id) ?? 0 })),
    systemEvents: countOf.get(null) ?? 0,
  };
}

const CSV_COLUMNS = ["when", "actor", "actorRole", "action", "entityType", "entityId", "entity", "recordExists", "recordArchived", "previousValue", "newValue", "metadata"] as const;

/** The log as the filters show it, as CSV. Exporting the log is itself audited. */
export async function exportOrganizationAuditLogCsv(ctx: AuthContext, query: AuditLogQuery = {}): Promise<string> {
  requirePermission(ctx, PERMISSION);
  const filter = toFilter(ctx, query);
  const slug = await orgSlugOf(ctx.organizationId);
  const out: Record<string, unknown>[] = [];
  const pageSize = 500;
  let skip = 0;
  let total = 0;
  for (;;) {
    const { rows, total: count } = await listAuditLog(ctx.organizationId, filter, { skip, take: pageSize });
    total = count;
    if (total > MAX_AUDIT_EXPORT_ROWS) {
      throw new ValidationError(`That is ${total} events, more than one export holds (${MAX_AUDIT_EXPORT_ROWS}). Narrow the dates or filters.`, [
        { path: "dateFrom", message: "Narrow the date range or add a filter." },
      ]);
    }
    if (skip === 0) await assertBulkExportAllowed(ctx, total);
    const shaped = await shape(ctx, rows, slug);
    for (const r of shaped) {
      out.push({
        when: r.at.toISOString(),
        actor: r.actor.name,
        actorRole: r.actor.roleKey ?? "",
        action: r.action,
        entityType: r.entity.type,
        entityId: r.entity.id ?? "",
        entity: r.entity.label ?? "",
        recordExists: r.entity.id ? String(r.entity.exists) : "",
        recordArchived: String(r.entity.archived),
        previousValue: r.previousValue ? JSON.stringify(r.previousValue) : "",
        newValue: r.newValue ? JSON.stringify(r.newValue) : "",
        metadata: r.metadata ? JSON.stringify(r.metadata) : "",
      });
    }
    skip += pageSize;
    if (rows.length < pageSize || skip >= total) break;
  }
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "audit_log.exported",
    entityType: "AuditLog",
    metadata: { rows: out.length, filters: JSON.parse(JSON.stringify(query)) },
  });
  return stringify(out, { header: true, columns: [...CSV_COLUMNS] });
}
