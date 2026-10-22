import { ValidationError } from "../auth/errors";

/**
 * The sort and filter half of the standard list query (FIG-1014, B0.06);
 * paging lives in `pagination.ts`. A list route declares which fields it can
 * sort and filter on, and anything else is a 400 -- never silently ignored.
 *
 *   ?sort=createdAt          ascending
 *   ?sort=-createdAt         descending
 *   ?filter[status]=NEW      one filter per bracketed key
 *   ?q=text                  free-text search (route-defined)
 */
export interface SortSpec<F extends string> {
  field: F;
  direction: "asc" | "desc";
}

export function parseSort<F extends string>(
  raw: string | undefined,
  allowed: readonly F[],
): SortSpec<F> | undefined {
  if (!raw) return undefined;
  const direction = raw.startsWith("-") ? "desc" : "asc";
  const field = raw.replace(/^[-+]/, "");
  if (!(allowed as readonly string[]).includes(field)) {
    throw new ValidationError(
      `Cannot sort by "${field}". Allowed: ${allowed.join(", ")}.`,
      [{ path: "sort", message: `Allowed fields: ${allowed.join(", ")}.` }],
    );
  }
  return { field: field as F, direction };
}

/** Collects `filter[key]=value` pairs, rejecting keys the route does not support. */
export function parseFilters<K extends string>(
  searchParams: URLSearchParams,
  allowed: readonly K[],
): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  for (const [name, value] of searchParams) {
    const match = /^filter\[([^\]]+)\]$/.exec(name);
    if (!match) continue;
    const key = match[1]!;
    if (!(allowed as readonly string[]).includes(key)) {
      throw new ValidationError(
        `Cannot filter by "${key}". Allowed: ${allowed.join(", ")}.`,
        [{ path: name, message: `Allowed filters: ${allowed.join(", ")}.` }],
      );
    }
    out[key as K] = value;
  }
  return out;
}
