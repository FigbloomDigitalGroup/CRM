import { createHmac } from "node:crypto";
import { UnauthorizedError } from "../../auth/errors";
import { secretsMatch } from "../../auth/secretCompare";
import type { InboundEmailPayload } from "../../services/inboundEmailService";

/**
 * Mailgun inbound adapter (FIG-806). Everything specific to Mailgun lives in this one file: how a route's forwarded form is signed,
 * and how its fields map to the provider-neutral `InboundEmailPayload`. Another provider is added as a sibling file with the same
 * two jobs (verify, map); the route, the address lookup and `ingestInboundEmailForOrganization` stay as they are.
 *
 * Mailgun signs every webhook: `signature = hex(HMAC-SHA256(signingKey, timestamp + token))`, with `timestamp` (seconds) and a
 * one-time `token` in the same form. The signature does not cover the body, so a stale timestamp and a replayed token are both
 * refused (the replay check lives in the route, which has the database).
 */
export const MAILGUN_MAX_AGE_SECONDS = 15 * 60;

export interface MailgunForm {
  get(name: string): unknown;
}

function field(form: MailgunForm, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

/** Read at call time. Unset means every request is refused (fails closed, in every environment). */
export function mailgunSigningKey(): string | null {
  const key = process.env.MAILGUN_INBOUND_SIGNING_KEY?.trim();
  return key ? key : null;
}

/**
 * Throws `UnauthorizedError` (401, standard envelope) unless the form carries a valid, fresh signature. Returns the one-time token so
 * the caller can refuse a replay. The message is the same for every failure; the key and body are never logged.
 */
export function verifyMailgunSignature(form: MailgunForm, now: Date = new Date()): { token: string } {
  const invalid = () => new UnauthorizedError("Invalid or missing inbound email signature.");
  const key = mailgunSigningKey();
  if (!key) {
    console.error("Inbound email refused: MAILGUN_INBOUND_SIGNING_KEY is not set.");
    throw invalid();
  }
  const timestamp = field(form, "timestamp");
  const token = field(form, "token");
  const signature = field(form, "signature");
  if (!/^\d{1,12}$/.test(timestamp) || !token || token.length > 200 || !/^[0-9a-fA-F]{64}$/.test(signature)) throw invalid();

  const expected = createHmac("sha256", key).update(timestamp + token).digest("hex");
  if (!secretsMatch(signature.toLowerCase(), expected)) throw invalid();

  const ageSeconds = Math.abs(now.getTime() / 1000 - Number(timestamp));
  if (ageSeconds > MAILGUN_MAX_AGE_SECONDS) throw invalid();
  return { token };
}

/** The addresses in Mailgun's `recipient` field (a comma-separated list), lower-cased. */
export function mailgunRecipients(form: MailgunForm): string[] {
  return field(form, "recipient")
    .split(/[,;]/)
    .map((r) => (r.match(/<([^<>]+)>/)?.[1] ?? r).trim().toLowerCase())
    .filter(Boolean);
}

const MAX_BODY = 20000;

/** Maps Mailgun's inbound fields to the neutral shape. Prefers `stripped-text` (quoted replies removed) over `body-plain`. */
export function mapMailgunPayload(form: MailgunForm): InboundEmailPayload {
  const text = (field(form, "stripped-text") || field(form, "body-plain")).trim();
  const attachments = Number(field(form, "attachment-count")) || 0;
  const note = attachments > 0 ? `[${attachments} attachment${attachments === 1 ? "" : "s"} not stored]` : "";
  const messageId = (field(form, "Message-Id") || field(form, "message-id")).trim();
  const combined = [text.slice(0, MAX_BODY), note].filter(Boolean).join("\n\n");
  return {
    from: (field(form, "from") || field(form, "sender")).trim(),
    subject: field(form, "subject").trim().slice(0, 500) || undefined,
    text: combined || undefined,
    messageId: messageId ? messageId.slice(0, 500) : undefined,
  };
}
