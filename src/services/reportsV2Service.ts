import { stringifyCsv as stringify } from "../lib/csv";
import type { AuthContext } from "../auth/context";
import { hasPermission, requirePermission } from "../auth/context";
import { ValidationError } from "../auth/errors";
import { fromCents, startOfDay, toCents } from "../lib/payments";
import { renewalStanding, type RenewalState } from "../lib/renewals";
import { recordAuditEvent } from "../repositories/auditEvents";
import {
  leadStatusNames,
  leadsByOwner,
  leadsBySourceAndConversion,
  leadsByStatusAndConversion,
  lostByReason,
  lostReasonNames,
  memberNames,
  openPipelineByStage,
  personalCounts,
  sourceNames,
  stageNames,
  tasksCompletedByAssignee,
  wonByOwner,
  type Window,
} from "../repositories/reportsV2";
import { listLiveRecurring } from "../repositories/retention";
import { getCustomerReport } from "./customerReportService";
import { assertBulkExportAllowed } from "./exportService";
import { loadRenewalSettings } from "./renewalSettings";
import { getReportScope, resolveRange } from "./reportingService";

/**
 * Reports v2 and My metrics (FIG-1055, B3.09, design R1 and R2), built on the reports of FIG-603 and FIG-793.
 *
 * Every report answers in one shape: a `table` (columns and rows), a `chart` whose series is read from the same rows
 * (so a bar and the table beside it are the same numbers), and a `definition` sentence that is also written out in
 * `docs/REPORTING_METRICS.md`. A rate with nothing to divide by is 0, never NaN or "UNDEFINED".
 *
 *   organisation reports : `reporting.view.all` (Management)
 *   My metrics           : the caller's own records only, for Sales, Delivery, Finance and Technical
 *   values               : shown only to callers who may see aggregate values, otherwise the chart falls back to counts
 *   CSV                  : the same table; above the bulk-export limit it needs `export.bulk`
 */

export const REPORT_KEYS = [
  "LEAD_SOURCES",
  "CONVERSION_BY_SOURCE",
  "CONVERSION_BY_STAGE",
  "PIPELINE_BY_STAGE",
  "LOST_REASONS",
  "PER_PERSON",
  "MONTH_VS_LAST",
  "CUSTOMERS",
  "RENEWALS",
] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

export interface ReportColumn {
  key: string;
  label: string;
  type: "text" | "number" | "percent" | "money";
}
export type ReportCell = string | number | null;
export type ReportRow = Record<string, ReportCell>;

export interface ReportResult {
  key: string;
  title: string;
  definition: string;
  scope: "organisation" | "own";
  range: { from: Date; to: Date } | null;
  valueMasked: boolean;
  chart: { type: "bar" | "donut"; metric: string; series: { label: string; value: number | null }[]; compare?: { metric: string; series: { label: string; value: number | null }[] } };
  table: { columns: ReportColumn[]; rows: ReportRow[]; totals: ReportRow | null };
}

export const REPORT_DEFINITIONS: Record<ReportKey | "MY_METRICS", { title: string; definition: string }> = {
  LEAD_SOURCES: { title: "Lead sources", definition: "Leads created in the date range, counted by the source they came from. A lead with no source is counted as No source." },
  CONVERSION_BY_SOURCE: { title: "Conversion by source", definition: "Of the leads created in the date range, how many have become a deal as of today, by source. Conversion is converted divided by created, shown as 0% when no leads were created." },
  CONVERSION_BY_STAGE: { title: "Conversion by lead stage", definition: "Of the leads created in the date range, how many sit at each lead status now, and how many of those have become a deal. Conversion is converted divided by leads at that status." },
  PIPELINE_BY_STAGE: { title: "Pipeline by stage", definition: "A live snapshot of open deals: the count and total value at each pipeline stage. Not affected by the date range." },
  LOST_REASONS: { title: "Lost reasons", definition: "Deals marked lost in the date range, counted by the reason recorded. Share is the reason's deals divided by all lost deals." },
  PER_PERSON: { title: "Per person", definition: "For each salesperson: leads they were given in the date range, how many converted, deals they won in the range with their value, and tasks they completed." },
  MONTH_VS_LAST: { title: "This month against last month", definition: "The same measures for this calendar month so far and for the whole of last month. Change is this month minus last month; the percentage change is empty when last month was zero." },
  CUSTOMERS: { title: "Customers", definition: "A live snapshot of customers: companies with a won deal or a running service. Active, repeat (two or more won deals) and dormant (no activity inside the dormancy threshold) follow the customer report." },
  RENEWALS: { title: "Renewals", definition: "A live snapshot of recurring services by renewal state (active, due soon, lapsed, starts later), with their total value." },
  MY_METRICS: { title: "My metrics", definition: "Your own figures for the date range: only records you own or work on, never anyone else's." },
};

