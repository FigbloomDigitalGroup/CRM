/**
 * Shared error types for the authorization/service layer. Route handlers
 * map these to HTTP status codes (see src/app/api/_lib/handleRoute.ts);
 * service functions and tests can catch/assert on them directly.
 */
export class UnauthorizedError extends Error {
  constructor(message = "Authentication required.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * The caller held a session cookie, but the session has ended (B1.04): it ran
 * out of time, or it was revoked (signed out elsewhere, deactivated, password
 * reset). A subclass of `UnauthorizedError` so every existing "send them to
 * sign in" handler still works; the structured `session` block in the 401
 * lets the UI show the session-ended screen with the email already filled in.
 */
export class SessionExpiredError extends UnauthorizedError {
  constructor(
    readonly reason: "expired" | "revoked",
    readonly email: string | null,
  ) {
    super(
      reason === "expired"
        ? "Your session has expired. Please sign in again."
        : "You have been signed out. Please sign in again.",
    );
    this.name = "SessionExpiredError";
  }
}

/** The right password for an account whose access has been deactivated (B1.05). Only ever shown after the password proved who is asking. */
export class AccountDeactivatedError extends Error {
  constructor() {
    super("Your access has been deactivated. Ask your organisation's Management users to restore it.");
    this.name = "AccountDeactivatedError";
  }
}

/** A signed-in account with no active membership asked for something beyond sign-out and profile (B1.12). */
export class AwaitingAccessError extends Error {
  constructor() {
    super("Your account is waiting for access to an organisation.");
    this.name = "AwaitingAccessError";
  }
}

/** What a member still owns, by kind -- the checklist returned before deactivating or removing them (B1.05). */
export interface ReassignmentChecklistDetail {
  membershipId: string;
  userName: string;
  total: number;
  totals: Record<"tasks" | "leads" | "deals" | "companies" | "contacts" | "proposals", number>;
  items: Record<
    "tasks" | "leads" | "deals" | "companies" | "contacts" | "proposals",
    { id: string; label: string }[]
  >;
}

/** Removing a member who still owns records: blocked until they are reassigned (B1.05). */
export class ReassignmentRequiredError extends Error {
  constructor(readonly checklist: ReassignmentChecklistDetail) {
    super(
      `${checklist.userName} still owns ${checklist.total} record${checklist.total === 1 ? "" : "s"}. Reassign them before removing this member.`,
    );
    this.name = "ReassignmentRequiredError";
  }
}

export interface ForbiddenDetail {
  /** The caller's role key, so the response can say who is asking. */
  roleKey?: string;
  /** The caller's organization, so the response can name who to ask. */
  organizationId?: string;
  /** Permission keys any one of which would have allowed the action; defaults to the message's key. */
  permissionKeys?: string[];
}

export class ForbiddenError extends Error {
  readonly permissionKey: string;
  readonly detail: ForbiddenDetail;

  constructor(permissionKey: string, detail: ForbiddenDetail = {}) {
    super(`Missing required permission: ${permissionKey}`);
    this.name = "ForbiddenError";
    this.permissionKey = permissionKey;
    this.detail = detail;
  }
}

export class NoActiveMembershipError extends Error {
  constructor(organizationSlug: string) {
    super(`No active membership in organization "${organizationSlug}".`);
    this.name = "NoActiveMembershipError";
  }
}

export class NotFoundError extends Error {
  constructor(entityType: string, id: string) {
    super(`${entityType} ${id} not found.`);
    this.name = "NotFoundError";
  }
}

export interface ValidationIssue {
  /** Dot-joined field path, e.g. "newCompany.name"; "(root)" for a whole-body-level issue. */
  path: string;
  message: string;
  /**
   * A stable machine-readable reason (for example `FILE_TOO_LARGE`) the UI can
   * map to its own wording, on top of the human `message`.
   */
  code?: string;
}

export class ValidationError extends Error {
  /**
   * Populated when this came from a zod schema rejecting the request body
   * (FIG-605, `src/app/api/_lib/validation.ts`) -- undefined for a
   * hand-thrown business-rule check (e.g. "already archived"), which has
   * no natural field path. `handleRoute.ts` includes this in the response
   * alongside the existing top-level `error` string when present, never
   * instead of it, so every existing `body.error` consumer keeps working
   * unchanged.
   */
  issues?: ValidationIssue[];

  constructor(message: string, issues?: ValidationIssue[]) {
    super(message);
    this.name = "ValidationError";
    this.issues = issues;
  }
}

/** Maps to 429 (see handleRoute.ts) -- rate/abuse limiting (FIG-594). */
export class RateLimitedError extends Error {
  constructor(message = "Too many requests. Please try again later.") {
    super(message);
    this.name = "RateLimitedError";
  }
}

/** What the UI needs to offer "Restore" on an archived record (B2.16). */
export interface RestoreHint {
  entityType: string;
  entityId: string;
  /** Whether the caller may restore it themselves. */
  canRestore: boolean;
}

/**
 * A write to a record that is archived (FIG-1045, B2.16). Maps to 409 with the
 * code `ARCHIVED_READ_ONLY` and a restore hint. A subclass of `ValidationError`
 * so older callers that catch validation failures still see it.
 */
export class ArchivedReadOnlyError extends ValidationError {
  constructor(
    message: string,
    readonly restore: RestoreHint,
  ) {
    super(message);
    this.name = "ArchivedReadOnlyError";
  }
}
