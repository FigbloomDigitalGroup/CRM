import type { Breadcrumb, ErrorEvent, EventHint, Exception, TransactionEvent } from "@sentry/core";

/**
 * FIG-753: what counts as "personal data" to strip before anything reaches
 * Sentry -- emails and phone numbers (pattern-based, since they can appear
 * in any free-text field: a message, a note, a validation error) and
 * deal/money values (key-based, since there's no pattern that distinguishes
 * a deal amount from any other number). Applied to both the server and
 * client Sentry `beforeSend` hooks and the pino-to-Sentry bridge in
 * `logger.ts`, so there is exactly one definition of "sensitive" shared by
 * every place an error can leave this app.
 */
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/**
 * Deliberately broad: 7+ digits, optionally grouped with spaces/dashes/
 * dots/parens, optionally with a leading `+`. Over-matching a non-phone
 * number string is an acceptable cost here -- under-matching a real phone
 * number is not.
 */
const PHONE_PATTERN = /(?:\+?\d[\d\s().-]{6,}\d)/g;

/**
 * Field names redacted outright regardless of value shape -- covers the
 * ticket's explicit "deal values" (no numeric pattern distinguishes a deal
 * amount from any other count/id) plus the obvious adjacent fields this
 * app already treats as sensitive elsewhere (credentials, tokens).
 */
const SENSITIVE_KEYS = new Set([
  "email",
  "emails",
  "phone",
  "phones",
  "value",
  "amount",
  "dealvalue",
  "price",
  "currency",
  "password",
  "passwordhash",
  "token",
  "tokenhash",
  "apikey",
  "keyhash",
  "notes",
  "message",
  "qualificationdata",
]);

const REDACTED = "[redacted]";

function scrubString(value: string): string {
  return value.replace(EMAIL_PATTERN, "[redacted-email]").replace(PHONE_PATTERN, "[redacted-phone]");
}

/**
 * Recursively scrubs a plain value: strings are pattern-scrubbed, object
 * keys matching `SENSITIVE_KEYS` are redacted outright (case-insensitive),
 * everything else recurses. Used directly for ad-hoc context objects (e.g.
 * the pino logger bridge) and as the building block for
 * `scrubSentryEvent`, below.
 */
export function scrubPII(input: unknown, depth = 0): unknown {
  if (input == null || depth > 6) return input;
  if (typeof input === "string") return scrubString(input);
  if (Array.isArray(input)) return input.map((item) => scrubPII(item, depth + 1));
  if (typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEYS.has(key.toLowerCase()) ? REDACTED : scrubPII(value, depth + 1);
    }
    return out;
  }
  return input;
}

/**
 * `beforeSend`/`beforeSendTransaction` for both the client and server
 * Sentry init -- scrubs every part of the event that could carry
 * user-entered text or structured record data: the exception message
 * itself (e.g. a validation error that echoes an email back), request
 * data/query string, extra context, tags, and breadcrumb data. Does NOT
 * touch stack traces/frames (code locations, not user data) or the event's
 * own identifiers (event id, timestamps, release).
 *
 * `sendDefaultPii` is left `false` in both init configs (see
 * instrumentation.ts/instrumentation-client.ts) so Sentry never attaches
 * IP address/cookies/headers in the first place -- this hook is the second
 * layer, for data the app itself puts into the event.
 */
export function scrubSentryEvent<E extends ErrorEvent | TransactionEvent>(
  event: E,
  _hint?: EventHint,
): E {
  if (event.request) {
    event.request = scrubPII(event.request) as E["request"];
  }
  if (event.extra) {
    event.extra = scrubPII(event.extra) as E["extra"];
  }
  if (event.contexts) {
    event.contexts = scrubPII(event.contexts) as E["contexts"];
  }
  if (event.tags) {
    event.tags = scrubPII(event.tags) as E["tags"];
  }
  if (event.user) {
    // Keep only a stable identifier (membership id), never the name/email
    // Sentry's SDK would otherwise default to -- this app never calls
    // `Sentry.setUser` with anything else, but scrub defensively anyway.
    event.user = event.user.id ? { id: event.user.id } : undefined;
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((crumb: Breadcrumb) => ({
      ...crumb,
      message: crumb.message ? scrubString(crumb.message) : crumb.message,
      data: crumb.data ? (scrubPII(crumb.data) as Record<string, unknown>) : crumb.data,
    }));
  }
  if (event.exception?.values) {
    event.exception.values = event.exception.values.map((value: Exception) => ({
      ...value,
      value: value.value ? scrubString(value.value) : value.value,
    }));
  }
  if ("message" in event && typeof event.message === "string") {
    event.message = scrubString(event.message);
  }
  return event;
}
