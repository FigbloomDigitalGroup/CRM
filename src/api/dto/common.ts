import { z } from "zod";
import type { AuthContext } from "../../auth/context";
import { resolveScope, type ScopedRecord } from "../../auth/permissions";

/**
 * Building blocks shared by every route's DTOs (FIG-1014, B0.06). The Zod
 * schemas under `src/api/dto/` are the source of truth for request and
 * response shapes: routes parse requests with them, the contract tests
 * check real responses against them, and the OpenAPI document
 * (`src/api/openapi.ts`) is generated from them.
 */

/** A `Date` after JSON serialization. */
export const isoDateTime = z.iso.datetime();
/** A Prisma `Decimal` after JSON serialization. */
export const decimalString = z.string().regex(/^-?\d+(\.\d+)?$/);

export const FieldErrorSchema = z.strictObject({
  path: z.string(),
  message: z.string(),
  code: z.string().optional(),
});

export const ErrorEnvelopeSchema = z.strictObject({
  error: z.string(),
  code: z.enum([
    "UNAUTHORIZED",
    "FORBIDDEN",
    "NO_ACTIVE_MEMBERSHIP",
    "SESSION_EXPIRED",
    "ACCOUNT_DEACTIVATED",
    "AWAITING_ACCESS",
    "REASSIGNMENT_REQUIRED",
    "NOT_FOUND",
    "VALIDATION_FAILED",
    "RATE_LIMITED",
    "FEATURE_UNAVAILABLE",
    "IDEMPOTENCY_KEY_REUSED",
    "IDEMPOTENCY_IN_PROGRESS",
    "FILE_UNAVAILABLE",
    "SERVICE_UNAVAILABLE",
    "INTERNAL_ERROR",
  ]),
  message: z.string(),
  fieldErrors: z.array(FieldErrorSchema),
  issues: z.array(FieldErrorSchema).optional(),
  requestId: z.string(),
  feature: z
    .strictObject({
      key: z.string(),
      reason: z.enum(["release", "toggle"]),
      availableIn: z.string().nullable(),
    })
    .optional(),
  denial: z
    .strictObject({
      yourRole: z.string().nullable(),
      ownerRoles: z.array(z.string()),
      whoToAsk: z.array(z.string()),
    })
    .optional(),
  session: z
    .strictObject({
      reason: z.enum(["expired", "revoked"]),
      email: z.string().nullable(),
    })
    .optional(),
  reassignment: z
    .strictObject({
      membershipId: z.string(),
      userName: z.string(),
      total: z.number().int(),
      totals: z.record(z.string(), z.number().int()),
      items: z.record(
        z.string(),
        z.array(z.strictObject({ id: z.string(), label: z.string() })),
      ),
    })
    .optional(),
});

/** The page envelope every list returns (see `src/lib/pagination.ts`). */
export function pageOf<T extends z.ZodType>(item: T) {
  return z.strictObject({
    items: z.array(item),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1).max(100),
    total: z.number().int().min(0),
    pageCount: z.number().int().min(1),
    nextCursor: z.string().nullable(),
  });
}

/**
 * What the UI needs to draw pills and banners without guessing:
 * `archived` (archived pill / read-only banner), `masked` (some value on
 * this record is hidden from the caller), `scope` (`own`: the caller sees
 * only their own records; `organisation`: they see the whole organisation
 * and may edit this record; `read-only`: they may view but not edit it) and
 * `provisional` (the access exists only because of a departure from the
 * seeded matrix, so the "Provisional" banner shows -- FIG-1019).
 */
export const RecordScopeSchema = z.enum(["own", "organisation", "read-only"]);
export const RecordMetaShape = {
  archived: z.boolean(),
  masked: z.boolean(),
  scope: RecordScopeSchema,
  provisional: z.boolean(),
};

/**
 * The scope pill and provisional flag for one record, from the single scope
 * resolver (`src/auth/permissions.ts`) -- the same answer the services use.
 */
export function recordAccess(
  ctx: AuthContext,
  resource: "leads" | "deals",
  record: ScopedRecord,
): { scope: z.infer<typeof RecordScopeSchema>; provisional: boolean } {
  const edit = resolveScope(ctx, resource, "edit", record);
  const scope = edit.scope === "none" ? "read-only" : edit.scope;
  return { scope, provisional: edit.provisional };
}

/** A related record included on a response: only the fields every consumer relies on are pinned. */
export function relation<S extends z.ZodRawShape>(shape: S) {
  return z.looseObject(shape);
}
