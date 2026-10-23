import { canUseResource } from "../auth/permissions";
import type { AuthContext } from "../auth/context";
import { hasPermission } from "../auth/context";
import { ValidationError } from "../auth/errors";
import { phoneTail } from "../lib/matching";
import type { Page, PageRequest } from "../lib/pagination";
import { clearRecentSearches, listRecentSearches, phoneMatchIds, rememberSearch } from "../repositories/search";
import { listCompanies, listCompaniesPage } from "./companyService";
import { listContacts, listContactsPage } from "./contactService";
import { listLeads, listLeadsPage } from "./leadService";
import { listDeals, listDealsPage } from "./dealService";
import { listTasks, listTasksPage } from "./taskService";

/** Per-group cap (FIG-787 AC: "capped per group") -- applied regardless of what a client asks for. */
const MAX_RESULTS_PER_GROUP = 8;
/** Below this, every group is cheap-but-useless noise (e.g. matching half the company list on a single letter). */
const MIN_QUERY_LENGTH = 2;

export interface SearchResultItem {
  id: string;
  label: string;
  sublabel: string | null;
  /** Present in search v2: archived records show only when asked for, marked as such. */
  archived?: boolean;
}

export interface GlobalSearchResults {
  companies: SearchResultItem[];
  contacts: SearchResultItem[];
  leads: SearchResultItem[];
  deals: SearchResultItem[];
  tasks: SearchResultItem[];
}

const EMPTY_RESULTS: GlobalSearchResults = {
  companies: [],
  contacts: [],
  leads: [],
  deals: [],
  tasks: [],
};

function personName(
  person: { firstName: string; lastName: string | null } | null | undefined,
): string | null {
  if (!person) return null;
  return [person.firstName, person.lastName].filter(Boolean).join(" ");
}

/**
 * Powers the top-bar global search (FIG-787). Fans out to each entity's own
 * service function -- `companyService`/`contactService`/`leadService`/
 * `dealService`/`taskService` -- rather than querying repositories directly,
 * so tenant scoping, the leads/deals/tasks own-vs-all ownership split, and
 * deal-value masking are enforced exactly once, in their normal home, never
 * re-implemented here. A caller who lacks a group's view permission
 * entirely gets an empty array for that group instead of the whole search
 * failing closed.
 */
export async function globalSearch(
  ctx: AuthContext,
  query: string,
): Promise<GlobalSearchResults> {
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) {
    return EMPTY_RESULTS;
  }

  const canViewCompanies = hasPermission(ctx, "companies.view");
  const canViewContacts = hasPermission(ctx, "contacts.view");
  const canViewLeads =
    hasPermission(ctx, "leads.view.own") || hasPermission(ctx, "leads.view.all");
  const canViewDeals = canUseResource(ctx, "deals");
  const canViewTasks =
    hasPermission(ctx, "tasks.view.own") || hasPermission(ctx, "tasks.view.all");

  const [companies, contacts, leads, deals, tasks] = await Promise.all([
    canViewCompanies
      ? listCompanies(ctx, { query: trimmed, take: MAX_RESULTS_PER_GROUP })
      : Promise.resolve([]),
    canViewContacts
      ? listContacts(ctx, { query: trimmed, take: MAX_RESULTS_PER_GROUP })
      : Promise.resolve([]),
    canViewLeads
      ? listLeads(ctx, { query: trimmed, take: MAX_RESULTS_PER_GROUP })
      : Promise.resolve([]),
    canViewDeals
      ? listDeals(ctx, { query: trimmed, take: MAX_RESULTS_PER_GROUP })
      : Promise.resolve([]),
    canViewTasks
      ? listTasks(ctx, { query: trimmed, take: MAX_RESULTS_PER_GROUP })
      : Promise.resolve([]),
  ]);

  return {
    companies: companies.map((c) => ({
      id: c.id,
      label: c.name,
      sublabel: c.email ?? c.phone ?? null,
    })),
    contacts: contacts.map((c) => ({
      id: c.id,
      label: personName(c) ?? "Unnamed contact",
      sublabel: c.company?.name ?? c.email ?? c.phone ?? null,
    })),
    leads: leads.map((l) => ({
      id: l.id,
      label: l.company?.name ?? personName(l.contact) ?? "Unassigned lead",
      sublabel: personName(l.contact) ?? l.leadStatus?.name ?? null,
    })),
    deals: deals.map((d) => ({
      id: d.id,
      label: d.company?.name ?? "Deal",
      sublabel: personName(d.primaryContact) ?? d.pipelineStage?.name ?? null,
    })),
    tasks: tasks.map((t) => ({
      id: t.id,
      label: t.title,
      sublabel: t.dueAt ? `Due ${t.dueAt.toLocaleDateString()}` : t.status,
    })),
  };
}

