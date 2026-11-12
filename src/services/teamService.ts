import { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { deny, hasPermission } from "../auth/context";
import { canSeeAggregateValue } from "../auth/masking";
import { canViewTeamPage, TEAM_PAGE_KEYS } from "../auth/teamAccess";
import { withOrgContext, type OrgScopedClient } from "../db/orgScopedClient";
import type { TeamAttention, TeamMemberDetail, TeamMemberRow, TeamMembersResponse, TeamRange, TeamSummary } from "../api/dto/team";
import { TEAM_MEMBER_SORTS } from "../api/dto/team";
import { NotFoundError } from "../auth/errors";
import { buildPage, resolvePaging, type PageRequest } from "../lib/pagination";
import { loadStageRules } from "./dealRuleService";
import { taskGroupBounds } from "./taskService";
import { withAvatars } from "./profileService";

/**
 * The Team page (P2-15, FIG-1598): who is on the sales team, what each person is doing and who needs help.
 *
 * Every figure is one SQL aggregate (COUNT / SUM with GROUP BY, joined per member); no list of records is loaded to be counted, which is
 * what the dashboard once did (FIG-789). Everything runs inside `withOrgContext`, so row-level security backs the explicit
 * `organization_id` filters.
 *
 * Rules that hold here:
 * - Permission: `canViewTeamPage` (Management today). Anyone else gets the explained 403, never an empty page.
 * - Masking (rule 7): a count the caller's role may not see is `null`; deal values need `deals.view.value` and are `{ masked: true }`
 *   otherwise. Payments are never read here.
 * - Activity comes from the audit trail the app already writes (entity types below only: sales objects, so no payments, settings or
 *   sign-in events), and carries no snapshots, so it cannot carry a value. There is no tracking beyond CRM actions.
 * - "Stale" uses the organisation's stalled-deal threshold (Settings > Deal rules): the app has no separate lead-inactivity setting.
 */

/** Audit entity types that count as sales work. */
export const TEAM_ACTIVITY_ENTITY_TYPES = ["Lead", "Deal", "Task", "Activity", "Contact", "Company"] as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const LIST_LIMIT = 10;

export function assertTeamAccess(ctx: AuthContext): void {
  if (!canViewTeamPage(ctx.permissionKeys)) throw deny(ctx, TEAM_PAGE_KEYS[0]!, [...TEAM_PAGE_KEYS]);
}

function accessOf(ctx: AuthContext) {
  return {
    leads: hasPermission(ctx, "leads.view.all"),
    deals: hasPermission(ctx, "deals.view.all"),
    tasks: hasPermission(ctx, "tasks.view.all"),
    values: canSeeAggregateValue(ctx) && !ctx.hiddenFields?.includes("deal.value"),
  };
}
type Access = ReturnType<typeof accessOf>;

interface Window {
  range: TeamRange;
  now: Date;
  from: Date;
  todayStart: Date;
  tomorrowStart: Date;
  staleCutoff: Date;
  staleDays: number;
  defaultStallDays: number;
}

async function windowFor(ctx: AuthContext, range: TeamRange = "7d", now = new Date()): Promise<Window> {
  const [bounds, rules] = await Promise.all([taskGroupBounds(ctx, now), loadStageRules(ctx.organizationId)]);
  const from = range === "today" ? bounds.todayStart : new Date(now.getTime() - (range === "7d" ? 7 : 30) * DAY_MS);
  return {
    range,
    now,
    from,
    todayStart: bounds.todayStart,
    tomorrowStart: bounds.tomorrowStart,
    staleDays: rules.defaultDays,
    staleCutoff: new Date(now.getTime() - rules.defaultDays * DAY_MS),
    defaultStallDays: rules.defaultDays,
  };
}

const types = Prisma.join([...TEAM_ACTIVITY_ENTITY_TYPES]);
const OPEN_LEAD = Prisma.sql`l.archived_at IS NULL AND l.converted_at IS NULL AND l.lost_reason_id IS NULL`;

const HIDDEN = { amount: null, masked: true } as const;
/** A deal with no value has `amount: null` and `masked: false`; an aggregate passes `?? 0` itself. */
const money = (access: Access, amount: unknown) => (access.values ? { amount: amount === null || amount === undefined ? null : String(amount), masked: false } : HIDDEN);
const gate = <T,>(allowed: boolean, value: T): T | null => (allowed ? value : null);

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export interface TeamMembersQuery {
  range?: TeamRange;
  q?: string;
  role?: string;
  status?: string;
  sort?: string;
}

const SORT_SQL: Record<(typeof TEAM_MEMBER_SORTS)[number], string> = {
  name: "lower(b.name)",
  role: "lower(b.role_name)",
  status: "b.status",
  lastActive: "la.created_at",
  openLeads: "open_leads",
  openDeals: "open_deals",
  overdueTasks: "overdue_tasks",
  tasksToday: "tasks_due_today",
  newLeads: "new_leads",
};

interface MemberSqlRow {
  id: string;
  status: "ACTIVE" | "INACTIVE" | "PENDING";
  name: string;
  email: string;
  role_key: string;
  role_name: string;
  last_active_at: Date | null;
  open_leads: number;
  new_leads: number;
  open_deals: number;
  open_value: Prisma.Decimal | null;
  stuck_deals: number;
  overdue_tasks: number;
  tasks_due_today: number;
  total: bigint;
}

function parseSort(sort: string | undefined): { field: (typeof TEAM_MEMBER_SORTS)[number]; desc: boolean } {
  const desc = !!sort?.startsWith("-");
  const field = (sort ?? "").replace(/^-/, "") as (typeof TEAM_MEMBER_SORTS)[number];
  return TEAM_MEMBER_SORTS.includes(field) ? { field, desc } : { field: "name", desc: false };
}

async function queryMembers(
  tx: OrgScopedClient,
  ctx: AuthContext,
  w: Window,
  opts: { membershipId?: string; q?: string; role?: string; status?: string; sort?: string; skip?: number; take?: number },
): Promise<MemberSqlRow[]> {
  const org = ctx.organizationId;
  const { field, desc } = parseSort(opts.sort);
  const q = opts.q?.trim();
  const like = q ? `%${q.replace(/[\\%_]/g, "\\$&")}%` : null;
  const filters = Prisma.sql`
    ${opts.membershipId ? Prisma.sql`AND m.id = ${opts.membershipId}` : Prisma.empty}
    ${opts.role ? Prisma.sql`AND r.key = ${opts.role}` : Prisma.empty}
    ${opts.status ? Prisma.sql`AND m.status = ${opts.status}::"MembershipStatus"` : Prisma.empty}
    ${like ? Prisma.sql`AND (u.name ILIKE ${like} OR u.email ILIKE ${like})` : Prisma.empty}`;
  // The sort column and direction come from the fixed table above, never from the request text.
  const order = Prisma.raw(`${SORT_SQL[field]} ${desc ? "DESC" : "ASC"} NULLS LAST`);
  return tx.$queryRaw<MemberSqlRow[]>(Prisma.sql`
    WITH base AS (
      SELECT m.id, m.status::text AS status, u.name, u.email, r.key AS role_key, r.name AS role_name
      FROM memberships m
      JOIN users u ON u.id = m.user_id
      JOIN roles r ON r.id = m.role_id
      WHERE m.organization_id = ${org} AND m.status IN ('ACTIVE', 'INACTIVE', 'PENDING') ${filters}
    ),
    lo AS (
      SELECT l.owner_membership_id AS mid, COUNT(*) AS open_leads
      FROM leads l
      WHERE l.organization_id = ${org} AND ${OPEN_LEAD} AND l.owner_membership_id IS NOT NULL
      GROUP BY 1
    ),
    ln AS (
      SELECT l.owner_membership_id AS mid, COUNT(*) AS new_leads
      FROM leads l
      WHERE l.organization_id = ${org} AND l.archived_at IS NULL AND l.created_at >= ${w.from} AND l.owner_membership_id IS NOT NULL
      GROUP BY 1
    ),
    dc AS (
      SELECT d.owner_membership_id AS mid,
             COUNT(*) AS open_deals,
             SUM(d.value) AS open_value,
             COUNT(*) FILTER (WHERE d.last_activity_at < ${w.now}::timestamp - COALESCE(ps.stalled_after_days, ${w.defaultStallDays}::int) * interval '1 day') AS stuck_deals
      FROM deals d JOIN pipeline_stages ps ON ps.id = d.pipeline_stage_id
      WHERE d.organization_id = ${org} AND d.archived_at IS NULL AND d.outcome = 'OPEN'
      GROUP BY 1
    ),
    tc AS (
      SELECT t.assignee_membership_id AS mid,
             COUNT(*) FILTER (WHERE t.due_at < ${w.now}) AS overdue_tasks,
             COUNT(*) FILTER (WHERE t.due_at >= ${w.todayStart} AND t.due_at < ${w.tomorrowStart}) AS tasks_due_today
      FROM tasks t
      WHERE t.organization_id = ${org} AND t.archived_at IS NULL AND t.status IN ('PENDING', 'IN_PROGRESS')
      GROUP BY 1
    )
    SELECT b.id, b.status, b.name, b.email, b.role_key, b.role_name,
           la.created_at AS last_active_at,
           COALESCE(lo.open_leads, 0)::int AS open_leads,
           COALESCE(ln.new_leads, 0)::int AS new_leads,
           COALESCE(dc.open_deals, 0)::int AS open_deals,
           dc.open_value AS open_value,
           COALESCE(dc.stuck_deals, 0)::int AS stuck_deals,
           COALESCE(tc.overdue_tasks, 0)::int AS overdue_tasks,
           COALESCE(tc.tasks_due_today, 0)::int AS tasks_due_today,
           COUNT(*) OVER () AS total
    FROM base b
    LEFT JOIN lo ON lo.mid = b.id
    LEFT JOIN ln ON ln.mid = b.id
    LEFT JOIN dc ON dc.mid = b.id
    LEFT JOIN tc ON tc.mid = b.id
    LEFT JOIN LATERAL (
      SELECT e.created_at FROM audit_events e
      WHERE e.organization_id = ${org} AND e.actor_membership_id = b.id AND e.entity_type IN (${types})
      ORDER BY e.created_at DESC LIMIT 1
    ) la ON true
    ORDER BY ${order}, b.id
    ${opts.take !== undefined ? Prisma.sql`LIMIT ${opts.take} OFFSET ${opts.skip ?? 0}` : Prisma.empty}
  `);
}

async function toRows(ctx: AuthContext, access: Access, rows: MemberSqlRow[]): Promise<TeamMemberRow[]> {
  const withPics = await withAvatars(ctx.organizationId, rows.map((r) => ({ membershipId: r.id, name: r.name })), (r) => r.name);
  const pics = new Map(withPics.map((p) => [p.membershipId, p]));
  return rows.map((r) => ({
    membershipId: r.id,
    name: r.name,
    email: r.email,
    initials: pics.get(r.id)?.initials ?? "",
    avatarUrl: pics.get(r.id)?.avatarUrl ?? null,
    role: { key: r.role_key, name: r.role_name },
    status: r.status,
    lastActiveAt: r.last_active_at ? r.last_active_at.toISOString() : null,
    openLeads: gate(access.leads, r.open_leads),
    openDeals: gate(access.deals, r.open_deals),
    openDealsValue: access.deals ? money(access, r.open_value ?? 0) : HIDDEN,
    tasksDueToday: gate(access.tasks, r.tasks_due_today),
    overdueTasks: gate(access.tasks, r.overdue_tasks),
    newLeads: gate(access.leads, r.new_leads),
    stuckDeals: gate(access.deals, r.stuck_deals),
  }));
}

export async function listTeamMembers(ctx: AuthContext, query: TeamMembersQuery, page: PageRequest = {}): Promise<TeamMembersResponse> {
  assertTeamAccess(ctx);
  const w = await windowFor(ctx, query.range);
  const access = accessOf(ctx);
  const paging = resolvePaging(page);
  const { rows, roles } = await withOrgContext(ctx.organizationId, async (tx) => ({
    rows: await queryMembers(tx, ctx, w, { ...query, skip: paging.skip, take: paging.take }),
    roles: await tx.$queryRaw<{ key: string; name: string }[]>(Prisma.sql`
      SELECT DISTINCT r.key, r.name FROM memberships m JOIN roles r ON r.id = m.role_id
      WHERE m.organization_id = ${ctx.organizationId} AND m.status IN ('ACTIVE', 'INACTIVE', 'PENDING') ORDER BY r.name`),
  }));
  const total = rows.length ? Number(rows[0]!.total) : 0;
  const p = buildPage(await toRows(ctx, access, rows), total, paging);
  return { range: w.range, access, ...p, roles };
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export async function getTeamSummary(ctx: AuthContext, query: { range?: TeamRange }): Promise<TeamSummary> {
  assertTeamAccess(ctx);
  const w = await windowFor(ctx, query.range);
  const access = accessOf(ctx);
  const org = ctx.organizationId;
  const [leads, deals, tasks, members, workload] = await withOrgContext(org, (tx) =>
    Promise.all([
      tx.$queryRaw<{ open_leads: number; new_leads: number; unassigned: number }[]>(Prisma.sql`
        SELECT (SELECT COUNT(*)::int FROM leads l WHERE l.organization_id = ${org} AND ${OPEN_LEAD} AND l.owner_membership_id IS NOT NULL) AS open_leads,
               (SELECT COUNT(*)::int FROM leads l WHERE l.organization_id = ${org} AND l.archived_at IS NULL AND l.created_at >= ${w.from}) AS new_leads,
               (SELECT COUNT(*)::int FROM leads l WHERE l.organization_id = ${org} AND ${OPEN_LEAD} AND l.owner_membership_id IS NULL) AS unassigned`),
      tx.$queryRaw<{ open_deals: number; open_value: Prisma.Decimal | null; won: number; won_value: Prisma.Decimal | null }[]>(Prisma.sql`
        SELECT COUNT(*) FILTER (WHERE d.outcome = 'OPEN')::int AS open_deals,
               SUM(d.value) FILTER (WHERE d.outcome = 'OPEN') AS open_value,
               COUNT(*) FILTER (WHERE d.outcome = 'WON' AND d.won_at >= ${w.from})::int AS won,
               SUM(d.value) FILTER (WHERE d.outcome = 'WON' AND d.won_at >= ${w.from}) AS won_value
        FROM deals d WHERE d.organization_id = ${org} AND d.archived_at IS NULL AND (d.outcome = 'OPEN' OR (d.outcome = 'WON' AND d.won_at >= ${w.from}))`),
      tx.$queryRaw<{ overdue: number }[]>(Prisma.sql`
        SELECT COUNT(*) FILTER (WHERE t.due_at < ${w.now})::int AS overdue
        FROM tasks t WHERE t.organization_id = ${org} AND t.archived_at IS NULL AND t.status IN ('PENDING', 'IN_PROGRESS')`),
      tx.$queryRaw<{ total: number; active: number }[]>(Prisma.sql`
        SELECT COUNT(*) FILTER (WHERE m.status = 'ACTIVE')::int AS total,
               (SELECT COUNT(DISTINCT e.actor_membership_id)::int FROM audit_events e
                WHERE e.organization_id = ${org} AND e.created_at >= ${w.from} AND e.entity_type IN (${types}) AND e.actor_membership_id IS NOT NULL) AS active
        FROM memberships m WHERE m.organization_id = ${org}`),
      tx.$queryRaw<{ id: string; name: string; open_leads: number }[]>(Prisma.sql`
        SELECT m.id, u.name, COUNT(l.id)::int AS open_leads
        FROM memberships m JOIN users u ON u.id = m.user_id
        LEFT JOIN leads l ON l.owner_membership_id = m.id AND l.organization_id = m.organization_id
             AND l.archived_at IS NULL AND l.converted_at IS NULL AND l.lost_reason_id IS NULL
        WHERE m.organization_id = ${org} AND m.status = 'ACTIVE'
        GROUP BY m.id, u.name ORDER BY open_leads DESC, u.name LIMIT 100`),
    ]),
  );
  const l = leads[0]!;
  const d = deals[0]!;
  return {
    range: w.range,
    rangeStart: w.from.toISOString(),
    generatedAt: w.now.toISOString(),
    staleDays: w.staleDays,
    access,
    summary: {
      membersActive: members[0]!.active,
      membersTotal: members[0]!.total,
      openLeads: gate(access.leads, l.open_leads),
      openDeals: gate(access.deals, d.open_deals),
      openDealsValue: access.deals ? money(access, d.open_value ?? 0) : HIDDEN,
      overdueTasks: gate(access.tasks, tasks[0]!.overdue),
      newLeads: gate(access.leads, l.new_leads),
      dealsWon: { count: gate(access.deals, d.won), value: access.deals ? money(access, d.won_value ?? 0) : HIDDEN },
      unassignedLeads: gate(access.leads, l.unassigned),
    },
    workload: access.leads ? workload.map((r) => ({ membershipId: r.id, name: r.name, openLeads: r.open_leads })) : [],
  };
}

// ---------------------------------------------------------------------------
// Needs attention
// ---------------------------------------------------------------------------

export async function getTeamAttention(ctx: AuthContext): Promise<TeamAttention> {
  assertTeamAccess(ctx);
  const w = await windowFor(ctx);
  const access = accessOf(ctx);
  const org = ctx.organizationId;
  const nameOf = (id: string | null, names: Map<string, string>) => (id ? (names.get(id) ?? null) : null);
  return withOrgContext(org, async (tx) => {
    const names = new Map(
      (await tx.$queryRaw<{ id: string; name: string }[]>(Prisma.sql`SELECT m.id, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.organization_id = ${org}`)).map((r) => [r.id, r.name]),
    );
    const staleWhere = Prisma.sql`l.organization_id = ${org} AND ${OPEN_LEAD} AND l.created_at < ${w.staleCutoff}
      AND (l.last_contacted_at IS NULL OR l.last_contacted_at < ${w.staleCutoff})
      AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.organization_id = l.organization_id AND a.lead_id = l.id AND a.occurred_at >= ${w.staleCutoff})`;
    const stale = access.leads
      ? await tx.$queryRaw<{ id: string; company: string | null; first_name: string | null; last_name: string | null; last_touch: Date | null; owner: string | null; total: number }[]>(Prisma.sql`
          SELECT l.id, co.name AS company, ct.first_name, ct.last_name, COALESCE(l.last_contacted_at, l.created_at) AS last_touch, l.owner_membership_id AS owner,
                 COUNT(*) OVER ()::int AS total
          FROM leads l LEFT JOIN companies co ON co.id = l.company_id LEFT JOIN contacts ct ON ct.id = l.contact_id
          WHERE ${staleWhere} ORDER BY last_touch ASC, l.id LIMIT ${LIST_LIMIT}`)
      : null;
    const overdue = access.tasks
      ? await tx.$queryRaw<{ id: string; title: string; due_at: Date; owner: string; total: number }[]>(Prisma.sql`
          SELECT t.id, t.title, t.due_at, t.assignee_membership_id AS owner, COUNT(*) OVER ()::int AS total FROM tasks t
          WHERE t.organization_id = ${org} AND t.archived_at IS NULL AND t.status IN ('PENDING','IN_PROGRESS') AND t.due_at < ${w.now}
          ORDER BY t.due_at ASC, t.id LIMIT ${LIST_LIMIT}`)
      : null;
    const stuckWhere = Prisma.sql`d.organization_id = ${org} AND d.archived_at IS NULL AND d.outcome = 'OPEN'
      AND d.last_activity_at < ${w.now}::timestamp - COALESCE(ps.stalled_after_days, ${w.defaultStallDays}::int) * interval '1 day'`;
    const stuck = access.deals
      ? await tx.$queryRaw<{ id: string; company: string | null; stage: string; value: Prisma.Decimal | null; last: Date; owner: string; total: number }[]>(Prisma.sql`
          SELECT d.id, co.name AS company, ps.name AS stage, d.value, d.last_activity_at AS last, d.owner_membership_id AS owner, COUNT(*) OVER ()::int AS total
          FROM deals d JOIN pipeline_stages ps ON ps.id = d.pipeline_stage_id LEFT JOIN companies co ON co.id = d.company_id
          WHERE ${stuckWhere} ORDER BY d.last_activity_at ASC, d.id LIMIT ${LIST_LIMIT}`)
      : null;
    return {
      staleDays: w.staleDays,
      access,
      staleLeads: stale
        ? {
            total: stale[0]?.total ?? 0,
            items: stale.map((r) => ({
              id: r.id,
              company: r.company,
              contact: [r.first_name, r.last_name].filter(Boolean).join(" ") || null,
              lastTouchAt: r.last_touch ? r.last_touch.toISOString() : null,
              ownerMembershipId: r.owner,
              ownerName: nameOf(r.owner, names),
            })),
          }
        : null,
      overdueTasks: overdue
        ? { total: overdue[0]?.total ?? 0, items: overdue.map((r) => ({ id: r.id, title: r.title, dueAt: r.due_at.toISOString(), ownerMembershipId: r.owner, ownerName: nameOf(r.owner, names) })) }
        : null,
      stuckDeals: stuck
        ? {
            total: stuck[0]?.total ?? 0,
            items: stuck.map((r) => ({
              id: r.id,
              company: r.company,
              stage: r.stage,
              daysQuiet: Math.floor((w.now.getTime() - r.last.getTime()) / DAY_MS),
              value: money(access, r.value),
              ownerMembershipId: r.owner,
              ownerName: nameOf(r.owner, names),
            })),
          }
        : null,
    };
  });
}

// ---------------------------------------------------------------------------
// One member
// ---------------------------------------------------------------------------

const ACTION_LABELS: Record<string, string> = {
  "lead.owner_reassigned": "Reassigned a lead",
  "lead.updated": "Updated a lead",
  "lead.qualification_updated": "Updated a lead's qualification",
  "lead.archived": "Archived a lead",
  "lead.restored": "Restored a lead",
  "deal.moved": "Moved a deal",
  "deal.move_undone": "Undid a deal move",
  "deal.outcome_changed": "Changed a deal's outcome",
  "deal.updated": "Updated a deal",
  "deal.owner_reassigned": "Reassigned a deal",
  "deal.archived": "Archived a deal",
  "deal.restored": "Restored a deal",
  "task.archived": "Archived a task",
  "task.restored": "Restored a task",
};

function labelFor(action: string, entityType: string): string {
  const known = ACTION_LABELS[action];
  if (known) return known;
  const verb = action.split(".").pop()?.replace(/_/g, " ") ?? "changed";
  return `${verb.charAt(0).toUpperCase()}${verb.slice(1)} (${entityType.toLowerCase()})`;
}

function pathFor(entityType: string, id: string | null): string | null {
  if (!id) return null;
  if (entityType === "Lead") return `/leads/${id}`;
  if (entityType === "Deal") return `/deals/${id}`;
  if (entityType === "Task") return "/tasks";
  return null;
}

export async function getTeamMember(ctx: AuthContext, membershipId: string, query: { range?: TeamRange }): Promise<TeamMemberDetail> {
  assertTeamAccess(ctx);
  const w = await windowFor(ctx, query.range);
  const access = accessOf(ctx);
  const org = ctx.organizationId;
  const data = await withOrgContext(org, async (tx) => {
    const rows = await queryMembers(tx, ctx, w, { membershipId, take: 1 });
    if (rows.length === 0) return null;
    const [events, leads, deals, tasks, trend] = await Promise.all([
      tx.$queryRaw<{ id: string; action: string; entity_type: string; entity_id: string | null; created_at: Date }[]>(Prisma.sql`
        SELECT e.id, e.action, e.entity_type, e.entity_id, e.created_at FROM audit_events e
        WHERE e.organization_id = ${org} AND e.actor_membership_id = ${membershipId} AND e.entity_type IN (${types})
        ORDER BY e.created_at DESC LIMIT 15`),
      access.leads
        ? tx.$queryRaw<{ id: string; company: string | null; first_name: string | null; last_name: string | null; temperature: string; next_follow_up_at: Date | null; stale: boolean }[]>(Prisma.sql`
            SELECT l.id, co.name AS company, ct.first_name, ct.last_name, l.temperature::text AS temperature, l.next_follow_up_at,
                   (l.created_at < ${w.staleCutoff} AND (l.last_contacted_at IS NULL OR l.last_contacted_at < ${w.staleCutoff})
                    AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.organization_id = l.organization_id AND a.lead_id = l.id AND a.occurred_at >= ${w.staleCutoff})) AS stale
            FROM leads l LEFT JOIN companies co ON co.id = l.company_id LEFT JOIN contacts ct ON ct.id = l.contact_id
            WHERE l.organization_id = ${org} AND l.owner_membership_id = ${membershipId} AND ${OPEN_LEAD}
            ORDER BY l.next_follow_up_at ASC NULLS LAST, l.created_at DESC, l.id LIMIT ${LIST_LIMIT}`)
        : null,
      access.deals
        ? tx.$queryRaw<{ id: string; company: string | null; stage: string; expected_close_date: Date | null; value: Prisma.Decimal | null; stuck: boolean }[]>(Prisma.sql`
            SELECT d.id, co.name AS company, ps.name AS stage, d.expected_close_date, d.value,
                   (d.last_activity_at < ${w.now}::timestamp - COALESCE(ps.stalled_after_days, ${w.defaultStallDays}::int) * interval '1 day') AS stuck
            FROM deals d JOIN pipeline_stages ps ON ps.id = d.pipeline_stage_id LEFT JOIN companies co ON co.id = d.company_id
            WHERE d.organization_id = ${org} AND d.owner_membership_id = ${membershipId} AND d.archived_at IS NULL AND d.outcome = 'OPEN'
            ORDER BY d.expected_close_date ASC NULLS LAST, d.id LIMIT ${LIST_LIMIT}`)
        : null,
      access.tasks
        ? tx.$queryRaw<{ id: string; title: string; due_at: Date | null }[]>(Prisma.sql`
            SELECT t.id, t.title, t.due_at FROM tasks t
            WHERE t.organization_id = ${org} AND t.assignee_membership_id = ${membershipId} AND t.archived_at IS NULL AND t.status IN ('PENDING','IN_PROGRESS')
            ORDER BY t.due_at ASC NULLS LAST, t.id LIMIT ${LIST_LIMIT}`)
        : null,
      tx.$queryRaw<{ start: Date; n: number }[]>(Prisma.sql`
        SELECT s.start AS start, COUNT(e.id)::int AS n
        FROM (SELECT ${w.todayStart}::timestamp - (g * interval '1 day') AS start FROM generate_series(0, 29) g) s
        LEFT JOIN audit_events e ON e.organization_id = ${org} AND e.actor_membership_id = ${membershipId} AND e.entity_type IN (${types})
             AND e.created_at >= s.start AND e.created_at < s.start + interval '1 day'
        GROUP BY s.start ORDER BY s.start`),
    ]);
    return { row: rows[0]!, events, leads, deals, tasks, trend };
  });
  if (!data) throw new NotFoundError("TeamMember", membershipId);
  const [member] = await toRows(ctx, access, [data.row]);
  const nameParts = (f: string | null, l: string | null) => [f, l].filter(Boolean).join(" ") || null;
  return {
    range: w.range,
    access,
    member: member!,
    recentActivity: data.events.map((e) => ({ id: e.id, action: e.action, label: labelFor(e.action, e.entity_type), entityType: e.entity_type, entityId: e.entity_id, at: e.created_at.toISOString(), path: pathFor(e.entity_type, e.entity_id) })),
    openLeads: data.leads?.map((r) => ({ id: r.id, company: r.company, contact: nameParts(r.first_name, r.last_name), temperature: r.temperature, nextFollowUpAt: r.next_follow_up_at?.toISOString() ?? null, stale: r.stale })) ?? null,
    openDeals: data.deals?.map((r) => ({ id: r.id, company: r.company, stage: r.stage, expectedCloseDate: r.expected_close_date?.toISOString().slice(0, 10) ?? null, stuck: r.stuck, value: money(access, r.value) })) ?? null,
    tasks: data.tasks?.map((r) => ({ id: r.id, title: r.title, dueAt: r.due_at?.toISOString() ?? null, overdue: !!r.due_at && r.due_at < w.now })) ?? null,
    trend: data.trend.map((t) => ({ start: t.start.toISOString(), count: t.n })),
  };
}
