import { verifyCaptchaToken } from "../auth/captcha";
import { RateLimitedError, UnauthorizedError, ValidationError } from "../auth/errors";
import {
  hashWebsiteApiKey,
  resolveWebsitePublicContext,
} from "../auth/websiteApiKey";
import { adminDb } from "../db/adminClient";
import {
  ingestWebsiteLead,
  type WebsiteLeadInput,
  type WebsiteLeadResult,
} from "../repositories/leadIngestion";
import {
  notifyLeadAssigned,
  sendWebsiteLeadAcknowledgement,
} from "./notificationService";
import {
  countRequestsByIp,
  countRequestsByKeyHash,
  recordWebsiteLeadRequest,
  type WebsiteLeadRequestOutcome,
} from "../repositories/websiteLeadRequestLog";

/**
 * Public entry point: the only service function that doesn't take an
 * `AuthContext`, because there is none -- a marketing-site contact form
 * has no CRM session. Authorization here is the API key, not a permission
 * check; see `src/auth/websiteApiKey.ts`.
 *
 * FIG-594 wraps FIG-442's original ingestion with abuse protection: per-
 * key and per-IP rate limiting, a payload size cap, field length limits,
 * optional per-key honeypot/captcha, and optional per-key allowed origins.
 * Every attempt -- accepted or rejected -- is logged via
 * `recordWebsiteLeadRequest` in a `finally` block, so exactly one log row
 * exists per request regardless of which check (if any) rejected it; that
 * log is also what rate limiting counts against, rather than maintaining a
 * separate in-memory counter this project has nowhere durable to keep.
 *
 * The three limits below are read live from the environment (not frozen
 * at module load), defaulting to sane values if unset -- this lets ops
 * tune them without a code change, and lets tests set a tiny window/limit
 * instead of firing dozens of real requests to prove the limiting works.
 */
function rateLimitWindowMs(): number {
  return Number(process.env.WEBSITE_LEAD_RATE_LIMIT_WINDOW_MS) || 60_000;
}
function rateLimitMaxPerIp(): number {
  return Number(process.env.WEBSITE_LEAD_RATE_LIMIT_MAX_PER_IP) || 20;
}
function rateLimitMaxPerKey(): number {
  return Number(process.env.WEBSITE_LEAD_RATE_LIMIT_MAX_PER_KEY) || 60;
}
const MAX_PAYLOAD_BYTES = 10_000;

const MAX_NAME_LENGTH = 200;
const MAX_EMAIL_LENGTH = 320;
const MAX_PHONE_LENGTH = 32;
const MAX_COMPANY_LENGTH = 200;
const MAX_SERVICE_LENGTH = 100;
const MAX_MESSAGE_LENGTH = 5000;
const MAX_UTM_VALUE_LENGTH = 500;

export interface WebsiteLeadRequestMeta {
  ipAddress: string | null;
  origin: string | null;
}

