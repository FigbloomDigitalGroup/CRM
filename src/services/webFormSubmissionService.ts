import { createTranslator, isClientLocale, type ClientLocale } from "../lib/clientText";
import { readCaptchaSecret } from "./webFormService";
import { NotFoundError, ValidationError } from "../auth/errors";
import { verifyCaptchaToken } from "../auth/captcha";
import { enforceRateLimit, type RateLimitRule } from "../auth/rateLimiter";
import { isFeatureEnabled } from "./featureService";
import { ingestWebsiteLead } from "../repositories/leadIngestion";
import { recordWebsiteLeadRequest, type WebsiteLeadRequestOutcome } from "../repositories/websiteLeadRequestLog";
import { findPublicForm, isOrganizationActive, recordSubmission } from "../repositories/webForms";
import { checkSubmission, MAX_PAYLOAD_BYTES, SubmissionRejected, type FormField, type SubmissionOutcome } from "../lib/webForms";
import { notifyLeadAssigned } from "./notificationService";
import { autoEnrolLead } from "./followUpService";
import { emitLeadCreatedById } from "./webhookService";

/**
 * The public web form endpoint's logic (FIG-1151, B6.19). Session-less, like `submitWebsiteLead`: there is no CRM user, the form's
 * public key plus the organisation slug is the address, and every protection runs before a lead exists:
 *
 *   1. unknown key, wrong organisation, unpublished form, or an organisation that is not active: one generic 404 (and the caller's
 *      address is still rate limited, so keys cannot be guessed quickly)
 *   2. payload size, then rate limits per address, per form and per organisation
 *   3. the form's allowed websites (Origin or Referer), when it lists any
 *   4. the body is checked against the form's own fields; anything not declared is ignored
 *   5. the hidden trap field (a bot that fills it is told it succeeded and no lead is made), the optional captcha, and a link-spam check
 *   6. the lead is made by the same ingestion as the website endpoint, with the form's lead source, the form's id on the lead, and
 *      a duplicate warning on the lead for staff (never in the response, so a caller cannot probe the customer list)
 *
 * Every attempt on a known form, accepted or not, is written to the form's submission log and mirrored to the website request log
 * Settings already shows (B4.01). The caller only ever gets the form's success message, never an id.
 * Automations still only assign and remind: this path creates a lead and what the assignment rules do, and moves nothing.
 */

function envNumber(name: string, fallback: number) {
  return Number(process.env[name]) || fallback;
}
const windowMs = () => envNumber("WEB_FORM_RATE_LIMIT_WINDOW_MS", 60_000);
const maxPerIp = () => envNumber("WEB_FORM_RATE_LIMIT_MAX_PER_IP", 10);
const maxPerForm = () => envNumber("WEB_FORM_RATE_LIMIT_MAX_PER_FORM", 60);
const maxPerOrganization = () => envNumber("WEB_FORM_RATE_LIMIT_MAX_PER_ORG", 200);

export interface FormRequestMeta {
  ipAddress: string | null;
  origin: string | null;
}

const NOT_AVAILABLE = () => new NotFoundError("Form", "at this address");

/** Finds a published form for this address and organisation, or throws the one generic answer. */
async function resolveForm(orgSlug: string, publicKey: string, meta: FormRequestMeta) {
  const form = await findPublicForm(orgSlug, publicKey);
  if (!form || form.status !== "PUBLISHED" || !(await isOrganizationActive(form.organizationId)) || !(await isFeatureEnabled(form.organizationId, "release.v11"))) {
    // Unknown keys still count against the caller's address, so they cannot be tried quickly.
    await enforceRateLimit("WEB_FORM", [{ scope: "ip-unresolved", key: meta.ipAddress, windowMs: windowMs(), max: maxPerIp() }]);
    throw NOT_AVAILABLE();
  }
  return form;
}

/**
 * The thank-you text (FIG-1189). The organisation's own wording is always shown as written; only the built-in default, left untouched,
 * follows the form's language.
 */
function successMessageFor(form: { successMessage: string; language: string }): string {
  const english = createTranslator("en").t("form.thanks");
  return form.successMessage === english && isClientLocale(form.language) ? createTranslator(form.language).t("form.thanks") : form.successMessage;
}

/** What a page needs to draw the form. No ids, no settings, no secrets. */
export async function getPublicForm(orgSlug: string, publicKey: string, meta: FormRequestMeta) {
  const form = await resolveForm(orgSlug, publicKey, meta);
  await enforceRateLimit("WEB_FORM", [{ scope: "ip-definition", key: meta.ipAddress, windowMs: windowMs(), max: maxPerIp() * 6 }]);
  const fields = (form.fields as unknown as FormField[]).map((f) => ({ key: f.key, label: f.label, type: f.type, required: f.required, ...(f.options ? { options: f.options } : {}) }));
  // The form's own text in its language (FIG-1189); a key with no Swahili text yet is English and listed in `fallbackKeys`, so a page can say so.
  const language: ClientLocale = isClientLocale(form.language) ? form.language : "en";
  const tr = createTranslator(language);
  const text = { submit: tr.t("form.submit"), required: tr.t("form.required"), optional: tr.t("form.optional"), captcha: tr.t("form.captcha"), fixFields: tr.t("form.fixFields") };
  return { name: form.name, language, text, fallbackKeys: [...tr.fellBack].sort(), fields, honeypotFieldName: form.honeypotFieldName, captchaRequired: form.captchaSecret !== null };
}