const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);
const money = (value: { toString(): string } | null | undefined) => (value === null || value === undefined ? null : fromCents(toCents(value)));

export interface ReportFilters {
  dateFrom?: string;
  dateTo?: string;
}

interface Built {
  columns: ReportColumn[];
  rows: ReportRow[];
  totals?: ReportRow | null;
  chart: { type: "bar" | "donut"; metric: string; label?: string; fallbackMetric?: string; compare?: string };
  /** Columns that hold money, hidden for a caller who may not see values. */
  valueColumns?: string[];
}

function assemble(key: ReportKey | "MY_METRICS", ctx: AuthContext, built: Built, scope: "organisation" | "own", range: ReportResult["range"], canSeeValue: boolean): ReportResult {
  const valueColumns = new Set(built.valueColumns ?? []);
  const hide = !canSeeValue && valueColumns.size > 0;
  const rows = built.rows.map((row) => (hide ? Object.fromEntries(Object.entries(row).map(([k, v]) => [k, valueColumns.has(k) ? null : v])) : row));
  const totals = built.totals ? (hide ? Object.fromEntries(Object.entries(built.totals).map(([k, v]) => [k, valueColumns.has(k) ? null : v])) : built.totals) : null;
  const metric = hide && valueColumns.has(built.chart.metric) ? (built.chart.fallbackMetric ?? built.chart.metric) : built.chart.metric;
  const labelKey = built.chart.label ?? "label";
  const series = (m: string) => rows.map((r) => ({ label: String(r[labelKey] ?? ""), value: typeof r[m] === "number" ? (r[m] as number) : r[m] === null || r[m] === undefined ? null : Number(r[m]) }));
  return {
    key,
    title: REPORT_DEFINITIONS[key].title,
    definition: REPORT_DEFINITIONS[key].definition,
    scope,
    range,
    valueMasked: hide,
    chart: { type: built.chart.type, metric, series: series(metric), ...(built.chart.compare ? { compare: { metric: built.chart.compare, series: series(built.chart.compare) } } : {}) },
    table: { columns: built.columns, rows, totals },
  };
}

function nameMap<T extends { id: string; name: string }>(rows: T[]) {
  return new Map(rows.map((r) => [r.id, r.name]));
}

// ---------------------------------------------------------------------------
// Organisation reports
// ---------------------------------------------------------------------------

