import { stringifyCsv as stringify } from "../lib/csv";
import type { AuthContext } from "../auth/context";
import { deny, hasPermission, requirePermission } from "../auth/context";
import { adminDb } from "../db/adminClient";
import { listOrganizationMemberships } from "../repositories/memberships";
import type { ListCompaniesFilters } from "../repositories/companies";
import type { ListContactsFilters } from "../repositories/contacts";
import type { ListLeadsFilters } from "../repositories/leads";
import type { ListDealsFilters } from "../repositories/deals";
import { recordAuditEvent } from "../repositories/auditEvents";
import { iterateInBatches } from "../lib/pagination";
import { consumeExportApproval, loadExportRights } from "./privacySettings";
import { countCompanies, listCompanies } from "./companyService";
import { countContacts, listContacts } from "./contactService";
import { countLeads, listLeads } from "./leadService";
import { countDeals, listDeals } from "./dealService";
import {
  getCustomerReport,
  getSalesBySalesperson,
  getUpcomingRenewals,
} from "./customerReportService";
import { loadActiveDefinitions } from "./customFieldService";
import { getFormReferenceData } from "./referenceDataService";
import { buildReportNameResolvers } from "./reportingNames";
import {
  getOrganizationMetrics,
  type OrganizationMetricsFilters,
} from "./reportingService";

/**
 * Exports above the organisation's row threshold (default 500, FIG-1062, B4.05) need the bulk-export permission or a role the organisation
 * allows, or an approval from Management for this person and this kind of export (`approvalId`, spent once).
 */
export const BULK_EXPORT_ROW_LIMIT = 500;

export async function assertBulkExportAllowed(
  ctx: AuthContext,
  rowCount: number,
  options: { approvalId?: string; entity?: string } = {},
): Promise<void> {
  const rights = await loadExportRights(ctx.organizationId);
  if (rowCount <= rights.approvalThreshold) return;
  if (hasPermission(ctx, "export.bulk") || rights.allowedRoleKeys.includes(ctx.roleKey)) return;
  if (options.approvalId && options.entity && (await consumeExportApproval(ctx.organizationId, ctx.membershipId, options.approvalId, options.entity, rowCount))) return;
  throw deny(ctx, `export.bulk, or an approved export request (more than ${rights.approvalThreshold} rows)`, ["export.bulk"]);
}

export interface CsvExport {
  columns: string[];
  rows: AsyncIterable<Record<string, unknown>>;
}

/**
 * Maps rows lazily as they stream out. Together with `iterateInBatches`
 * this keeps an export's memory flat while still covering the full
 * filtered set (FIG-789): rows are fetched a batch at a time, in the same
 * total order the paged lists use, and never all held at once.
 */
async function* mapRows<T, R>(
  source: AsyncIterable<T>,
  fn: (item: T) => R,
): AsyncIterable<R> {
  for await (const item of source) yield fn(item);
}

async function membershipLookup(organizationId: string) {
  const members = await listOrganizationMemberships(organizationId);
  const byId = new Map(members.map((m) => [m.membershipId, m.userEmail]));
  return (membershipId: string | null) =>
    membershipId ? (byId.get(membershipId) ?? membershipId) : "";
}

const dateOrEmpty = (d: Date | null | undefined) => (d ? d.toISOString() : "");

/**
 * Extra columns every record export carries: `tags`, and one column per active
 * custom field (`cf:<key>`; for leads also `q:<key>` per qualification question)
 * (FIG-798, FIG-803). Values are written the way the importer reads them back:
 * choices by option value, several choices joined with ";".
 */
async function exportExtras(ctx: AuthContext, entityType: "LEAD" | "CONTACT" | "COMPANY" | "DEAL") {
  const defs = await loadActiveDefinitions(ctx.organizationId, entityType);
  const general = defs.filter((d) => d.section === "GENERAL");
  const qualification = defs.filter((d) => d.section === "QUALIFICATION");
  const columns = [
    "tags",
    ...general.map((d) => `cf:${d.key}`),
    ...qualification.map((d) => `q:${d.key}`),
  ];
  const cell = (value: unknown) => (Array.isArray(value) ? value.join(";") : value === null || value === undefined ? "" : String(value));
  return {
    columns,
    cells: (row: { tagLinks?: { tag: { name: string } }[]; customFields?: unknown; qualificationData?: unknown }) => {
      const custom = (row.customFields ?? {}) as Record<string, unknown>;
      const answers = (row.qualificationData ?? {}) as Record<string, unknown>;
      return {
        tags: (row.tagLinks ?? []).map((l) => l.tag.name).join("; "),
        ...Object.fromEntries(general.map((d) => [`cf:${d.key}`, cell(custom[d.key])])),
        ...Object.fromEntries(qualification.map((d) => [`q:${d.key}`, cell(answers[d.key])])),
      };
    },
  };
}

