import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { ValidationError } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import { buildPage, resolvePaging, type PageRequest } from "../lib/pagination";
import {
  countCompanies as countCompanyRecords,
  listCompanies as listCompanyRecords,
  type ListCompaniesFilters,
} from "../repositories/companies";
import {
  countContacts as countContactRecords,
  listContacts as listContactRecords,
  type ListContactsFilters,
} from "../repositories/contacts";

/**
 * The company and contact lists the design draws with tabs and quality filters (FIG-1056, B3.10, design C1 and C3),
 * built on the same repositories, paging standard and masking as the plain lists, so a row, a count and an export can
 * never disagree about what matches.
 *
 *   Companies: tabs All (archived excluded), Dormant (a subset of All) and Archived; filters lifecycle, service, owner
 *              and tag. Each tab's count is what that tab would list under the same filters.
 *   Contacts:  filters standalone (no company), missing email, missing phone, tag, owner, company; counts for each.
 *
 * Nothing on either list is a deal value or a payment; an export built from these filters carries the same columns as
 * the ordinary export and is subject to the same export permission and bulk-export rule.
 */

/** A copy of an object without one key. */
function withoutKey<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

export const COMPANY_TABS = ["ALL", "DORMANT", "ARCHIVED"] as const;
export type CompanyTab = (typeof COMPANY_TABS)[number];
export const DORMANT_STATE_KEY = "DORMANT_CUSTOMER";

export interface CompanyDirectoryFilters extends Omit<ListCompaniesFilters, "take" | "skip" | "archivedOnly" | "includeArchived" | "lifecycleKey" | "lifecycleStateId"> {
  tab?: string;
  /** A lifecycle state key (`ACTIVE_CUSTOMER`) or id. */
  lifecycle?: string;
}

async function resolveLifecycle(organizationId: string, value: string | undefined): Promise<{ lifecycleKey?: string; lifecycleStateId?: string }> {
  if (!value) return {};
  const state = await adminDb.customerLifecycleState.findFirst({ where: { organizationId, OR: [{ key: value }, { id: value }] }, select: { id: true, key: true } });
  if (!state) throw new ValidationError(`Unknown lifecycle state "${value}".`, [{ path: "lifecycle", message: "Use a state key such as ACTIVE_CUSTOMER, or its id." }]);
  return { lifecycleStateId: state.id };
}

function companyFiltersFor(base: ListCompaniesFilters, tab: CompanyTab): ListCompaniesFilters {
  if (tab === "ARCHIVED") return { ...base, archivedOnly: true };
  if (tab === "DORMANT") return { ...base, lifecycleKey: DORMANT_STATE_KEY };
  return base;
}

export async function listCompanyDirectory(ctx: AuthContext, filters: CompanyDirectoryFilters = {}, request: PageRequest = {}) {
  requirePermission(ctx, "companies.view");
  const tab = (filters.tab ?? "ALL") as CompanyTab;
  if (!(COMPANY_TABS as readonly string[]).includes(tab)) {
    throw new ValidationError(`Unknown tab "${tab}".`, [{ path: "tab", message: `Use one of ${COMPANY_TABS.join(", ")}.` }]);
  }
  const { lifecycle, ...rest } = withoutKey(filters, "tab");
  const base: ListCompaniesFilters = { ...rest, ...(await resolveLifecycle(ctx.organizationId, lifecycle)) };
  const paging = resolvePaging(request);
  const active = companyFiltersFor(base, tab);
  const [items, total, all, dormant, archived] = await Promise.all([
    listCompanyRecords(ctx.organizationId, { ...active, take: paging.take, skip: paging.skip }),
    countCompanyRecords(ctx.organizationId, active),
    countCompanyRecords(ctx.organizationId, companyFiltersFor(base, "ALL")),
    countCompanyRecords(ctx.organizationId, companyFiltersFor(base, "DORMANT")),
    countCompanyRecords(ctx.organizationId, companyFiltersFor(base, "ARCHIVED")),
  ]);
  return { ...buildPage(items, total, paging), tab, tabCounts: { ALL: all, DORMANT: dormant, ARCHIVED: archived } };
}

/** The filters an export or a count for a company tab uses, so they match the list exactly. */
export async function companyFiltersForTab(ctx: AuthContext, filters: CompanyDirectoryFilters = {}): Promise<ListCompaniesFilters> {
  const tab = (filters.tab ?? "ALL") as CompanyTab;
  if (!(COMPANY_TABS as readonly string[]).includes(tab)) {
    throw new ValidationError(`Unknown tab "${tab}".`, [{ path: "tab", message: `Use one of ${COMPANY_TABS.join(", ")}.` }]);
  }
  const { lifecycle, ...rest } = withoutKey(filters, "tab");
  return companyFiltersFor({ ...rest, ...(await resolveLifecycle(ctx.organizationId, lifecycle)) }, tab);
}

export interface ContactDirectoryFilters extends Omit<ListContactsFilters, "take" | "skip" | "archivedOnly" | "includeArchived"> {
  /** Show the archived tab instead of the active contacts. */
  archived?: boolean;
}

export async function listContactDirectory(ctx: AuthContext, filters: ContactDirectoryFilters = {}, request: PageRequest = {}) {
  requirePermission(ctx, "contacts.view");
  const { archived, ...base } = filters;
  const paging = resolvePaging(request);
  const active: ListContactsFilters = archived ? { ...base, archivedOnly: true } : base;
  // Each quality count asks "how many would this filter show", under the other filters but not its own.
  const others = withoutKey(withoutKey(withoutKey(base, "standalone"), "missingEmail"), "missingPhone");
  const [items, total, all, standalone, missingEmail, missingPhone, archivedCount] = await Promise.all([
    listContactRecords(ctx.organizationId, { ...active, take: paging.take, skip: paging.skip }),
    countContactRecords(ctx.organizationId, active),
    countContactRecords(ctx.organizationId, others),
    countContactRecords(ctx.organizationId, { ...others, standalone: true }),
    countContactRecords(ctx.organizationId, { ...others, missingEmail: true }),
    countContactRecords(ctx.organizationId, { ...others, missingPhone: true }),
    countContactRecords(ctx.organizationId, { ...others, archivedOnly: true }),
  ]);
  return { ...buildPage(items, total, paging), counts: { all, standalone, missingEmail, missingPhone, archived: archivedCount } };
}

export function contactFiltersForExport(filters: ContactDirectoryFilters = {}): ListContactsFilters {
  const { archived, ...base } = filters;
  return archived ? { ...base, archivedOnly: true } : base;
}