async function buildReport(ctx: AuthContext, key: ReportKey, window: Window, now: Date): Promise<Built> {
  const org = ctx.organizationId;
  switch (key) {
    case "LEAD_SOURCES": {
      const [{ all }, sources] = await Promise.all([leadsBySourceAndConversion(org, window), sourceNames(org)]);
      const names = nameMap(sources);
      const rows = all.map((r) => ({ label: r.leadSourceId ? (names.get(r.leadSourceId) ?? "Unknown source") : "No source", leads: r._count._all })).sort((a, b) => b.leads - a.leads || a.label.localeCompare(b.label));
      return { columns: [{ key: "label", label: "Source", type: "text" }, { key: "leads", label: "Leads", type: "number" }], rows, totals: { label: "Total", leads: rows.reduce((s, r) => s + r.leads, 0) }, chart: { type: "bar", metric: "leads" } };
    }
    case "CONVERSION_BY_SOURCE": {
      const [{ all, converted }, sources] = await Promise.all([leadsBySourceAndConversion(org, window), sourceNames(org)]);
      const names = nameMap(sources);
      const done = new Map(converted.map((r) => [r.leadSourceId, r._count._all]));
      const rows = all.map((r) => {
        const c = done.get(r.leadSourceId) ?? 0;
        return { label: r.leadSourceId ? (names.get(r.leadSourceId) ?? "Unknown source") : "No source", leads: r._count._all, converted: c, conversion: pct(c, r._count._all) };
      }).sort((a, b) => b.leads - a.leads || a.label.localeCompare(b.label));
      const leads = rows.reduce((s, r) => s + r.leads, 0);
      const conv = rows.reduce((s, r) => s + r.converted, 0);
      return {
        columns: [{ key: "label", label: "Source", type: "text" }, { key: "leads", label: "Leads", type: "number" }, { key: "converted", label: "Converted", type: "number" }, { key: "conversion", label: "Conversion", type: "percent" }],
        rows,
        totals: { label: "Total", leads, converted: conv, conversion: pct(conv, leads) },
        chart: { type: "bar", metric: "conversion" },
      };
    }
    case "CONVERSION_BY_STAGE": {
      const [{ all, converted }, statuses] = await Promise.all([leadsByStatusAndConversion(org, window), leadStatusNames(org)]);
      const done = new Map(converted.map((r) => [r.leadStatusId, r._count._all]));
      const counts = new Map(all.map((r) => [r.leadStatusId, r._count._all]));
      const rows = statuses.filter((s) => counts.has(s.id)).map((s) => {
        const n = counts.get(s.id) ?? 0;
        const c = done.get(s.id) ?? 0;
        return { label: s.name, leads: n, converted: c, conversion: pct(c, n) };
      });
      const leads = rows.reduce((s, r) => s + r.leads, 0);
      const conv = rows.reduce((s, r) => s + r.converted, 0);
      return {
        columns: [{ key: "label", label: "Lead stage", type: "text" }, { key: "leads", label: "Leads", type: "number" }, { key: "converted", label: "Converted", type: "number" }, { key: "conversion", label: "Conversion", type: "percent" }],
        rows,
        totals: { label: "Total", leads, converted: conv, conversion: pct(conv, leads) },
        chart: { type: "bar", metric: "leads" },
      };
    }
    case "PIPELINE_BY_STAGE": {
      const [groups, stages] = await Promise.all([openPipelineByStage(org), stageNames(org)]);
      const byStage = new Map(groups.map((g) => [g.pipelineStageId, g]));
      const rows = stages.filter((s) => byStage.has(s.id)).map((s) => ({ label: s.name, deals: byStage.get(s.id)!._count._all, value: money(byStage.get(s.id)!._sum.value) ?? "0.00" }));
      const value = groups.reduce((s, g) => s + (g._sum.value ? toCents(g._sum.value) : 0), 0);
      return {
        columns: [{ key: "label", label: "Stage", type: "text" }, { key: "deals", label: "Open deals", type: "number" }, { key: "value", label: "Value", type: "money" }],
        rows,
        totals: { label: "Total", deals: rows.reduce((s, r) => s + r.deals, 0), value: fromCents(value) },
        chart: { type: "bar", metric: "value", fallbackMetric: "deals" },
        valueColumns: ["value"],
      };
    }
    case "LOST_REASONS": {
      const [groups, reasons] = await Promise.all([lostByReason(org, window), lostReasonNames(org)]);
      const names = nameMap(reasons);
      const total = groups.reduce((s, g) => s + g._count._all, 0);
      const rows = groups.map((g) => ({ label: g.lostReasonId ? (names.get(g.lostReasonId) ?? "Unknown reason") : "No reason recorded", deals: g._count._all, value: money(g._sum.value) ?? "0.00", share: pct(g._count._all, total) })).sort((a, b) => b.deals - a.deals || a.label.localeCompare(b.label));
      return {
        columns: [{ key: "label", label: "Reason", type: "text" }, { key: "deals", label: "Lost deals", type: "number" }, { key: "share", label: "Share", type: "percent" }, { key: "value", label: "Value lost", type: "money" }],
        rows,
        totals: { label: "Total", deals: total, share: total === 0 ? 0 : 100, value: fromCents(groups.reduce((s, g) => s + (g._sum.value ? toCents(g._sum.value) : 0), 0)) },
        chart: { type: "donut", metric: "deals" },
        valueColumns: ["value"],
      };
    }
    case "PER_PERSON": {
      const [{ all, converted }, won, tasks, members] = await Promise.all([leadsByOwner(org, window), wonByOwner(org, window), tasksCompletedByAssignee(org, window), memberNames(org)]);
      const names = new Map(members.map((m) => [m.id, m.user.name]));
      const ids = new Set<string>([...all.map((r) => r.ownerMembershipId!), ...won.map((r) => r.ownerMembershipId), ...tasks.map((r) => r.assigneeMembershipId)]);
      const rows = [...ids].map((id) => {
        const leads = all.find((r) => r.ownerMembershipId === id)?._count._all ?? 0;
        const conv = converted.find((r) => r.ownerMembershipId === id)?._count._all ?? 0;
        const w = won.find((r) => r.ownerMembershipId === id);
        return { label: names.get(id) ?? "Former member", leads, converted: conv, conversion: pct(conv, leads), dealsWon: w?._count._all ?? 0, wonValue: money(w?._sum.value) ?? "0.00", tasksCompleted: tasks.find((r) => r.assigneeMembershipId === id)?._count._all ?? 0 };
      }).sort((a, b) => b.dealsWon - a.dealsWon || b.leads - a.leads || a.label.localeCompare(b.label));
      const sum = (k: "leads" | "converted" | "dealsWon" | "tasksCompleted") => rows.reduce((s, r) => s + r[k], 0);
      return {
        columns: [
          { key: "label", label: "Person", type: "text" },
          { key: "leads", label: "Leads", type: "number" },
          { key: "converted", label: "Converted", type: "number" },
          { key: "conversion", label: "Conversion", type: "percent" },
          { key: "dealsWon", label: "Deals won", type: "number" },
          { key: "wonValue", label: "Won value", type: "money" },
          { key: "tasksCompleted", label: "Tasks completed", type: "number" },
        ],
        rows,
        totals: { label: "Total", leads: sum("leads"), converted: sum("converted"), conversion: pct(sum("converted"), sum("leads")), dealsWon: sum("dealsWon"), wonValue: fromCents(rows.reduce((s, r) => s + toCents(r.wonValue), 0)), tasksCompleted: sum("tasksCompleted") },
        chart: { type: "bar", metric: "wonValue", fallbackMetric: "dealsWon" },
        valueColumns: ["wonValue"],
      };
    }
    case "MONTH_VS_LAST": {
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const lastStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const [thisM, lastM] = await Promise.all([monthFigures(org, { from: monthStart }), monthFigures(org, { from: lastStart, to: monthStart })]);
      const row = (label: string, a: number, b: number, type: "count" | "percent" | "money") => {
        const change = Math.round((a - b) * 100) / 100;
        return { label, thisMonth: type === "money" ? fromCents(Math.round(a * 100)) : a, lastMonth: type === "money" ? fromCents(Math.round(b * 100)) : b, change: type === "money" ? fromCents(Math.round(change * 100)) : change, changePct: b === 0 ? null : Math.round(((a - b) / b) * 1000) / 10 };
      };
      return {
        columns: [{ key: "label", label: "Measure", type: "text" }, { key: "thisMonth", label: "This month", type: "number" }, { key: "lastMonth", label: "Last month", type: "number" }, { key: "change", label: "Change", type: "number" }, { key: "changePct", label: "Change %", type: "percent" }],
        rows: [
          row("Leads created", thisM.leads, lastM.leads, "count"),
          row("Leads converted", thisM.converted, lastM.converted, "count"),
          row("Conversion %", pct(thisM.converted, thisM.leads), pct(lastM.converted, lastM.leads), "percent"),
          row("Deals won", thisM.won, lastM.won, "count"),
          row("Won value", thisM.wonValue / 100, lastM.wonValue / 100, "money"),
        ],
        chart: { type: "bar", metric: "thisMonth", compare: "lastMonth" },
        valueColumns: [],
      };
    }
    case "CUSTOMERS": {
      const report = await getCustomerReport(ctx, {}, { pageSize: 1 });
      const s = report.summary;
      const rows = [{ label: "Active", customers: s.active }, { label: "Repeat", customers: s.repeat }, { label: "Dormant", customers: s.dormant }];
      return { columns: [{ key: "label", label: "Customers", type: "text" }, { key: "customers", label: "Count", type: "number" }], rows, totals: { label: "All customers", customers: s.customers }, chart: { type: "donut", metric: "customers" } };
    }
    case "RENEWALS": {
      const [live, settings] = await Promise.all([listLiveRecurring(org), loadRenewalSettings(org)]);
      const today = startOfDay(now);
      const order: RenewalState[] = ["ACTIVE", "DUE_SOON", "LAPSED", "STARTS_LATER"];
      const label: Record<string, string> = { ACTIVE: "Active", DUE_SOON: "Due soon", LAPSED: "Lapsed", STARTS_LATER: "Starts later" };
      const tally = new Map<string, { n: number; cents: number }>();
      for (const r of live) {
        const st = renewalStanding({ startsOn: r.startsOn, renewsOn: r.renewsOn, cancelledAt: r.cancelledAt, stateOverride: r.stateOverride }, today, settings).state;
        const t = tally.get(st) ?? { n: 0, cents: 0 };
        t.n += 1;
        t.cents += r.value ? toCents(r.value) : 0;
        tally.set(st, t);
      }
      const rows = order.map((st) => ({ label: label[st]!, services: tally.get(st)?.n ?? 0, value: fromCents(tally.get(st)?.cents ?? 0) }));
      return {
        columns: [{ key: "label", label: "Renewal state", type: "text" }, { key: "services", label: "Services", type: "number" }, { key: "value", label: "Value", type: "money" }],
        rows,
        totals: { label: "Total", services: rows.reduce((s, r) => s + r.services, 0), value: fromCents(rows.reduce((s, r) => s + toCents(r.value), 0)) },
        chart: { type: "bar", metric: "services" },
        valueColumns: ["value"],
      };
    }
  }
}