export async function exportCompaniesCsv(
  ctx: AuthContext,
  filters: ListCompaniesFilters = {},
): Promise<CsvExport> {
  requirePermission(ctx, "companies.export");

  const [total, lifecycleStates, ownerOf] = await Promise.all([
    countCompanies(ctx, filters),
    adminDb.customerLifecycleState.findMany({
      where: { organizationId: ctx.organizationId },
      select: { id: true, name: true },
    }),
    membershipLookup(ctx.organizationId),
  ]);
  const lifecycleName = new Map(lifecycleStates.map((s) => [s.id, s.name]));

  await assertBulkExportAllowed(ctx, total);
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "companies.exported",
    entityType: "Company",
    metadata: { count: total },
  });

  const columns = [
    "id",
    "name",
    "industry",
    "website",
    "location",
    "phone",
    "email",
    "lifecycleState",
    "owner",
    "notes",
    "createdAt",
  ];
  const extra = await exportExtras(ctx, "COMPANY");
  columns.push(...extra.columns);
  return {
    columns,
    rows: mapRows(
      iterateInBatches((skip, take) =>
        listCompanies(ctx, { ...filters, skip, take }),
      ),
      (c) => ({
        ...extra.cells(c),
        id: c.id,
        name: c.name,
        industry: c.industry ?? "",
        website: c.website ?? "",
        location: c.location ?? "",
        phone: c.phone ?? "",
        email: c.email ?? "",
        lifecycleState: c.lifecycleStateId
          ? (lifecycleName.get(c.lifecycleStateId) ?? "")
          : "",
        owner: ownerOf(c.ownerMembershipId),
        notes: c.notes ?? "",
        createdAt: dateOrEmpty(c.createdAt),
      }),
    ),
  };
}

export async function exportContactsCsv(
  ctx: AuthContext,
  filters: ListContactsFilters = {},
): Promise<CsvExport> {
  requirePermission(ctx, "contacts.export");

  const [total, ownerOf] = await Promise.all([
    countContacts(ctx, filters),
    membershipLookup(ctx.organizationId),
  ]);

  await assertBulkExportAllowed(ctx, total);
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "contacts.exported",
    entityType: "Contact",
    metadata: { count: total },
  });

  const columns = [
    "id",
    "firstName",
    "lastName",
    "company",
    "phone",
    "email",
    "jobTitle",
    "department",
    "owner",
    "notes",
    "createdAt",
  ];
  const extra = await exportExtras(ctx, "CONTACT");
  columns.push(...extra.columns);
  return {
    columns,
    rows: mapRows(
      iterateInBatches((skip, take) =>
        listContacts(ctx, { ...filters, skip, take }),
      ),
      (c) => ({
        ...extra.cells(c),
        id: c.id,
        firstName: c.firstName,
        lastName: c.lastName ?? "",
        company: c.company?.name ?? "",
        phone: c.phone ?? "",
        email: c.email ?? "",
        jobTitle: c.jobTitle ?? "",
        department: c.department ?? "",
        owner: ownerOf(c.ownerMembershipId),
        notes: c.notes ?? "",
        createdAt: dateOrEmpty(c.createdAt),
      }),
    ),
  };
}