// ---------------------------------------------------------------------------
// Search v2 (FIG-1041, B2.12)
// ---------------------------------------------------------------------------

export type SearchGroupType = "companies" | "contacts" | "leads" | "deals" | "tasks";
export const SEARCH_GROUP_TYPES: SearchGroupType[] = ["companies", "contacts", "leads", "deals", "tasks"];
export type ArchivedMode = "exclude" | "include" | "only";

export interface SearchRequest {
  q: string;
  /** Restrict to one group and page through it; without it every group returns its first page. */
  type?: SearchGroupType;
  archived?: ArchivedMode;
  paging?: PageRequest;
}

export interface SearchGroup extends Page<SearchResultItem> {
  type: SearchGroupType;
}

const GROUP_LABEL: Record<SearchGroupType, string> = {
  companies: "Companies",
  contacts: "Contacts",
  leads: "Leads",
  deals: "Deals",
  tasks: "Tasks",
};
const GROUP_PREVIEW_SIZE = 5;

function archiveFilter(mode: ArchivedMode) {
  return { includeArchived: mode === "include" || undefined, archivedOnly: mode === "only" || undefined };
}

/**
 * The groups this caller may search at all, with the explained reason for each
 * one they may not. Within a group, the list services still apply ownership
 * scope and value masking, so a result is something the caller could open from
 * that group's own list.
 */
function allowedGroups(ctx: AuthContext): { allowed: Set<SearchGroupType>; limited: SearchGroupType[] } {
  const allowed = new Set<SearchGroupType>();
  const limited: SearchGroupType[] = [];
  if (hasPermission(ctx, "companies.view")) allowed.add("companies");
  if (hasPermission(ctx, "contacts.view")) allowed.add("contacts");
  if (hasPermission(ctx, "leads.view.own") || hasPermission(ctx, "leads.view.all")) {
    allowed.add("leads");
    if (!hasPermission(ctx, "leads.view.all")) limited.push("leads");
  }
  if (canUseResource(ctx, "deals")) {
    allowed.add("deals");
    if (!hasPermission(ctx, "deals.view.all")) limited.push("deals");
  }
  if (hasPermission(ctx, "tasks.view.own") || hasPermission(ctx, "tasks.view.all")) {
    allowed.add("tasks");
    if (!hasPermission(ctx, "tasks.view.all")) limited.push("tasks");
  }
  return { allowed, limited };
}

/**
 * Global search v2: results grouped by type with a total per group, paged per
 * group, archived records left out unless asked for. `hidden` says plainly when
 * the caller's role keeps some results out (a group they cannot view, or
 * records that belong to others), without counting or naming anything they
 * cannot see. Phone numbers match across formats (+254, 0712, 712).
 */
