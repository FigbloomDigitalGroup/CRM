import { resolveWebsitePublicContext } from "../auth/websiteApiKey";
import { ValidationError } from "../auth/errors";
import {
  ingestWebsiteLead,
  type WebsiteLeadInput,
  type WebsiteLeadResult,
} from "../repositories/leadIngestion";

/**
 * Public entry point: the only service function that doesn't take an
 * `AuthContext`, because there is none -- a marketing-site contact form
 * has no CRM session. Authorization here is the API key, not a permission
 * check; see `src/auth/websiteApiKey.ts`.
 */
export async function submitWebsiteLead(
  orgSlug: string,
  providedKey: string | null,
  rawBody: unknown,
): Promise<WebsiteLeadResult> {
  const { organizationId } = await resolveWebsitePublicContext(
    orgSlug,
    providedKey,
  );
  const input = validateWebsiteLeadInput(rawBody);
  return ingestWebsiteLead(organizationId, input);
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Forgiving on purpose: fields the website can't have gotten right (an
 * unrecognized service label, missing UTM params) get resolved downstream
 * rather than rejected here -- a public lead-capture form has no human on
 * the other end to fix a validation error, and a strict form here just
 * means losing the lead. Only `name` and "at least one of email/phone"
 * are required -- that's the minimum needed to ever contact this person
 * back.
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

  const email = asOptionalString(body.email);
  const phone = asOptionalString(body.phone);
  if (!email && !phone) {
    throw new ValidationError("At least one of `email` or `phone` is required.");
  }

  const rawUtm =
    typeof body.utm === "object" && body.utm !== null
      ? (body.utm as Record<string, unknown>)
      : {};
  const utm: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawUtm)) {
    const stringValue = asOptionalString(value);
    if (stringValue) utm[key] = stringValue;
  }
  const referrer = asOptionalString(body.referrer);
  if (referrer) utm.referrer = referrer;

  return {
    name,
    email,
    phone,
    company: asOptionalString(body.company),
    service: asOptionalString(body.service),
    message: asOptionalString(body.message),
    utm: Object.keys(utm).length > 0 ? utm : undefined,
  };
}
