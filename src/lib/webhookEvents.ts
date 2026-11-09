import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Outbound webhooks (FIG-804): the events people can subscribe to, and how a delivery is signed and checked.
 * Pure functions only (no database), shared by the sender, the tests and the receiver's example in the docs.
 */

export const WEBHOOK_EVENT_TYPES = [
  "lead.created",
  "lead.assigned",
  "lead.converted",
  "deal.stage_changed",
  "deal.won",
  "deal.lost",
  "contact.created",
  "company.created",
  "task.created",
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/** The test event a person can send from Settings; it is not a subscription choice. */
export const WEBHOOK_PING_EVENT = "webhook.ping";

export function isWebhookEventType(value: string): value is WebhookEventType {
  return (WEBHOOK_EVENT_TYPES as readonly string[]).includes(value);
}

export const WEBHOOK_SIGNATURE_VERSION = "v1";
/** A receiver should refuse a delivery whose timestamp is older than this. */
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export function newWebhookSecret(randomBytesBase64Url: string): string {
  return `whsec_${randomBytesBase64Url}`;
}

/** `v1=<hex>`: HMAC-SHA256 over `<timestamp>.<raw body>` with the endpoint's secret. Signing the timestamp is what lets a receiver reject replays. */
export function signWebhook(secret: string, timestampSeconds: number, rawBody: string): string {
  return `${WEBHOOK_SIGNATURE_VERSION}=${createHmac("sha256", secret).update(`${timestampSeconds}.${rawBody}`).digest("hex")}`;
}

/**
 * What a receiver does with the three headers it gets (`X-Figbloom-Timestamp`, `X-Figbloom-Signature`) and the raw body.
 * Constant-time comparison; a stale or future timestamp is refused.
 */
export function verifyWebhookSignature(input: {
  secret: string;
  timestamp: string | null;
  signature: string | null;
  rawBody: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): { ok: true } | { ok: false; reason: "missing" | "stale" | "mismatch" } {
  if (!input.timestamp || !input.signature) return { ok: false, reason: "missing" };
  const ts = Number(input.timestamp);
  if (!Number.isInteger(ts)) return { ok: false, reason: "missing" };
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > (input.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS)) return { ok: false, reason: "stale" };
  const expected = Buffer.from(signWebhook(input.secret, ts, input.rawBody));
  const given = Buffer.from(input.signature);
  return expected.length === given.length && timingSafeEqual(expected, given) ? { ok: true } : { ok: false, reason: "mismatch" };
}

/** Seconds to wait before attempt number `attempts + 1`, after `attempts` failed attempts: 1 min, 3 min, 9 min, 27 min ... capped at 6 hours. */
export function webhookBackoffSeconds(attempts: number): number {
  return Math.min(60 * 3 ** Math.max(0, attempts - 1), 6 * 60 * 60);
}

/** After this many attempts a delivery is DEAD (about eleven hours of trying). */
export const WEBHOOK_MAX_ATTEMPTS = 8;
/** An endpoint whose last N deliveries all died is switched off, so a gone receiver stops costing work. */
export const WEBHOOK_DISABLE_AFTER_DEAD = 10;