export async function exportLeadsCsv(
  ctx: AuthContext,
  filters: ListLeadsFilters = {},
): Promise<CsvExport> {
  requirePermission(ctx, "leads.export");

  const [total, services, ownerOf] = await Promise.all([
    countLeads(ctx, filters),
    adminDb.service.findMany({
      where: { organizationId: ctx.organizationId },
      select: { id: true, name: true },
    }),
    membershipLookup(ctx.organizationId),
  ]);
  const serviceName = new Map(services.map((s) => [s.id, s.name]));

  await assertBulkExportAllowed(ctx, total);
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "leads.exported",
    entityType: "Lead",
    metadata: { count: total },
  });

  const columns = [
    "id",
    "company",
    "contact",
    "contactEmail",
    "contactPhone",
    "leadStatus",
    "leadSource",
    "temperature",
    "serviceInterest",
    "owner",
    "nextFollowUpAt",
    "convertedAt",
    "notes",
    "createdAt",
  ];
  const extra = await exportExtras(ctx, "LEAD");
  columns.push(...extra.columns);
  return {
    columns,
    rows: mapRows(
      iterateInBatches((skip, take) =>
        listLeads(ctx, { ...filters, skip, take }),
      ),
      (l) => ({
        ...extra.cells(l),
        id: l.id,
        company: l.company?.name ?? "",
        contact: l.contact
          ? [l.contact.firstName, l.contact.lastName].filter(Boolean).join(" ")
          : "",
        contactEmail: l.contact?.email ?? "",
        contactPhone: l.contact?.phone ?? "",
        leadStatus: l.leadStatus?.name ?? "",
        leadSource: l.leadSource?.name ?? "",
        temperature: l.temperature,
        serviceInterest: l.serviceInterestId
          ? (serviceName.get(l.serviceInterestId) ?? "")
          : "",
        owner: ownerOf(l.ownerMembershipId),
        nextFollowUpAt: dateOrEmpty(l.nextFollowUpAt),
        convertedAt: dateOrEmpty(l.convertedAt),
        notes: l.notes ?? "",
        createdAt: dateOrEmpty(l.createdAt),
      }),
    ),
  };
}

export async function exportDealsCsv(
  ctx: AuthContext,
  filters: ListDealsFilters = {},
): Promise<CsvExport> {
  requirePermission(ctx, "deals.export");

  const [total, ownerOf] = await Promise.all([
    countDeals(ctx, filters),
    membershipLookup(ctx.organizationId),
  ]);

  await assertBulkExportAllowed(ctx, total);
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "deals.exported",
    entityType: "Deal",
    metadata: { count: total },
  });

  const columns = [
    "id",
    "company",
    "primaryContact",
    "service",
    "pipelineStage",
    "value",
    "valueMasked",
    "currency",
    "outcome",
    "lostReason",
    "expectedCloseDate",
    "owner",
    "createdAt",
  ];
  const extra = await exportExtras(ctx, "DEAL");
  columns.push(...extra.columns);
  return {
    columns,
    rows: mapRows(
      iterateInBatches((skip, take) =>
        listDeals(ctx, { ...filters, skip, take }),
      ),
      (d) => ({
        ...extra.cells(d),
        id: d.id,
        company: d.company?.name ?? "",
        primaryContact: d.primaryContact
          ? [d.primaryContact.firstName, d.primaryContact.lastName]
              .filter(Boolean)
              .join(" ")
          : "",
        service: d.service?.name ?? "",
        pipelineStage: d.pipelineStage?.name ?? "",
        // valueMasked rows never reveal the real figure (FIG-596 AC: honor deals.view.value masking on export).
        value: d.value === null ? "" : d.value.toString(),
        valueMasked: d.valueMasked,
        currency: d.currency,
        outcome: d.outcome,
        lostReason: d.lostReason?.name ?? "",
        expectedCloseDate: dateOrEmpty(d.expectedCloseDate),
        owner: ownerOf(d.ownerMembershipId),
        createdAt: dateOrEmpty(d.createdAt),
      }),
    ),
  };
}

/**
 * Reports export is deliberately not streamed row-by-row like the entity
 * exports above: the data is a handful of small aggregate tables (lead
 * volume by source, pipeline value by stage, etc.), not a per-record
 * dataset whose size scales with the organization, so building the whole
 * CSV string in memory is not the "large file" concern FIG-596 is about.
 */
