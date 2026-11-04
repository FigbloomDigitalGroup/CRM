/**
 * Saved views, the pure rules (FIG-1148, B6.16). A view stores how a list is set up (filters, sort, columns), never records,
 * so sharing one cannot hand over data: opening it runs the viewer's own list query with the viewer's own permissions.
 * What a view can still leak is its own set-up (a filter on deal value tells you something about values), so parts that
 * need a permission the viewer lacks are removed for that viewer (`restrictedKeyPermission`).
 */

export const VIEW_ENTITIES = ["leads", "deals", "companies", "contacts", "tasks"] as const;
export type ViewEntity = (typeof VIEW_ENTITIES)[number];
export const VIEW_SCOPES = ["PERSONAL", "SHARED"] as const;
export type ViewScope = (typeof VIEW_SCOPES)[number];

/** A role may open a list (and so a view of it) with any one of these keys. */
export const ENTITY_OPEN_KEYS: Record<ViewEntity, readonly string[]> = {
  leads: ["leads.view.all", "leads.view.own", "leads.view.shared"],
  deals: ["deals.view.all", "deals.view.own", "deals.view.won"],
  companies: ["companies.view"],
  contacts: ["contacts.view"],
  tasks: ["tasks.view.all", "tasks.view.own"],
};

export const MAX_NAME = 40;
export const MAX_VIEWS_PER_PERSON = 50;
const MAX_FILTER_KEYS = 30;
const MAX_JSON_CHARS = 4000;
const MAX_COLUMNS = 40;
const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,39}$/;

export function isViewEntity(value: string): value is ViewEntity {
  return (VIEW_ENTITIES as readonly string[]).includes(value);
}

export function mayOpenEntity(entity: ViewEntity, permissionKeys: readonly string[]): boolean {
  return ENTITY_OPEN_KEYS[entity].some((k) => permissionKeys.includes(k));
}

const COMMON_FILTERS = ["q", "tab", "tagId", "ownerMembershipId", "owner", "includeArchived", "archivedOnly"];
/** What each list lets a view filter, sort and show: the keys of that list's own endpoint and screen. Anything else is refused. */
export const VIEW_FIELD_ALLOW: Record<ViewEntity, { filters: readonly string[]; sorts: readonly string[]; columns: readonly string[] }> = {
  leads: {
    filters: [...COMMON_FILTERS, "leadStatusId", "leadSourceId", "temperature", "temp", "status", "source"],
    sorts: ["createdAt", "updatedAt", "temperature", "nextFollowUpAt", "name", "status", "source", "owner"],
    columns: ["name", "company", "contact", "email", "phone", "status", "temperature", "source", "owner", "next", "nextFollowUpAt", "score", "tags", "service", "createdAt", "updatedAt"],
  },
  deals: {
    filters: [...COMMON_FILTERS, "pipelineStageId", "stage", "outcome", "companyId", "stalled", "closeDatePassed", "valueMin", "valueMax", "marginMin", "marginMax"],
    sorts: ["createdAt", "updatedAt", "name", "title", "stage", "closeDate", "expectedCloseDate", "company", "owner", "value", "margin"],
    columns: ["name", "title", "company", "contact", "stage", "owner", "closeDate", "expectedCloseDate", "probability", "tags", "value", "margin", "createdAt", "updatedAt"],
  },
  companies: {
    filters: [...COMMON_FILTERS, "industry", "type", "tier"],
    sorts: ["createdAt", "updatedAt", "name", "owner", "industry"],
    columns: ["name", "industry", "type", "tier", "owner", "contacts", "deals", "tags", "createdAt", "updatedAt", "lastContactedAt"],
  },
  contacts: {
    filters: [...COMMON_FILTERS, "companyId", "company"],
    sorts: ["createdAt", "updatedAt", "name", "company", "owner", "lastContactedAt"],
    columns: ["name", "company", "email", "phone", "jobTitle", "owner", "tags", "createdAt", "updatedAt", "lastContactedAt"],
  },
  tasks: {
    filters: [...COMMON_FILTERS, "status", "priority", "companyId", "contactId", "leadId", "dealId", "overdueOnly", "assigneeMembershipId", "assignee", "dueFrom", "dueTo"],
    sorts: ["createdAt", "updatedAt", "dueAt", "title", "priority", "status", "assignee"],
    columns: ["title", "dueAt", "priority", "status", "assignee", "owner", "linked", "company", "createdAt", "updatedAt"],
  },
};

/** The first filter, sort or column name this list does not offer (an unknown name is refused, not passed through). */
export function firstUnknownField(entity: ViewEntity, parts: Partial<ViewParts>): { path: string; field: string } | null {
  const allow = VIEW_FIELD_ALLOW[entity];
  for (const k of Object.keys(parts.filters ?? {})) if (!allow.filters.includes(k)) return { path: `filters.${k}`, field: k };
  if (parts.sort && !allow.sorts.includes(parts.sort.field)) return { path: "sort", field: parts.sort.field };
  for (const c of parts.columns ?? []) if (!allow.columns.includes(c)) return { path: "columns", field: c };
  return null;
}

