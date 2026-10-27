import type { JsonSchema } from "./jsonSchema";

/**
 * The routes that are not under an organisation (G1.06): sign-in and account, the person's own sessions, the public website and
 * inbound-email endpoints, signed file links, the scheduler hooks and the health check. They use different credentials from the
 * organisation routes (none, an API key, a signed token, a shared secret), so each says which.
 *
 * Routes deliberately left out of the V1 contract, with the reason (a test keeps this list honest):
 *   /api/dev-session, /api/dev-sentry-test   development only; closed unless NODE_ENV=development and ALLOW_DEV_ACCOUNTS=true
 *   /api/platform/preferences                Platform Super Admin identity, V1.1 (and dev-only until then)
 *   /api/openapi.json                        serves this document, outside production only
 */
export const NOT_IN_V1_CONTRACT: Record<string, string> = {
  "/api/dev-session": "development only (CLAUDE.md rule 10)",
  "/api/dev-sentry-test": "development only",
  "/api/platform/preferences": "Platform Super Admin, V1.1",
  "/api/openapi.json": "serves this document, outside production only",
};

type Security = "none" | "sessionCookie" | "websiteApiKey" | "inboundEmailKey" | "signedToken" | "cronSecret";

export interface AccountOperation {
  method: "get" | "post" | "put" | "patch" | "delete";
  path: string;
  operationId: string;
  summary: string;
  tag: string;
  security: Security;
  body?: JsonSchema;
  /** `null` = no JSON body (a redirect, a file, or nothing). */
  response?: JsonSchema | null;
  errors?: number[];
  rateLimited?: boolean;
  note?: string;
}

const str = { type: "string" };
const obj = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({ type: "object", properties, required, additionalProperties: false });
const loose: JsonSchema = { type: "object", additionalProperties: true };
const okFlag: JsonSchema = { type: "object", properties: { ok: { type: "boolean" } }, additionalProperties: true };
const sessionList: JsonSchema = { type: "object", properties: { items: { type: "array", items: loose } }, required: ["items"], additionalProperties: true };

