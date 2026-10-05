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

export class ForbiddenError extends Error {
  constructor(permissionKey: string) {
    super(`Missing required permission: ${permissionKey}`);
    this.name = "ForbiddenError";
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