/** The permission a filter, sort or column key needs, or null when anyone who can open the list may use it. */
export function restrictedKeyPermission(key: string): string | null {
  const k = key.toLowerCase();
  if (/margin|cost/.test(k)) return "deals.margin";
  if (/payment|invoice|balance|outstanding/.test(k)) return "finance.view.payments";
  if (/value|amount|revenue|worth/.test(k)) return "deals.view.value";
  return null;
}

export type FilterValue = string | number | boolean | null | (string | number | boolean)[];
export interface ViewSort {
  field: string;
  direction: "asc" | "desc";
}
export interface ViewParts {
  filters: Record<string, FilterValue>;
  sort: ViewSort | null;
  columns: string[] | null;
}

export class ViewPartsError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(message);
  }
}

const isPrimitive = (v: unknown): v is string | number | boolean => ["string", "number", "boolean"].includes(typeof v);

/** Checks the shape and size of what a client sends. Throws `ViewPartsError` naming the field. */
export function parseViewParts(input: { filters?: unknown; sort?: unknown; columns?: unknown }): Partial<ViewParts> {
  const out: Partial<ViewParts> = {};
  if (input.filters !== undefined) {
    if (typeof input.filters !== "object" || input.filters === null || Array.isArray(input.filters)) throw new ViewPartsError("filters must be an object.", "filters");
    const entries = Object.entries(input.filters as Record<string, unknown>);
    if (entries.length > MAX_FILTER_KEYS) throw new ViewPartsError(`A view holds at most ${MAX_FILTER_KEYS} filters.`, "filters");
    const filters: Record<string, FilterValue> = {};
    for (const [key, value] of entries) {
      if (!KEY_PATTERN.test(key)) throw new ViewPartsError(`"${key.slice(0, 40)}" is not a valid filter name.`, "filters");
      if (value === null || isPrimitive(value)) filters[key] = value as FilterValue;
      else if (Array.isArray(value) && value.length <= 50 && value.every(isPrimitive)) filters[key] = value as FilterValue;
      else throw new ViewPartsError("A filter value is text, a number, a yes/no, or a short list of those.", `filters.${key}`);
    }
    out.filters = filters;
  }
  if (input.sort !== undefined) {
    if (input.sort === null) out.sort = null;
    else {
      const s = input.sort as { field?: unknown; direction?: unknown };
      if (typeof s !== "object" || typeof s.field !== "string" || !KEY_PATTERN.test(s.field) || (s.direction !== "asc" && s.direction !== "desc")) {
        throw new ViewPartsError("sort is { field, direction: asc | desc }.", "sort");
      }
      out.sort = { field: s.field, direction: s.direction };
    }
  }
  if (input.columns !== undefined) {
    if (input.columns === null) out.columns = null;
    else if (!Array.isArray(input.columns) || input.columns.length > MAX_COLUMNS || !input.columns.every((c) => typeof c === "string" && KEY_PATTERN.test(c))) {
      throw new ViewPartsError(`columns is a list of at most ${MAX_COLUMNS} column names.`, "columns");
    } else out.columns = [...new Set(input.columns as string[])];
  }
  if (JSON.stringify(out).length > MAX_JSON_CHARS) throw new ViewPartsError("This view is too large.", "filters");
  return out;
}

/** The parts of a view this viewer may see, and how many were removed because they need a permission the viewer lacks. */
export function sanitiseForViewer(parts: ViewParts, permissionKeys: readonly string[]): { parts: ViewParts; hiddenParts: number } {
  let hidden = 0;
  const allowed = (key: string) => {
    const need = restrictedKeyPermission(key);
    if (need && !permissionKeys.includes(need)) {
      hidden += 1;
      return false;
    }
    return true;
  };
  const filters = Object.fromEntries(Object.entries(parts.filters).filter(([k]) => allowed(k)));
  const sort = parts.sort && allowed(parts.sort.field) ? parts.sort : null;
  const columns = parts.columns ? parts.columns.filter(allowed) : null;
  return { parts: { filters, sort, columns }, hiddenParts: hidden };
}

/** The first part of a view the person themselves may not use, so nobody saves what they cannot see. */
export function firstForbiddenPart(parts: Partial<ViewParts>, permissionKeys: readonly string[]): { path: string; permission: string } | null {
  const check = (key: string, path: string) => {
    const need = restrictedKeyPermission(key);
    return need && !permissionKeys.includes(need) ? { path, permission: need } : null;
  };
  for (const k of Object.keys(parts.filters ?? {})) {
    const f = check(k, "filters");
    if (f) return f;
  }
  if (parts.sort) {
    const f = check(parts.sort.field, "sort");
    if (f) return f;
  }
  for (const c of parts.columns ?? []) {
    const f = check(c, "columns");
    if (f) return f;
  }
  return null;
}
