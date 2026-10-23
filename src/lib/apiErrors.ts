import { randomUUID } from "crypto";
import {
  AccountDeactivatedError,
  ArchivedReadOnlyError,
  AwaitingAccessError,
  ForbiddenError,
  NoActiveMembershipError,
  NotFoundError,
  RateLimitedError,
  ReassignmentRequiredError,
  SessionExpiredError,
  UnauthorizedError,
  ValidationError,
  type ReassignmentChecklistDetail,
  type RestoreHint,
} from "../auth/errors";
import { ownerRoleNamesForKeys } from "../auth/areaOwners";
import { adminDb } from "../db/adminClient";
import { loadFeatureConfig } from "./featureConfig";
import { FeatureUnavailableError, globalRelease, RELEASE_LABEL } from "./featureFlags";
import { logger } from "./logger";

/**
 * The one error shape every API route returns (FIG-1014, B0.06):
 *
 *   { error, code, message, fieldErrors, requestId, denial?, feature? }
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
  | "SESSION_EXPIRED"
  | "ACCOUNT_DEACTIVATED"
  | "AWAITING_ACCESS"
  | "REASSIGNMENT_REQUIRED"
  | "ARCHIVED_READ_ONLY"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "RATE_LIMITED"
  | "FEATURE_UNAVAILABLE"
  | "IDEMPOTENCY_KEY_REUSED"
  | "IDEMPOTENCY_IN_PROGRESS"
  | "FILE_UNAVAILABLE"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";

export interface FieldError {
  path: string;
  message: string;
  /** Stable reason code for the UI, when the rule has one (for example `FILE_TOO_LARGE`). */
  code?: string;
}

/**
 * Feeds the explained no-access screen (S4, FIG-1018): the caller's own role,
 * the roles that own the area, and the people to ask -- the names of the
 * organisation's active Management members (names only, never emails).
 */
export interface Denial {
  yourRole: string | null;
  ownerRoles: string[];
  whoToAsk: string[];
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
  /** On `SESSION_EXPIRED`: why it ended and the email to prefill on the sign-in screen (B1.04). */
  session?: { reason: "expired" | "revoked"; email: string | null };
  /** On `REASSIGNMENT_REQUIRED`: what the member still owns (B1.05). */
  reassignment?: ReassignmentChecklistDetail;
  /** On `ARCHIVED_READ_ONLY`: the record and whether the caller may restore it (B2.16). */
  restore?: RestoreHint;
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

/** How many Management names a denial lists; a long list is noise, and the rest are one click away. */
const MAX_WHO_TO_ASK = 5;

const roleNameCache = new Map<string, string>();

async function roleName(roleKey: string): Promise<string> {
  const cached = roleNameCache.get(roleKey);
  if (cached) return cached;
  const role = await adminDb.role.findUnique({ where: { key: roleKey } });
  const name = role?.name ?? roleKey;
  roleNameCache.set(roleKey, name);
  return name;
}

/** Names of the organisation's active Management members, for "who to ask". */
async function managementNames(organizationId: string | undefined): Promise<string[]> {
  if (!organizationId) return [];
  const members = await adminDb.membership.findMany({
    where: { organizationId, status: "ACTIVE", role: { key: "MANAGEMENT" } },
    include: { user: { select: { name: true } } },
  });
  return members
    .map((m) => m.user.name)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_WHO_TO_ASK);
}

/**
 * What a 403 tells the caller: their own role, the roles that own the area,
 * and who to ask. Role names are global and static, so they are cached for
 * the life of the process; the Management names are read per denial.
 */
export async function describeDenial(err: ForbiddenError): Promise<Denial> {
  const keys = err.detail.permissionKeys ?? [err.permissionKey];
  const config = err.detail.organizationId
    ? await loadFeatureConfig(err.detail.organizationId)
    : { release: globalRelease(), toggles: {} };
  return {
    yourRole: err.detail.roleKey ? await roleName(err.detail.roleKey) : null,
    ownerRoles: ownerRoleNamesForKeys(keys, config),
    whoToAsk: await managementNames(err.detail.organizationId),
  };
}

/** Test hook: clears the role lookups cached by `describeDenial`. */
export function resetDenialCache() {
  roleNameCache.clear();
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

  if (err instanceof SessionExpiredError) {
    return make(401, "SESSION_EXPIRED", err.message, {
      session: { reason: err.reason, email: err.email },
    });
  }
  if (err instanceof UnauthorizedError) return make(401, "UNAUTHORIZED", err.message);
  if (err instanceof AccountDeactivatedError) return make(403, "ACCOUNT_DEACTIVATED", err.message);
  if (err instanceof AwaitingAccessError) return make(403, "AWAITING_ACCESS", err.message);
  if (err instanceof ReassignmentRequiredError) {
    return make(409, "REASSIGNMENT_REQUIRED", err.message, { reassignment: err.checklist });
  }
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
      denial: { yourRole: null, ownerRoles: [], whoToAsk: [] },
    });
  }
  if (err instanceof FeatureUnavailableError) {
    const who =
      err.reason === "toggle" ? " Ask your organisation's Management users to turn it on." : "";
    return make(403, "FEATURE_UNAVAILABLE", err.message + who, {
      feature: {
        key: err.feature,
        reason: err.reason,
        availableIn: err.availableIn ? RELEASE_LABEL[err.availableIn] : null,
      },
    });
  }
  if (err instanceof NotFoundError) return make(404, "NOT_FOUND", err.message);
  if (err instanceof ArchivedReadOnlyError) {
    return make(409, "ARCHIVED_READ_ONLY", err.message, { restore: err.restore });
  }
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