const TO_WEBSITE_OUTCOME: Record<SubmissionOutcome, WebsiteLeadRequestOutcome> = {
  ACCEPTED: "ACCEPTED",
  RATE_LIMITED: "RATE_LIMITED",
  INVALID_KEY: "INVALID_KEY",
  ORIGIN_NOT_ALLOWED: "ORIGIN_NOT_ALLOWED",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  HONEYPOT_TRIGGERED: "HONEYPOT_TRIGGERED",
  CAPTCHA_FAILED: "CAPTCHA_FAILED",
  SPAM_CONTENT: "SPAM_CONTENT",
};

export async function submitWebForm(orgSlug: string, publicKey: string, rawBodyText: string, meta: FormRequestMeta): Promise<{ message: string }> {
  const form = await resolveForm(orgSlug, publicKey, meta);
  const organizationId = form.organizationId;
  // Anything that stops before the lead is saved is logged as not completed; only a saved lead flips this to ACCEPTED.
  let outcome: SubmissionOutcome = "VALIDATION_FAILED";
  let reason: string | null = "The submission did not complete.";
  let leadId: string | null = null;
  let duplicate = { contact: false, company: false };

  function reject(o: SubmissionOutcome, why: string): never {
    outcome = o;
    reason = why;
    throw new SubmissionRejected(o, why);
  }

  try {
    const bytes = Buffer.byteLength(rawBodyText, "utf8");
    if (bytes > MAX_PAYLOAD_BYTES) reject("PAYLOAD_TOO_LARGE", `${bytes} bytes (max ${MAX_PAYLOAD_BYTES}).`);

    if (form.allowedOrigins.length > 0 && (!meta.origin || !form.allowedOrigins.includes(meta.origin))) {
      reject("ORIGIN_NOT_ALLOWED", meta.origin ?? "(no Origin or Referer header)");
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBodyText);
    } catch {
      reject("VALIDATION_FAILED", "Invalid JSON.");
    }

    // A trap-field submission is answered like a success before any bucket is spent on it.
    const trap = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>)[form.honeypotFieldName] : undefined;
    if (typeof trap === "string" && trap.trim().length > 0) {
      outcome = "HONEYPOT_TRIGGERED";
      reason = "The hidden trap field was filled in.";
      return { message: successMessageFor(form) };
    }

    const rules: RateLimitRule[] = [
      { scope: "ip", key: meta.ipAddress, windowMs: windowMs(), max: maxPerIp() },
      { scope: "form", key: form.id, windowMs: windowMs(), max: maxPerForm() },
      { scope: "org", key: organizationId, windowMs: windowMs(), max: maxPerOrganization() },
    ];
    try {
      await enforceRateLimit("WEB_FORM", rules);
    } catch (err) {
      outcome = "RATE_LIMITED";
      reason = "Per-address, per-form or per-organisation rate limit exceeded.";
      throw err;
    }

    const checked = checkSubmission(form.fields as unknown as FormField[], form.honeypotFieldName, body);

    if (checked.honeypotFilled) {
      // Looks like a success to whatever filled it in; no lead is made.
      outcome = "HONEYPOT_TRIGGERED";
      reason = "The hidden trap field was filled in.";
      return { message: successMessageFor(form) };
    }

    if (form.captchaSecret) {
      const token = (body as Record<string, unknown>).captchaToken;
      const passed = typeof token === "string" && (await verifyCaptchaToken(readCaptchaSecret(form.captchaSecret), token, meta.ipAddress));
      if (!passed) reject("CAPTCHA_FAILED", "Missing or invalid captcha token.");
    }

    const result = await ingestWebsiteLead(organizationId, {
      ...checked.lead,
      source: form.leadSourceKey ?? undefined,
      webForm: { id: form.id, name: form.name },
    });
    leadId = result.leadId;
    outcome = "ACCEPTED";
    reason = null;
    duplicate = { contact: result.contactMatched, company: result.companyMatched };

    // Follow-up sequences that start from a new website lead (FIG-1150); never fails the submission.
    await autoEnrolLead(organizationId, result.leadId);
    await emitLeadCreatedById(organizationId, result.leadId);

    // Best effort and after the commit: a notification problem never turns a saved submission into an error.
    if (result.ownerMembershipId) {
      await notifyLeadAssigned(organizationId, result.ownerMembershipId, { id: result.leadId, label: checked.lead.company ?? checked.lead.name }).catch(() => undefined);
    }
    return { message: successMessageFor(form) };
  } catch (err) {
    if (err instanceof SubmissionRejected) {
      outcome = err.outcome;
      reason = err.reason;
      // The caller learns that the submission was refused and, for a validation problem, which answers to fix; never the internal rule.
      if (err.outcome === "VALIDATION_FAILED" && err.issues.length > 0) throw new ValidationError("Please check your answers.", err.issues);
      throw new ValidationError("This submission was not accepted.");
    }
    throw err;
  } finally {
    // Exactly one log row per attempt on a known form, whatever happened.
    await recordSubmission({
      organizationId,
      webFormId: form.id,
      formName: form.name,
      outcome,
      reason,
      ipAddress: meta.ipAddress,
      origin: meta.origin,
      leadId,
      duplicateContact: duplicate.contact,
      duplicateCompany: duplicate.company,
    }).catch(() => undefined);
    await recordWebsiteLeadRequest({
      organizationId,
      ipAddress: meta.ipAddress,
      origin: meta.origin,
      outcome: TO_WEBSITE_OUTCOME[outcome],
      reason: reason ? `Form "${form.name}": ${reason}` : `Form "${form.name}"`,
      leadId,
    }).catch(() => undefined);
  }
}
