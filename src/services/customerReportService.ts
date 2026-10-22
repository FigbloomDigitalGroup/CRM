import { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { hasPermission, requirePermission } from "../auth/context";
import { ForbiddenError, ValidationError } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import { recordAuditEvent } from "../repositories/auditEvents";
import {
  getActiveServicesByCompany,
  getCompanyNames,
  getMembershipNames,
  getWonBySalesperson,
  getWonBySalespersonByMonth,
  getWonDealsByCompany,
  listServicesEndingBefore,
} from "../repositories/customerReports";
import { buildPage, resolvePaging, type PageRequest } from "../lib/pagination";
import { getReportScope, resolveRange } from "./reportingService";

const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_DORMANCY_DAYS = 90;
export const MAX_DORMANCY_DAYS = 3650;
export const DEFAULT_RENEWAL_WINDOW_DAYS = 90;
export const MAX_RENEWAL_WINDOW_DAYS = 365;
const DORMANCY_SETTING_KEY = "reports.dormancy_days";

function startOfUtcDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function parseDays(value: unknown, label: string, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > max) {
    throw new ValidationError(`${label} must be a whole number of days from 1 to ${max}.`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Dormancy threshold (the per-organisation default)
// ---------------------------------------------------------------------------

async function loadDormancyDays(organizationId: string): Promise<number> {
  const row = await adminDb.organizationSetting.findUnique({
    where: { organizationId_key: { organizationId, key: DORMANCY_SETTING_KEY } },
  });
  const days = (row?.value as { days?: unknown } | null)?.days;
  return typeof days === "number" && Number.isInteger(days) && days >= 1
    ? days
    : DEFAULT_DORMANCY_DAYS;
}

export async function getReportSettings(ctx: AuthContext) {
  requirePermission(ctx, "reporting.view.all");
  return { dormancyDays: await loadDormancyDays(ctx.organizationId) };
}

export async function updateReportSettings(
  ctx: AuthContext,
  input: { dormancyDays: number },
) {
  requirePermission(ctx, "organization.manage_settings");
  const days = parseDays(input.dormancyDays, "dormancyDays", MAX_DORMANCY_DAYS);
  const previous = await loadDormancyDays(ctx.organizationId);
  const value = { days } as unknown as Prisma.InputJsonValue;
  await adminDb.organizationSetting.upsert({
    where: {
      organizationId_key: { organizationId: ctx.organizationId, key: DORMANCY_SETTING_KEY },
    },
    update: { value },
    create: { organizationId: ctx.organizationId, key: DORMANCY_SETTING_KEY, value },
  });
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "report_settings.updated",
    entityType: "Report",
    previousValue: { dormancyDays: previous },
    newValue: { dormancyDays: days },
  });
  return { dormancyDays: days };
}

// ---------------------------------------------------------------------------
// Active, repeat and dormant customers
// ---------------------------------------------------------------------------

export type CustomerSegment = "active" | "repeat" | "dormant";

export interface CustomerReportFilters {
  /** Overrides the organisation's dormancy threshold for this request. */
  dormantAfterDays?: number;
  segment?: CustomerSegment;
}

/**
 * A customer is a company with at least one won deal or a running service.
 * Active: a service that is ACTIVE and not past its end date, or a deal won
 * within the dormancy threshold. Dormant: a customer that is not active.
 * Repeat: two or more won deals (can also be active or dormant).
 * Live snapshot -- ignores the Reports date range. Management only, because
 * it covers every customer in the organisation.
 */
export async function getCustomerReport(
  ctx: AuthContext,
  filters: CustomerReportFilters = {},
  request: PageRequest = {},
) {
  requirePermission(ctx, "reporting.view.all");
  const canSeeValue = hasPermission(ctx, "deals.view.value");
  const dormancyDays =
    filters.dormantAfterDays === undefined
      ? await loadDormancyDays(ctx.organizationId)
      : parseDays(filters.dormantAfterDays, "dormantAfterDays", MAX_DORMANCY_DAYS);

  const now = new Date();
  const threshold = new Date(now.getTime() - dormancyDays * DAY_MS);
  const [won, services] = await Promise.all([
    getWonDealsByCompany(ctx.organizationId),
    getActiveServicesByCompany(ctx.organizationId, startOfUtcDay(now)),
  ]);

  const activeServices = new Map(services.map((s) => [s.companyId, s._count._all]));
  const wonByCompany = new Map(won.map((w) => [w.companyId, w]));
  const companyIds = new Set([...wonByCompany.keys(), ...activeServices.keys()]);
  const names = await getCompanyNames(ctx.organizationId, [...companyIds]);

  const all = [...companyIds]
    .filter((id) => names.has(id))
    .map((companyId) => {
      const w = wonByCompany.get(companyId);
      const lastWonAt = w?._max.wonAt ?? null;
      const wonCount = w?._count._all ?? 0;
      const runningServices = activeServices.get(companyId) ?? 0;
      const active = runningServices > 0 || (lastWonAt !== null && lastWonAt >= threshold);
      return {
        companyId,
        companyName: names.get(companyId)!,
        segment: (active ? "active" : "dormant") as "active" | "dormant",
        repeat: wonCount >= 2,
        wonCount,
        wonValue: canSeeValue ? (w?._sum.value ?? null) : null,
        lastWonAt,
        activeServices: runningServices,
      };
    })
    .sort(
      (a, b) =>
        (b.lastWonAt?.getTime() ?? 0) - (a.lastWonAt?.getTime() ?? 0) ||
        a.companyName.localeCompare(b.companyName) ||
        a.companyId.localeCompare(b.companyId),
    );

  const summary = {
    customers: all.length,
    active: all.filter((r) => r.segment === "active").length,
    repeat: all.filter((r) => r.repeat).length,
    dormant: all.filter((r) => r.segment === "dormant").length,
  };

  const matching = filters.segment
    ? all.filter((r) => (filters.segment === "repeat" ? r.repeat : r.segment === filters.segment))
    : all;
  const paging = resolvePaging(request);
  const page = buildPage(
    matching.slice(paging.skip, paging.skip + paging.take),
    matching.length,
    paging,
  );

  return { dormancyDays, summary, ...page, valueMasked: !canSeeValue };
}

// ---------------------------------------------------------------------------
// Won value and count by salesperson, by period
// ---------------------------------------------------------------------------

export interface SalespersonReportFilters {
  ownerMembershipId?: string;
  serviceId?: string;
  dateFrom?: string;
  dateTo?: string;
  /** "month" splits each salesperson's figures by calendar month of the win. */
  period?: "total" | "month";
}

/**
 * Won deals per owner in the window (by `wonAt`). Management sees everyone;
 * other roles with report access see only deals they may already see -- an
 * own-only role gets just their own row, a role that views every deal gets
 * all rows. Values follow the Deals page rule: always on your own deals,
 * otherwise only with `deals.view.value`.
 */
export async function getSalesBySalesperson(
  ctx: AuthContext,
  filters: SalespersonReportFilters = {},
) {
  const scope = getReportScope(ctx);
  if (!scope.deals) throw new ForbiddenError("deals.view.own (or .all)");
  const ownOnly = scope.mode === "personal" && scope.deals === "own";
  const canSeeValue = ownOnly || hasPermission(ctx, "deals.view.value");

  const { dateFrom, dateTo, dateToQuery } = resolveRange(filters);
  const repoFilters = {
    ownerMembershipId: ownOnly ? ctx.membershipId : filters.ownerMembershipId || undefined,
    serviceId: filters.serviceId || undefined,
    dateFrom,
    dateTo: dateToQuery,
  };
  const monthly = filters.period === "month";

  const rows = monthly
    ? await getWonBySalespersonByMonth(ctx.organizationId, repoFilters)
    : (await getWonBySalesperson(ctx.organizationId, repoFilters)).map((r) => ({
        ownerMembershipId: r.ownerMembershipId,
        month: null as Date | null,
        count: r._count._all,
        value: r._sum.value as Prisma.Decimal | null,
      }));
  const names = await getMembershipNames(
    ctx.organizationId,
    [...new Set(rows.map((r) => r.ownerMembershipId))],
  );

  return {
    dateFrom,
    dateTo,
    period: monthly ? ("month" as const) : ("total" as const),
    rows: rows
      .map((r) => ({
        ownerMembershipId: r.ownerMembershipId,
        ownerName: names.get(r.ownerMembershipId) ?? null,
        month: r.month ? r.month.toISOString().slice(0, 7) : null,
        wonCount: r.count,
        wonValue: canSeeValue ? r.value : null,
      }))
      .sort(
        (a, b) =>
          (a.month ?? "").localeCompare(b.month ?? "") ||
          b.wonCount - a.wonCount ||
          a.ownerMembershipId.localeCompare(b.ownerMembershipId),
      ),
    valueMasked: !canSeeValue,
  };
}

// ---------------------------------------------------------------------------
// Upcoming renewals / service end dates
// ---------------------------------------------------------------------------

/**
 * Active services (CompanyService) whose end date falls within the next
 * `withinDays` days, plus any already past their end date but still marked
 * active (`lapsed`), soonest first. Live snapshot. Management only, and the
 * caller must be able to view company services.
 */
export async function getUpcomingRenewals(
  ctx: AuthContext,
  filters: { withinDays?: number } = {},
  request: PageRequest = {},
) {
  requirePermission(ctx, "reporting.view.all");
  requirePermission(ctx, "company_services.view");
  const withinDays =
    filters.withinDays === undefined
      ? DEFAULT_RENEWAL_WINDOW_DAYS
      : parseDays(filters.withinDays, "withinDays", MAX_RENEWAL_WINDOW_DAYS);

  const today = startOfUtcDay(new Date());
  const before = new Date(today.getTime() + (withinDays + 1) * DAY_MS);
  const services = await listServicesEndingBefore(ctx.organizationId, before);

  const all = services.map((s) => {
    const daysLeft = Math.round((s.endDate!.getTime() - today.getTime()) / DAY_MS);
    return {
      companyServiceId: s.id,
      companyId: s.company.id,
      companyName: s.company.name,
      serviceId: s.service.id,
      serviceName: s.service.name,
      endDate: s.endDate!.toISOString().slice(0, 10),
      daysLeft,
      lapsed: daysLeft < 0,
    };
  });
  const paging = resolvePaging(request);
  const page = buildPage(
    all.slice(paging.skip, paging.skip + paging.take),
    all.length,
    paging,
  );
  return {
    withinDays,
    summary: {
      renewing: all.filter((r) => !r.lapsed).length,
      lapsed: all.filter((r) => r.lapsed).length,
    },
    ...page,
  };
}