export async function submitWebsiteLead(
  orgSlug: string,
  providedKey: string | null,
  rawBodyText: string,
  meta: WebsiteLeadRequestMeta,
): Promise<WebsiteLeadResult | null> {
  let outcome: WebsiteLeadRequestOutcome = "ACCEPTED";
  let reason: string | null = null;
  let leadId: string | null = null;
  const keyHash = providedKey ? hashWebsiteApiKey(providedKey) : null;

  // Resolved by slug up front, purely so every attempt against a *known*
  // org slug -- including a wrong/missing key -- lands in that org's own
  // monitoring view (RLS-scoped to organizationId). This never affects the
  // actual auth decision or the generic error message a caller gets back:
  // `resolveWebsitePublicContext` below still independently verifies the
  // key and still fails exactly the same way whether or not the slug
  // resolves, so an unauthenticated caller learns nothing extra from this.
  const orgForLogging = await adminDb.organization.findUnique({
    where: { slug: orgSlug },
    select: { id: true },
  });
  let organizationId: string | null = orgForLogging?.id ?? null;

  try {
    const byteLength = Buffer.byteLength(rawBodyText, "utf8");
    if (byteLength > MAX_PAYLOAD_BYTES) {
      outcome = "PAYLOAD_TOO_LARGE";
      reason = `${byteLength} bytes (max ${MAX_PAYLOAD_BYTES}).`;
      throw new ValidationError("Request body is too large.");
    }

    if (meta.ipAddress) {
      const since = new Date(Date.now() - rateLimitWindowMs());
      const ipCount = await countRequestsByIp(meta.ipAddress, since);
      if (ipCount >= rateLimitMaxPerIp()) {
        outcome = "RATE_LIMITED";
        reason = "Per-IP rate limit exceeded.";
        throw new RateLimitedError();
      }
    }

    if (keyHash) {
      const since = new Date(Date.now() - rateLimitWindowMs());
      const keyCount = await countRequestsByKeyHash(keyHash, since);
      if (keyCount >= rateLimitMaxPerKey()) {
        outcome = "RATE_LIMITED";
        reason = "Per-key rate limit exceeded.";
        throw new RateLimitedError();
      }
    }

    let context;
    try {
      context = await resolveWebsitePublicContext(orgSlug, providedKey);
    } catch (err) {
      outcome = "INVALID_KEY";
      throw err;
    }
    organizationId = context.organizationId;

    if (context.allowedOrigins.length > 0) {
      if (!meta.origin || !context.allowedOrigins.includes(meta.origin)) {
        outcome = "ORIGIN_NOT_ALLOWED";
        reason = meta.origin ?? "(no Origin/Referer header)";
        throw new UnauthorizedError("Origin not allowed for this key.");
      }
    }

    let rawBody: unknown;
    try {
      rawBody = JSON.parse(rawBodyText);
    } catch {
      outcome = "VALIDATION_FAILED";
      reason = "Invalid JSON.";
      throw new ValidationError("Request body must be valid JSON.");
    }

    let input: WebsiteLeadInput;
    try {
      input = validateWebsiteLeadInput(rawBody);
    } catch (err) {
      outcome = "VALIDATION_FAILED";
      reason = err instanceof Error ? err.message : "Validation failed.";
      throw err;
    }

    if (context.honeypotFieldName) {
      const honeypotValue = (rawBody as Record<string, unknown>)[
        context.honeypotFieldName
      ];
      if (typeof honeypotValue === "string" && honeypotValue.trim().length > 0) {
        outcome = "HONEYPOT_TRIGGERED";
        // No error thrown on purpose -- a honeypot works by looking like a
        // normal success to whatever filled it in. The route returns its
        // usual "created" shape; no lead is actually created.
        return null;
      }
    }

    if (context.captchaSecret) {
      const captchaToken = (rawBody as Record<string, unknown>).captchaToken;
      const passed =
        typeof captchaToken === "string" &&
        (await verifyCaptchaToken(
          context.captchaSecret,
          captchaToken,
          meta.ipAddress,
        ));
      if (!passed) {
        outcome = "CAPTCHA_FAILED";
        reason = "Missing or invalid captcha token.";
        throw new ValidationError("Captcha verification failed.");
      }
    }

    const result = await ingestWebsiteLead(organizationId, input);
    leadId = result.leadId;
    outcome = "ACCEPTED";

    // Both best-effort and post-commit (FIG-597): the lead/task above is
    // already durably saved, so a notification/acknowledgement delivery
    // failure here must never turn an otherwise-successful public
    // submission into an error response.
    if (result.ownerMembershipId) {
      await notifyLeadAssigned(organizationId, result.ownerMembershipId, {
        id: result.leadId,
        label: input.company ?? input.name,
      });
    }
    await sendWebsiteLeadAcknowledgement(organizationId, {
      name: input.name,
      email: input.email,
      phone: input.phone,
    });

    return result;
  } finally {
    await recordWebsiteLeadRequest({
      organizationId,
      keyHash,
      ipAddress: meta.ipAddress,
      origin: meta.origin,
      outcome,
      reason,
      leadId,
    });
  }
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function assertMaxLength(
  value: string | undefined,
  max: number,
  fieldName: string,
): void {
  if (value && value.length > max) {
    throw new ValidationError(`\`${fieldName}\` must be at most ${max} characters.`);
  }
}

/**
 * Forgiving on purpose: fields the website can't have gotten right (an
 * unrecognized service label, missing UTM params) get resolved downstream
 * rather than rejected here -- a public lead-capture form has no human on
 * the other end to fix a validation error, and a strict form here just
 * means losing the lead. Only `name` and "at least one of email/phone" are
 * required -- that's the minimum needed to ever contact this person back.
 * Length limits (FIG-594) are a ceiling against abuse, not a real-world
 * form constraint -- every one of them is far larger than any legitimate
 * value.
 */
function validateWebsiteLeadInput(rawBody: unknown): WebsiteLeadInput {
  if (typeof rawBody !== "object" || rawBody === null) {
    throw new ValidationError("Request body must be a JSON object.");
  }
  const body = rawBody as Record<string, unknown>;

  const name = asOptionalString(body.name);
  if (!name) {
    throw new ValidationError("`name` is required.");
  }
  assertMaxLength(name, MAX_NAME_LENGTH, "name");

  const email = asOptionalString(body.email);
  assertMaxLength(email, MAX_EMAIL_LENGTH, "email");
  const phone = asOptionalString(body.phone);
  assertMaxLength(phone, MAX_PHONE_LENGTH, "phone");
  if (!email && !phone) {
    throw new ValidationError("At least one of `email` or `phone` is required.");
  }

  const company = asOptionalString(body.company);
  assertMaxLength(company, MAX_COMPANY_LENGTH, "company");
  const service = asOptionalString(body.service);
  assertMaxLength(service, MAX_SERVICE_LENGTH, "service");
  const message = asOptionalString(body.message);
  assertMaxLength(message, MAX_MESSAGE_LENGTH, "message");

  const rawUtm =
    typeof body.utm === "object" && body.utm !== null
      ? (body.utm as Record<string, unknown>)
      : {};
  const utm: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawUtm)) {
    const stringValue = asOptionalString(value);
    if (stringValue) {
      assertMaxLength(stringValue, MAX_UTM_VALUE_LENGTH, `utm.${key}`);
      utm[key] = stringValue;
    }
  }
  const referrer = asOptionalString(body.referrer);
  if (referrer) {
    assertMaxLength(referrer, MAX_UTM_VALUE_LENGTH, "referrer");
    utm.referrer = referrer;
  }

  return {
    name,
    email,
    phone,
    company,
    service,
    message,
    utm: Object.keys(utm).length > 0 ? utm : undefined,
  };
}
