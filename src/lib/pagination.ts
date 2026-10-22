/**
 * Offset paging shared by every list repository, service and API route
 * (FIG-789). One default and one hard maximum, so no caller can ask for an
 * unbounded page and exhaust the server.
 *
 * Offset (page number) rather than cursor paging because every list view
 * needs a total and "page N of M" controls, and the existing lists sort on
 * several columns. Every paged query adds `id` as a final sort key, so the
 * order is total and a row can never appear on two pages or on none.
 */
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export interface PageRequest {
  /** 1-based. Missing, zero, negative or non-integer values fall back to 1. */
  page?: number;
  /** Clamped to 1..MAX_PAGE_SIZE; missing falls back to DEFAULT_PAGE_SIZE. */
  pageSize?: number;
  /** A `nextCursor` from an earlier response; wins over `page` when valid. */
  cursor?: string;
}

export interface ResolvedPaging {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  /** Rows matching the filters across all pages. */
  total: number;
  /** At least 1, even when nothing matches. */
  pageCount: number;
  /** Opaque token for the next page (pass back as `cursor`), or null on the last page. */
  nextCursor: string | null;
}

/**
 * Cursors are opaque to clients. Today they wrap the next page number (the
 * V1 lists are offset-paged with a total); a keyset cursor can replace the
 * payload later without changing the contract (offline sync, B4.07).
 */
export function encodeCursor(page: number): string {
  return Buffer.from(`p:${page}`).toString("base64url");
}

export function decodeCursor(cursor: string | undefined): number | undefined {
  if (!cursor) return undefined;
  const match = /^p:(\d{1,9})$/.exec(Buffer.from(cursor, "base64url").toString());
  const page = match ? Number(match[1]) : NaN;
  return page >= 1 ? page : undefined;
}

function wholeNumber(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.floor(value)
    : undefined;
}

export function resolvePaging(request: PageRequest = {}): ResolvedPaging {
  const rawPage = decodeCursor(request.cursor) ?? wholeNumber(request.page);
  const rawSize = wholeNumber(request.pageSize);
  const page = rawPage && rawPage >= 1 ? rawPage : 1;
  const pageSize =
    rawSize && rawSize >= 1 ? Math.min(rawSize, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function buildPage<T>(
  items: T[],
  total: number,
  paging: ResolvedPaging,
): Page<T> {
  const pageCount = Math.max(1, Math.ceil(total / paging.pageSize));
  return {
    items,
    page: paging.page,
    pageSize: paging.pageSize,
    total,
    pageCount,
    nextCursor: paging.page < pageCount ? encodeCursor(paging.page + 1) : null,
  };
}

/**
 * Pages through a whole filtered set in fixed-size batches without loading
 * it all at once -- for CSV export, which must still cover every matching
 * row. `fetchBatch` receives (skip, take) and must use the same total
 * ordering the paged list does.
 */
export async function* iterateInBatches<T>(
  fetchBatch: (skip: number, take: number) => Promise<T[]>,
  batchSize: number = MAX_PAGE_SIZE * 5,
): AsyncGenerator<T> {
  let skip = 0;
  for (;;) {
    const batch = await fetchBatch(skip, batchSize);
    for (const item of batch) yield item;
    if (batch.length < batchSize) return;
    skip += batchSize;
  }
}
