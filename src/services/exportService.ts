import { stringify } from "csv-stringify/sync";
import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { adminDb } from "../db/adminClient";
import { listOrganizationMemberships } from "../repositories/memberships";
import type { ListCompaniesFilters } from "../repositories/companies";
import type { ListContactsFilters } from "../repositories/contacts";
import type { ListLeadsFilters } from "../repositories/leads";
import type { ListDealsFilters } from "../repositories/deals";
import { recordAuditEvent } from "../repositories/auditEvents";
import { listCompanies } from "./companyService";
import { listContacts } from "./contactService";
import { listLeads } from "./leadService";
import { listDeals } from "./dealService";
import { getFormReferenceData } from "./referenceDataService";
import { buildReportNameResolvers } from "./reportingNames";
import {
  getOrganizationMetrics,
  type OrganizationMetricsFilters,
} from "./reportingService";

export interface CsvExport {
  columns: string[];
  rows: AsyncIterable<Record<string, unknown>>;
}

async function* toAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) yield item;
}

async function membershipLookup(organizationId: string) {
  const members = await listOrganizationMemberships(organizationId);
  const byId = new Map(members.map((m) => [m.membershipId, m.userEmail]));
  return (membershipId: string | null) =>
    membershipId ? (byId.get(membershipId) ?? membershipId) : "";
}

const dateOrEmpty = (d: Date | null | undefined) => (d ? d.toISOString() : "");

export async function exportCompaniesCsv(
  ctx: AuthContext,
  filters: ListCompaniesFilters = {},
): Promise<CsvExport> {
  requirePermission(ctx, "companies.export");

  const [companies, lifecycleStates, ownerOf] = await Promise.all([
    listCompanies(ctx, filters),
    adminDb.customerLifecycleState.findMany({
      where: { organizationId: ctx.organizationId },
      select: { id: true, name: true },
    }),
    membershipLookup(ctx.organizationId),
  ]);
  const lifecycleName = new Map(lifecycleStates.map((s) => [s.id, s.name]));

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "companies.exported",
    entityType: "Company",
    metadata: { count: companies.length },
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
  return {
    columns,
    rows: toAsyncIterable(
      companies.map((c) => ({
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
      })),
    ),
  };
}

export async function exportContactsCsv(
  ctx: AuthContext,
  filters: ListContactsFilters = {},
): Promise<CsvExport> {
  requirePermission(ctx, "contacts.export");

  const [contacts, ownerOf] = await Promise.all([
    listContacts(ctx, filters),
    membershipLookup(ctx.organizationId),
  ]);

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "contacts.exported",
    entityType: "Contact",
    metadata: { count: contacts.length },
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
  return {
    columns,
    rows: toAsyncIterable(
      contacts.map((c) => ({
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
      })),
    ),
  };
}

export async function exportLeadsCsv(
  ctx: AuthContext,
  filters: ListLeadsFilters = {},
): Promise<CsvExport> {
  requirePermission(ctx, "leads.export");

  const [leads, services, ownerOf] = await Promise.all([
    listLeads(ctx, filters),
    adminDb.service.findMany({
      where: { organizationId: ctx.organizationId },
      select: { id: true, name: true },
    }),
    membershipLookup(ctx.organizationId),
  ]);
  const serviceName = new Map(services.map((s) => [s.id, s.name]));

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "leads.exported",
    entityType: "Lead",
    metadata: { count: leads.length },
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
  return {
    columns,
    rows: toAsyncIterable(
      leads.map((l) => ({
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
      })),
    ),
  };
}

export async function exportDealsCsv(
  ctx: AuthContext,
  filters: ListDealsFilters = {},
): Promise<CsvExport> {
  requirePermission(ctx, "deals.export");

  const [deals, ownerOf] = await Promise.all([
    listDeals(ctx, filters),
    membershipLookup(ctx.organizationId),
  ]);

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "deals.exported",
    entityType: "Deal",
    metadata: { count: deals.length },
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
  return {
    columns,
    rows: toAsyncIterable(
      deals.map((d) => ({
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
      })),
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
