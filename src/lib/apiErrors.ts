import { randomUUID } from "crypto";
import {
  ForbiddenError,
  NoActiveMembershipError,
  NotFoundError,
  RateLimitedError,
  UnauthorizedError,
  ValidationError,
} from "../auth/errors";
import { adminDb } from "../db/adminClient";
import { FeatureUnavailableError, RELEASE_LABEL } from "./featureFlags";
import { logger } from "./logger";

/**
 * The one error shape every API route returns (FIG-1014, B0.06):
 *
 *   { error, code, message, fieldErrors, requestId, denial? }
 *
 * `error` (same text as `message`) and `issues` (same data as `fieldErrors`)
 * are the pre-B0.06 fields; they stay so every existing consumer keeps
 * working, and new code should read `code`, `message` and `fieldErrors`.
 */
export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "CSRF_REJECTED"
  | "NO_ACTIVE_MEMBERSHIP"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "RATE_LIMITED"
  | "FEATURE_UNAVAILABLE"
  | "IDEMPOTENCY_KEY_REUSED"
  | "IDEMPOTENCY_IN_PROGRESS"
  | "INTERNAL_ERROR";

export interface FieldError {
  path: string;
  message: string;
}

/** Feeds the explained no-access screen (S4): who asked, who could, and who to ask. */
export interface Denial {
  role: string | null;
  requiredRoles: string[];
  whoToAsk: string;
}

/** Explains a "not available" response (B0.07): which feature, why, and when it arrives. */
export interface FeatureNotice {
  key: string;
  reason: "release" | "toggle";
  /** Release label such as "V1.1" when the feature has not shipped yet, else null. */
  availableIn: string | null;
}

export interface ApiErrorBody {
  error: string;
  code: ApiErrorCode;
  message: string;
  fieldErrors: FieldError[];
  /** Same as `fieldErrors`; kept for consumers written before the envelope. */
  issues?: FieldError[];
  requestId: string;
  denial?: Denial;
  feature?: FeatureNotice;
}

/** An API error that is neither a typed auth error nor a validation failure (for example a replayed idempotency key). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const WHO_TO_ASK = "your organisation's Management users";

const roleNameCache = new Map<string, string>();
const rolesForKeyCache = new Map<string, string[]>();

async function roleName(roleKey: string): Promise<string> {
  const cached = roleNameCache.get(roleKey);
  if (cached) return cached;
  const role = await adminDb.role.findUnique({ where: { key: roleKey } });
  const name = role?.name ?? roleKey;
  roleNameCache.set(roleKey, name);
  return name;
}

async function rolesHolding(permissionKey: string): Promise<string[]> {
  const cached = rolesForKeyCache.get(permissionKey);
  if (cached) return cached;
  const roles = await adminDb.role.findMany({
    where: { rolePermissions: { some: { permission: { key: permissionKey } } } },
    orderBy: { name: "asc" },
  });
  const names = roles.map((r) => r.name);
  rolesForKeyCache.set(permissionKey, names);
  return names;
}

/**
 * What a 403 tells the caller: their own role, the roles that could do this,
 * and who to ask. Role/permission data is global and static, so lookups are
 * cached for the life of the process.
 */
export async function describeDenial(err: ForbiddenError): Promise<Denial> {
  const keys = err.detail.permissionKeys ?? [err.permissionKey];
  const lists = await Promise.all(keys.map(rolesHolding));
  const requiredRoles = [...new Set(lists.flat())].sort();
  return {
    role: err.detail.roleKey ? await roleName(err.detail.roleKey) : null,
    requiredRoles,
    whoToAsk: WHO_TO_ASK,
  };
}

/** Test hook: clears the role lookups cached by `describeDenial`. */
export function resetDenialCache() {
  roleNameCache.clear();
  rolesForKeyCache.clear();
}

export function newRequestId(incoming?: string | null): string {
  const clean = incoming?.trim();
  // Accept a caller-supplied id only when it is short and safe to echo into logs and headers.
  return clean && /^[A-Za-z0-9._:-]{8,128}$/.test(clean) ? clean : randomUUID();
}

/** The status and body for any thrown value; unknown errors become a logged 500 with no detail leaked. */
export async function buildErrorResponse(
  err: unknown,
  requestId: string,
): Promise<{ status: number; body: ApiErrorBody }> {
  const make = (
    status: number,
    code: ApiErrorCode,
    message: string,
    extra: Partial<ApiErrorBody> = {},
  ) => ({
    status,
    body: {
      error: message,
      code,
      message,
      fieldErrors: [],
      requestId,
      ...extra,
    } satisfies ApiErrorBody,
  });

  if (err instanceof UnauthorizedError) return make(401, "UNAUTHORIZED", err.message);
  if (err instanceof ForbiddenError) {
    let denial: Denial | undefined;
    try {
      denial = await describeDenial(err);
    } catch (lookupErr) {
      logger.error({ err: lookupErr, requestId }, "Could not build denial detail");
    }
    return make(403, "FORBIDDEN", err.message, denial ? { denial } : {});
  }
  if (err instanceof NoActiveMembershipError) {
    return make(403, "NO_ACTIVE_MEMBERSHIP", err.message, {
      denial: { role: null, requiredRoles: [], whoToAsk: WHO_TO_ASK },
    });
  }
  if (err instanceof FeatureUnavailableError) {
    const who = err.reason === "toggle" ? ` Ask ${WHO_TO_ASK} to turn it on.` : "";
    return make(403, "FEATURE_UNAVAILABLE", err.message + who, {
      feature: {
        key: err.feature,
        reason: err.reason,
        availableIn: err.availableIn ? RELEASE_LABEL[err.availableIn] : null,
      },
    });
  }
  if (err instanceof NotFoundError) return make(404, "NOT_FOUND", err.message);
  if (err instanceof ValidationError) {
    const fieldErrors = err.issues ?? [];
    return make(400, "VALIDATION_FAILED", err.message, {
      fieldErrors,
      ...(err.issues ? { issues: err.issues } : {}),
    });
  }
  if (err instanceof RateLimitedError) return make(429, "RATE_LIMITED", err.message);
  if (err instanceof ApiError) return make(err.status, err.code, err.message);

  logger.error({ err, requestId }, "Unhandled route error");
  return make(500, "INTERNAL_ERROR", "Internal server error.");
}
