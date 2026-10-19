import type { AuthRateLimitAction } from "@prisma/client";
import { adminDb } from "../db/adminClient";
import { RateLimitedError } from "./errors";

/**
 * Durable, cross-instance rate limiting (FIG-784) for every public,
 * pre-session endpoint -- login, signup, password-reset request, and the
 * website lead-capture endpoint -- backed by one shared Postgres table
 * (`auth_rate_limit_attempts`), not in-process memory, so it works
 * correctly across multiple replicas. See that model's doc comment in
 * schema.prisma for the full design.
 */
export interface RateLimitRule {
  /** Which dimension this rule counts against -- "ip", "email", "key", etc. Purely a label; any string the caller wants is fine as long as it's consistent. */
  scope: string;
  /** The actual IP/email/key-hash value. `null` means "can't rate-limit by this dimension for this request" (e.g. no IP header present) -- the rule is skipped, not treated as unlimited abuse. */
  key: string | null;
  windowMs: number;
  max: number;
}

async function countRecentAttempts(
  action: AuthRateLimitAction,
  scope: string,
  key: string,
  since: Date,
): Promise<number> {
  return adminDb.authRateLimitAttempt.count({
    where: { action, scope, key, createdAt: { gte: since } },
  });
}

async function recordAttempt(
  action: AuthRateLimitAction,
  scope: string,
  key: string,
): Promise<void> {
  await adminDb.authRateLimitAttempt.create({ data: { action, scope, key } });
}

/**
 * Checks every rule with a non-null key; throws `RateLimitedError` on the
 * first one already at or over its max -- nothing is recorded for this
 * attempt in that case, so a rejected request doesn't also count toward
 * the window (consistent with the previous website-lead implementation's
 * check-before-record order). If every rule passes, records one row per
 * rule so this request counts toward all of them, then returns normally.
 *
 * Callers should call this before doing any real work (querying a user,
 * hashing a password, sending an email) so a caller being hammered pays as
 * little cost as possible per rejected attempt.
 */
export async function enforceRateLimit(
  action: AuthRateLimitAction,
  rules: RateLimitRule[],
): Promise<void> {
  const activeRules = rules.filter(
    (rule): rule is RateLimitRule & { key: string } => rule.key !== null,
  );

  for (const rule of activeRules) {
    const since = new Date(Date.now() - rule.windowMs);
    const count = await countRecentAttempts(action, rule.scope, rule.key, since);
    if (count >= rule.max) {
      throw new RateLimitedError();
    }
  }

  await Promise.all(
    activeRules.map((rule) => recordAttempt(action, rule.scope, rule.key)),
  );
}