export async function exportReportsCsv(
  ctx: AuthContext,
  filters: OrganizationMetricsFilters = {},
): Promise<string> {
  requirePermission(ctx, "export.bulk");
  const [metrics, referenceData] = await Promise.all([
    getOrganizationMetrics(ctx, filters),
    getFormReferenceData(ctx),
  ]);
  const { sourceName, stageName, serviceName } = buildReportNameResolvers(referenceData);

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "reports.exported",
    entityType: "Report",
    metadata: { dateFrom: metrics.dateFrom, dateTo: metrics.dateTo },
  });

  const sections: string[] = [];
  const section = (title: string, rows: Record<string, unknown>[]) => {
    sections.push(title);
    if (rows.length === 0) {
      sections.push("(no data)\n");
      return;
    }
    sections.push(stringify(rows, { header: true }));
  };

  section(
    "Lead volume by source",
    metrics.leadVolumeBySource.map((r) => ({
      source: sourceName(r.leadSourceId),
      count: r._count._all,
    })),
  );
  section("Lead conversion", [metrics.leadConversion]);
  section("Deal outcomes", [
    {
      won: metrics.dealOutcomes.won.count,
      wonValue: metrics.dealOutcomes.won.value?.toString() ?? "",
      lost: metrics.dealOutcomes.lost.count,
    },
  ]);
  section(
    "Pipeline value by stage",
    metrics.pipelineByStage.map((r) => ({
      stage: stageName(r.pipelineStageId),
      count: r._count._all,
      value: r._sum.value?.toString() ?? "",
    })),
  );
  section(
    "Sales by service",
    metrics.salesByService.map((r) => ({
      service: serviceName(r.serviceId),
      count: r._count._all,
      value: r._sum.value?.toString() ?? "",
    })),
  );
  section(
    "Follow-up status",
    metrics.followUpBreakdown.map((r) => ({
      status: r.status,
      count: r._count._all,
    })),
  );

  return sections.join("\n");
}

/**
 * CSV of the customer reports (FIG-793): customers by segment, won by
 * salesperson, and upcoming renewals. Every figure comes from the same
 * service functions as the screens, so permissions and value masking match.
 */
export async function exportCustomerReportsCsv(
  ctx: AuthContext,
  filters: {
    dormantAfterDays?: number;
    withinDays?: number;
    dateFrom?: string;
    dateTo?: string;
    period?: "total" | "month";
  } = {},
): Promise<string> {
  requirePermission(ctx, "export.bulk");

  const pageAll = async <P extends { items: unknown[]; pageCount: number }>(
    fetchPage: (page: number) => Promise<P>,
  ) => {
    const first = await fetchPage(1);
    const items = [...first.items] as P["items"];
    for (let p = 2; p <= first.pageCount; p++) items.push(...(await fetchPage(p)).items);
    return { first, items };
  };

  const [customers, renewals, sales] = await Promise.all([
    pageAll((page) =>
      getCustomerReport(ctx, { dormantAfterDays: filters.dormantAfterDays }, { page, pageSize: 100 }),
    ),
    pageAll((page) =>
      getUpcomingRenewals(ctx, { withinDays: filters.withinDays }, { page, pageSize: 100 }),
    ),
    getSalesBySalesperson(ctx, filters),
  ]);

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "reports.exported",
    entityType: "Report",
    metadata: { report: "customer-reports" },
  });

  const sections: string[] = [];
  const section = (title: string, rows: Record<string, unknown>[]) => {
    sections.push(title);
    sections.push(rows.length === 0 ? "(no data)\n" : stringify(rows, { header: true }));
  };
  const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

  section("Customer summary", [
    { dormancyDays: customers.first.dormancyDays, ...customers.first.summary },
  ]);
  section(
    "Customers",
    customers.items.map((r) => ({
      company: r.companyName,
      segment: r.segment,
      repeat: r.repeat ? "yes" : "no",
      wonCount: r.wonCount,
      wonValue: r.wonValue?.toString() ?? "",
      lastWonAt: day(r.lastWonAt),
      activeServices: r.activeServices,
    })),
  );
  section(
    "Won by salesperson",
    sales.rows.map((r) => ({
      salesperson: r.ownerName ?? "",
      month: r.month ?? "",
      wonCount: r.wonCount,
      wonValue: r.wonValue?.toString() ?? "",
    })),
  );
  section(
    "Upcoming renewals",
    renewals.items.map((r) => ({
      company: r.companyName,
      service: r.serviceName,
      endDate: r.endDate,
      daysLeft: r.daysLeft,
      lapsed: r.lapsed ? "yes" : "no",
    })),
  );

  return sections.join("\n");
}