export async function searchAll(ctx: AuthContext, request: SearchRequest) {
  const q = request.q.trim();
  const archived = request.archived ?? "exclude";
  const { allowed, limited } = allowedGroups(ctx);
  const hidden = {
    someResultsHidden: SEARCH_GROUP_TYPES.some((t) => !allowed.has(t)) || limited.length > 0,
    unavailableGroups: SEARCH_GROUP_TYPES.filter((t) => !allowed.has(t)).map((t) => ({
      type: t,
      reason: `Your role does not include ${GROUP_LABEL[t].toLowerCase()}. Ask a Management user if you need access.`,
    })),
    limitedToYours: limited,
  };
  if (q.length < MIN_QUERY_LENGTH) {
    return { query: q, tooShort: true, groups: [] as SearchGroup[], total: 0, hidden };
  }

  const tail = phoneTail(q);
  const phone = /^[+()\d\s.-]{7,}$/.test(q) && tail ? await phoneMatchIds(ctx.organizationId, tail) : null;
  const paging = request.type ? request.paging ?? {} : { pageSize: GROUP_PREVIEW_SIZE };
  const archive = archiveFilter(archived);
  const wanted = SEARCH_GROUP_TYPES.filter((t) => allowed.has(t) && (!request.type || request.type === t));

  const run: Record<SearchGroupType, () => Promise<Page<SearchResultItem>>> = {
    companies: async () => {
      const page = await listCompaniesPage(ctx, { query: q, matchIds: phone?.companyIds, ...archive }, paging);
      return mapPage(page, (c) => ({
        id: c.id,
        label: c.name,
        sublabel: c.email ?? c.phone ?? null,
        archived: c.archivedAt !== null,
      }));
    },
    contacts: async () => {
      const page = await listContactsPage(ctx, { query: q, matchIds: phone?.contactIds, ...archive }, paging);
      return mapPage(page, (c) => ({
        id: c.id,
        label: personName(c) ?? "Unnamed contact",
        sublabel: c.company?.name ?? c.email ?? c.phone ?? null,
        archived: c.archivedAt !== null,
      }));
    },
    leads: async () => {
      const page = await listLeadsPage(
        ctx,
        { query: q, matchContactIds: phone?.contactIds, matchCompanyIds: phone?.companyIds, ...archive },
        paging,
      );
      return mapPage(page, (l) => ({
        id: l.id,
        label: l.company?.name ?? personName(l.contact) ?? "Unassigned lead",
        sublabel: personName(l.contact) ?? l.leadStatus?.name ?? null,
        archived: l.archivedAt !== null,
      }));
    },
    deals: async () => {
      const page = await listDealsPage(ctx, { query: q, ...archive }, paging);
      return mapPage(page, (d) => ({
        id: d.id,
        label: d.company?.name ?? "Deal",
        sublabel: personName(d.primaryContact) ?? d.pipelineStage?.name ?? null,
        archived: d.archivedAt !== null,
      }));
    },
    tasks: async () => {
      const page = await listTasksPage(ctx, { query: q, ...archive }, paging);
      return mapPage(page, (t) => ({
        id: t.id,
        label: t.title,
        sublabel: t.dueAt ? `Due ${t.dueAt.toISOString().slice(0, 10)}` : t.status,
        archived: t.archivedAt !== null,
      }));
    },
  };

  const groups: SearchGroup[] = await Promise.all(
    wanted.map(async (type) => ({ type, ...(await run[type]()) })),
  );
  return { query: q, tooShort: false, groups, total: groups.reduce((n, g) => n + g.total, 0), hidden };
}

function mapPage<T>(page: Page<T>, fn: (row: T) => SearchResultItem): Page<SearchResultItem> {
  return { ...page, items: page.items.map(fn) };
}

export async function rememberRecentSearch(ctx: AuthContext, query: string) {
  const q = query.trim();
  if (q.length < MIN_QUERY_LENGTH || q.length > 100) {
    throw new ValidationError("A search to remember is 2 to 100 characters.", [{ path: "query", message: "Use 2 to 100 characters." }]);
  }
  await rememberSearch(ctx.organizationId, ctx.membershipId, q);
  return listRecentSearches(ctx.organizationId, ctx.membershipId);
}

export function recentSearches(ctx: AuthContext) {
  return listRecentSearches(ctx.organizationId, ctx.membershipId);
}

export function clearRecents(ctx: AuthContext) {
  return clearRecentSearches(ctx.organizationId, ctx.membershipId);
}