async function monthFigures(organizationId: string, w: Window) {
  const [leads, won] = await Promise.all([leadsBySourceAndConversion(organizationId, w), wonByOwner(organizationId, w)]);
  return {
    leads: leads.all.reduce((s, r) => s + r._count._all, 0),
    converted: leads.converted.reduce((s, r) => s + r._count._all, 0),
    won: won.reduce((s, r) => s + r._count._all, 0),
    wonValue: won.reduce((s, r) => s + (r._sum.value ? toCents(r._sum.value) : 0), 0),
  };
}

function windowOf(filters: ReportFilters) {
  const { dateFrom, dateTo, dateToQuery } = resolveRange(filters);
  return { window: { from: dateFrom, to: dateToQuery } as Window, range: { from: dateFrom, to: dateTo } };
}

const LIVE_REPORTS: ReportKey[] = ["PIPELINE_BY_STAGE", "CUSTOMERS", "RENEWALS", "MONTH_VS_LAST"];

export async function getReport(ctx: AuthContext, key: string, filters: ReportFilters = {}, now = new Date()): Promise<ReportResult> {
  requirePermission(ctx, "reporting.view.all");
  if (!(REPORT_KEYS as readonly string[]).includes(key)) {
    throw new ValidationError(`Unknown report "${key}".`, [{ path: "report", message: `Use one of ${REPORT_KEYS.join(", ")}.` }]);
  }
  const k = key as ReportKey;
  const { window, range } = windowOf(filters);
  const built = await buildReport(ctx, k, window, now);
  const canSeeValue = hasPermission(ctx, "deals.view.value");
  return assemble(k, ctx, built, "organisation", LIVE_REPORTS.includes(k) ? null : range, canSeeValue);
}

