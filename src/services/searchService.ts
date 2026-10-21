import type { AuthContext } from "../auth/context";
import { hasPermission } from "../auth/context";
import { listCompanies } from "./companyService";
import { listContacts } from "./contactService";
import { listLeads } from "./leadService";
import { listDeals } from "./dealService";
import { listTasks } from "./taskService";

/** Per-group cap (FIG-787 AC: "capped per group") -- applied regardless of what a client asks for. */
const MAX_RESULTS_PER_GROUP = 8;
/** Below this, every group is cheap-but-useless noise (e.g. matching half the company list on a single letter). */
const MIN_QUERY_LENGTH = 2;

export interface SearchResultItem {
  id: string;
  label: string;
  sublabel: string | null;
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
  const canViewDeals =
    hasPermission(ctx, "deals.view.own") || hasPermission(ctx, "deals.view.all");
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
