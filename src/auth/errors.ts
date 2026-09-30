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

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** Maps to 429 (see handleRoute.ts) -- rate/abuse limiting (FIG-594). */
export class RateLimitedError extends Error {
  constructor(message = "Too many requests. Please try again later.") {
    super(message);
    this.name = "RateLimitedError";
  }
}