/** Every organisation report for the Reports page, in one call. */
export async function getReports(ctx: AuthContext, filters: ReportFilters = {}, now = new Date()) {
  requirePermission(ctx, "reporting.view.all");
  const reports = await Promise.all(REPORT_KEYS.map((k) => getReport(ctx, k, filters, now)));
  return { range: windowOf(filters).range, reports };
}

// ---------------------------------------------------------------------------
// My metrics
// ---------------------------------------------------------------------------

export interface MetricCard {
  key: string;
  label: string;
  value: number | string | null;
  unit: "count" | "percent" | "money";
  definition: string;
}

/**
 * The caller's own figures for the date range. Only their own records are counted, whatever their role can see
 * elsewhere. A role sees the cards that make sense for it: Sales leads and deals, Delivery handoffs, Finance payments
 * recorded, everyone with tasks their tasks.
 */
export async function getMyMetricsV2(ctx: AuthContext, filters: ReportFilters = {}, now = new Date()): Promise<ReportResult & { cards: MetricCard[] }> {
  getReportScope(ctx); // refuses roles with no reporting access, with the explained no-access
  const { window, range } = windowOf(filters);
  const c = await personalCounts(ctx.organizationId, ctx.membershipId, window, now);
  const cards: MetricCard[] = [];
  const add = (key: string, label: string, value: number | string | null, unit: MetricCard["unit"], definition: string) => cards.push({ key, label, value, unit, definition });
  const canLeads = hasPermission(ctx, "leads.view.own") || hasPermission(ctx, "leads.view.all");
  const canDeals = hasPermission(ctx, "deals.view.own") || hasPermission(ctx, "deals.view.all");
  const canTasks = hasPermission(ctx, "tasks.view.own") || hasPermission(ctx, "tasks.view.all");
  if (canLeads) {
    add("leads", "Leads given to me", c.leads, "count", "Leads you own that were created in the date range.");
    add("converted", "Leads I converted", c.converted, "count", "Of those leads, how many have become a deal as of today.");
    add("conversion", "My conversion", pct(c.converted, c.leads), "percent", "Converted divided by leads, 0% when you had none.");
  }
  if (canDeals) {
    add("dealsWon", "Deals I won", c.wonDeals._count._all, "count", "Deals you own that were won in the date range.");
    add("wonValue", "Value I won", money(c.wonDeals._sum.value) ?? "0.00", "money", "Total value of the deals you won in the date range. Your own deals' values are always yours to see.");
    add("openDeals", "My open deals", c.openDeals._count._all, "count", "Deals you own that are still open (a live figure).");
    add("openValue", "My open pipeline", money(c.openDeals._sum.value) ?? "0.00", "money", "Total value of your open deals (a live figure).");
  }
  if (hasPermission(ctx, "activities.create") && (canLeads || canDeals || hasPermission(ctx, "communications.create"))) {
    add("calls", "Calls and WhatsApp logged", c.calls, "count", "Calls and WhatsApp messages you logged in the date range.");
  }
  if (hasPermission(ctx, "handoff.manage")) {
    add("handoffsTaken", "Handoffs I took", c.handoffsTaken, "count", "Handoffs where you became the Delivery owner in the date range.");
    add("handoffsDelivered", "Handoffs I delivered", c.handoffsDelivered, "count", "Handoffs you marked Delivered in the date range.");
    add("onboarding", "Onboarding in progress", c.onboarding, "count", "Handoffs you own that are still being onboarded (a live figure).");
  }
  if (hasPermission(ctx, "finance.view.payments")) {
    add("invoicesCreated", "Invoices I created", c.invoicesCreated, "count", "Invoices you created in the date range.");
    add("paymentsRecorded", "Payments I recorded", c.paymentsRecorded._count._all, "count", "Payments you recorded in the date range that were not reversed.");
    add("amountRecorded", "Amount I recorded", money(c.paymentsRecorded._sum.amount) ?? "0.00", "money", "Total of the payments you recorded in the date range.");
    add("notesUpdated", "Follow-up notes I kept", c.notesUpdated, "count", "Won-deal follow-up notes you added or changed in the date range.");
  }
  if (canTasks) {
    add("tasksDone", "Tasks I completed", c.tasksDone, "count", "Tasks assigned to you that you completed in the date range.");
    add("tasksOpen", "My open tasks", c.tasksOpen, "count", "Tasks assigned to you that are not finished (a live figure).");
    add("tasksOverdue", "My overdue tasks", c.tasksOverdue, "count", "Open tasks assigned to you whose due date has passed (a live figure).");
  }
  const built: Built = {
    columns: [{ key: "label", label: "Measure", type: "text" }, { key: "value", label: "Value", type: "number" }],
    rows: cards.map((card) => ({ label: card.label, value: card.value })),
    chart: { type: "bar", metric: "value" },
  };
  const result = assemble("MY_METRICS", ctx, built, "own", range, true);
  return { ...result, cards };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/**
 * The CSV of one report: the same columns and rows as the table, under the bulk-export rule, and audited. Organisation
 * reports need `reporting.view.all`; My metrics is the caller's own data.
 */
export async function exportReportCsv(ctx: AuthContext, key: string, filters: ReportFilters = {}, now = new Date()): Promise<string> {
  const report = key === "MY_METRICS" ? await getMyMetricsV2(ctx, filters, now) : await getReport(ctx, key, filters, now);
  await assertBulkExportAllowed(ctx, report.table.rows.length);
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "report.exported",
    entityType: "Report",
    metadata: { report: key, rows: report.table.rows.length },
  });
  const columns = report.table.columns.map((c) => c.key);
  const rows = [...report.table.rows, ...(report.table.totals ? [report.table.totals] : [])];
  return stringify(
    rows.map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? ""]))),
    { header: true, columns: report.table.columns.map((c) => ({ key: c.key, header: c.label })) },
  );
}
