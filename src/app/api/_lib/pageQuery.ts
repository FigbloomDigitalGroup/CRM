import { z } from "zod";
import type { PageRequest } from "@/lib/pagination";

/**
 * `page` and `pageSize` query parameters shared by every list endpoint
 * (FIG-789). Spread into a route's own query schema:
 * `z.object({ q: ..., ...pageQueryShape })`. A non-numeric value is a 400;
 * a `pageSize` above the maximum is clamped, not rejected (see
 * `resolvePaging`).
 */
export const pageQueryShape = {
  /** Alias for `pageSize` (the B0.06 list standard names it `limit`); `pageSize` wins if both are sent. */
  limit: z
    .string()
    .regex(/^\d+$/, "limit must be a whole number.")
    .optional(),
  /** `nextCursor` from the previous response. */
  cursor: z.string().max(64).optional(),
  /** `field` ascending or `-field` descending; the allowed fields are per route. */
  sort: z.string().max(64).optional(),
  page: z
    .string()
    .regex(/^\d+$/, "page must be a whole number.")
    .optional(),
  pageSize: z
    .string()
    .regex(/^\d+$/, "pageSize must be a whole number.")
    .optional(),
};

export function toPageRequest(query: {
  page?: string;
  pageSize?: string;
  limit?: string;
  cursor?: string;
}): PageRequest {
  const size = query.pageSize ?? query.limit;
  return {
    page: query.page ? Number(query.page) : undefined,
    pageSize: size ? Number(size) : undefined,
    cursor: query.cursor,
  };
}