export const ACCOUNT_OPERATIONS: AccountOperation[] = [
  { method: "post", path: "/api/auth/login", operationId: "login", summary: "Sign in with email and password. Every failure is the same generic 401; repeated attempts are rate limited.", tag: "Auth", security: "none", body: obj({ email: str, password: str }, ["email", "password"]), response: loose, errors: [400, 401, 429], rateLimited: true, note: "Frozen page: this endpoint's behaviour does not change (CLAUDE.md rule 1)." },
  { method: "post", path: "/api/auth/signup", operationId: "signup", summary: "Create an account and sign in. Grants no organisation access on its own.", tag: "Auth", security: "none", body: obj({ name: str, email: str, password: str }, ["name", "email", "password"]), response: loose, errors: [400, 409, 429], rateLimited: true },
  { method: "post", path: "/api/auth/accept-invite", operationId: "acceptInvite", summary: "Accept an organisation invite with its token (and choose a password when the person has none yet).", tag: "Auth", security: "none", body: obj({ token: str, password: str }, ["token"]), response: loose, errors: [400, 401, 429] },
  { method: "post", path: "/api/auth/logout", operationId: "logout", summary: "End the current session and clear the cookie.", tag: "Auth", security: "sessionCookie", response: okFlag, errors: [] },
  { method: "post", path: "/api/auth/password-reset/request", operationId: "requestPasswordReset", summary: "Ask for a reset email. Always answers the same, whether or not the address has an account; rate limited.", tag: "Auth", security: "none", body: obj({ email: str }, ["email"]), response: okFlag, errors: [400, 429], rateLimited: true },
  { method: "post", path: "/api/auth/password-reset/confirm", operationId: "confirmPasswordReset", summary: "Set a new password with the emailed token.", tag: "Auth", security: "none", body: obj({ token: str, newPassword: str }, ["token", "newPassword"]), response: okFlag, errors: [400, 401, 429] },
  { method: "get", path: "/api/session", operationId: "getSession", summary: "The current session: who is signed in and when it expires.", tag: "Session", security: "sessionCookie", response: loose, errors: [401] },
  { method: "post", path: "/api/session/extend", operationId: "extendSession", summary: "Extend the session's idle expiry (up to the absolute limit).", tag: "Session", security: "sessionCookie", response: loose, errors: [401] },
  { method: "get", path: "/api/me/sessions", operationId: "listMySessions", summary: "Every device the person is signed in on, current one first.", tag: "Me", security: "sessionCookie", response: sessionList, errors: [401] },
  { method: "post", path: "/api/me/sessions/sign-out-others", operationId: "signOutOtherSessions", summary: "Sign out every other device.", tag: "Me", security: "sessionCookie", response: loose, errors: [401] },
  { method: "delete", path: "/api/me/sessions/{sessionId}", operationId: "revokeMySession", summary: "Sign out one device.", tag: "Me", security: "sessionCookie", response: loose, errors: [401, 404] },
  { method: "get", path: "/api/me/sign-in-events", operationId: "listMySignInEvents", summary: "The person's recent sign-ins and failed attempts.", tag: "Me", security: "sessionCookie", response: loose, errors: [401] },
  { method: "post", path: "/api/public/orgs/{orgSlug}/leads", operationId: "submitWebsiteLead", summary: "Website lead capture. Authenticated by the organisation's website key in `x-figbloom-api-key`; rate limited per IP and per key; optional origin allow-list, honeypot and captcha.", tag: "Public", security: "websiteApiKey", body: { type: "object", additionalProperties: true, description: "Contact and enquiry fields; see docs/DEPLOYMENT.md for the accepted set." }, response: loose, errors: [400, 401, 403, 413, 429], rateLimited: true },
  { method: "post", path: "/api/public/orgs/{orgSlug}/communications/inbound", operationId: "ingestInboundEmail", summary: "Inbound email (BCC-to-CRM) webhook. Authenticated by the organisation's inbound token in a header or the `token` query parameter.", tag: "Public", security: "inboundEmailKey", body: obj({ from: str, subject: str, text: str, messageId: str }, ["from"]), response: loose, errors: [400, 401, 429], rateLimited: true },
  { method: "get", path: "/api/storage/blob", operationId: "downloadSignedBlob", summary: "Download a file with a signed link (local storage driver only; the S3 driver links straight to the bucket).", tag: "Files", security: "signedToken", response: null, errors: [403, 404, 409] },
  { method: "put", path: "/api/storage/blob", operationId: "uploadSignedBlob", summary: "Upload a file's bytes with a signed upload link (local storage driver only).", tag: "Files", security: "signedToken", response: null, errors: [400, 403, 404] },
  { method: "get", path: "/api/cron/jobs", operationId: "runJobsGet", summary: "Scheduler entry point: queue the current slot of every scheduled job, recover crashed jobs, run due jobs. Bearer CRON_SECRET.", tag: "Operations", security: "cronSecret", response: loose, errors: [401] },
  { method: "post", path: "/api/cron/jobs", operationId: "runJobsPost", summary: "Same as the GET form, for schedulers that can only POST.", tag: "Operations", security: "cronSecret", response: loose, errors: [401] },
  { method: "get", path: "/api/cron/notifications-sweep", operationId: "runNotificationsSweepGet", summary: "Run the notifications sweep now. Bearer CRON_SECRET.", tag: "Operations", security: "cronSecret", response: loose, errors: [401] },
  { method: "post", path: "/api/cron/notifications-sweep", operationId: "runNotificationsSweepPost", summary: "Same as the GET form, for schedulers that can only POST.", tag: "Operations", security: "cronSecret", response: loose, errors: [401] },
  { method: "get", path: "/api/health", operationId: "getHealth", summary: "Liveness and database reachability, with the last notifications sweep. No authentication.", tag: "Operations", security: "none", response: loose, errors: [503] },
];

export const SECURITY_SCHEMES: Record<string, unknown> = {
  sessionCookie: { type: "apiKey", in: "cookie", name: "figbloom_session" },
  websiteApiKey: { type: "apiKey", in: "header", name: "x-figbloom-api-key" },
  inboundEmailKey: { type: "apiKey", in: "header", name: "x-figbloom-inbound-key", description: "Or the `token` query parameter." },
  signedToken: { type: "apiKey", in: "query", name: "token" },
  cronSecret: { type: "http", scheme: "bearer", description: "The shared CRON_SECRET (or the `x-cron-secret` header)." },
};
