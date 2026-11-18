import { adminDb } from "../db/adminClient";
import { logger } from "../lib/logger";
import { RateLimitedError } from "./errors";
import { clearRateLimit } from "./rateLimiter";

/**
 * Sign-in throttling (P2-02, FIG-1585). Goal: nobody can lock a real person out
 * by typing wrong passwords for their email, yet password guessing stays
 * hopeless for an attacker.
 *
 *  - Failures are counted per (IP, email) pair. An attacker only slows their
 *    own address for that email; the person on another address is untouched.
 *  - After a few failures from one pair the wait before the next attempt
 *    grows (1s, 2s, 4s ... up to a maximum). It is a wait, never a lock: the
 *    right password works once the wait is over.
 *  - High ceilings: per IP (a real office never reaches it) a hard block until
 *    the window passes; per email across all IPs only the longest wait
 *    applies, plus a security event, never a hard block.
 *  - A device with a live trusted-device cookie (two-step "remember this
 *    device") skips every wait for its own account.
 *  - Only failures are counted, and a success clears the pair counter.
 *
 * No wait is spent inside the server: the caller gets a RateLimitedError with
 * the seconds to wait. The table stores IP, email and a time, never a
 * password or token.
 */
function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

export function loginThrottleConfig() {
  return {
    /** Memory of the growing wait for one pair. */
    delayWindowMs: envInt("LOGIN_DELAY_WINDOW_MS", 15 * 60_000),
    freeAttempts: envInt("LOGIN_DELAY_FREE_ATTEMPTS", 3),
    baseSeconds: envInt("LOGIN_DELAY_BASE_SECONDS", 1),
    maxSeconds: envInt("LOGIN_DELAY_MAX_SECONDS", 30),
    /** Window for the two ceilings. */
    ceilingWindowMs: envInt("LOGIN_RATE_LIMIT_WINDOW_MS", 60 * 60_000),
    maxPerIp: envInt("LOGIN_RATE_LIMIT_MAX_PER_IP", 300),
    maxPerEmail: envInt("LOGIN_RATE_LIMIT_MAX_PER_EMAIL", 200),
  };
}

/** Seconds to wait before the next attempt after `failures` failures in the window. 0 up to the free attempts, then 1, 2, 4 ... capped. */
export function growingDelaySeconds(
  failures: number,
  cfg: { freeAttempts: number; baseSeconds: number; maxSeconds: number } = loginThrottleConfig(),
): number {
  const over = failures - cfg.freeAttempts;
  if (over <= 0) return 0;
  return Math.min(cfg.maxSeconds, cfg.baseSeconds * 2 ** Math.min(over - 1, 20));
}

export function normalizeLoginEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function loginPairKey(ip: string | null, email: string): string {
  return `${ip ?? "unknown"}|${normalizeLoginEmail(email)}`;
}

function waitMessage(seconds: number): string {
  if (seconds >= 120) return `Too many sign-in attempts. Please wait ${Math.ceil(seconds / 60)} minutes and try again.`;
  return `Too many sign-in attempts. Please wait ${seconds} second${seconds === 1 ? "" : "s"} and try again.`;
}

async function stats(scope: string, key: string, since: Date) {
  const where = { action: "LOGIN" as const, scope, key, createdAt: { gte: since } };
  const [count, last, first] = await Promise.all([
    adminDb.authRateLimitAttempt.count({ where }),
    adminDb.authRateLimitAttempt.findFirst({ where, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    adminDb.authRateLimitAttempt.findFirst({ where, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);
  return { count, last: last?.createdAt ?? null, first: first?.createdAt ?? null };
}

/** Seconds left of a wait that started at `last` and lasts `waitSeconds`. */
function remainingSeconds(last: Date | null, waitSeconds: number, now: number): number {
  if (!last || waitSeconds <= 0) return 0;
  return Math.max(0, Math.ceil((last.getTime() + waitSeconds * 1000 - now) / 1000));
}

/**
 * Throws RateLimitedError (with the wait) when this attempt is not allowed yet.
 * Refused attempts are not recorded. `trusted` skips everything: the caller has
 * already proved the device belongs to this account.
 */
export async function checkLoginThrottle(ip: string | null, email: string, opts: { trusted?: boolean } = {}): Promise<void> {
  if (opts.trusted) return;
  const cfg = loginThrottleConfig();
  const now = Date.now();
  const ceilingSince = new Date(now - cfg.ceilingWindowMs);

  if (ip) {
    const ipStats = await stats("ip", ip, ceilingSince);
    if (ipStats.count >= cfg.maxPerIp && ipStats.first) {
      const seconds = Math.max(1, Math.ceil((ipStats.first.getTime() + cfg.ceilingWindowMs - now) / 1000));
      throw new RateLimitedError(waitMessage(seconds), seconds);
    }
  }

  const pair = await stats("pair", loginPairKey(ip, email), new Date(now - cfg.delayWindowMs));
  let wait = remainingSeconds(pair.last, growingDelaySeconds(pair.count, cfg), now);

  // Per email across all addresses: the longest wait, never a block.
  const emailStats = await stats("email", normalizeLoginEmail(email), ceilingSince);
  if (emailStats.count >= cfg.maxPerEmail) {
    wait = Math.max(wait, remainingSeconds(emailStats.last, cfg.maxSeconds, now));
  }
  if (wait > 0) throw new RateLimitedError(waitMessage(wait), wait);
}

export interface LoginFailureResult {
  ipCeilingReached: boolean;
  emailCeilingReached: boolean;
}

/** Records one failed attempt for the pair, the IP and the email. Reports a ceiling reached by exactly this failure (once per window). */
export async function recordLoginFailure(ip: string | null, email: string): Promise<LoginFailureResult> {
  const cfg = loginThrottleConfig();
  const normalised = normalizeLoginEmail(email);
  const rows = [
    { action: "LOGIN" as const, scope: "pair", key: loginPairKey(ip, email) },
    { action: "LOGIN" as const, scope: "email", key: normalised },
    ...(ip ? [{ action: "LOGIN" as const, scope: "ip", key: ip }] : []),
  ];
  await adminDb.authRateLimitAttempt.createMany({ data: rows });
  const since = new Date(Date.now() - cfg.ceilingWindowMs);
  const [emailCount, ipCount] = await Promise.all([
    adminDb.authRateLimitAttempt.count({ where: { action: "LOGIN", scope: "email", key: normalised, createdAt: { gte: since } } }),
    ip ? adminDb.authRateLimitAttempt.count({ where: { action: "LOGIN", scope: "ip", key: ip, createdAt: { gte: since } } }) : Promise.resolve(0),
  ]);
  const result = { emailCeilingReached: emailCount === cfg.maxPerEmail, ipCeilingReached: !!ip && ipCount === cfg.maxPerIp };
  if (result.emailCeilingReached) logger.warn({ event: "login.email_ceiling_reached", ceiling: cfg.maxPerEmail }, "sign-in failure ceiling reached for one email");
  if (result.ipCeilingReached) logger.warn({ event: "login.ip_ceiling_reached", ip, ceiling: cfg.maxPerIp }, "sign-in failure ceiling reached for one address");
  return result;
}

/** A successful sign-in forgets this pair's failures. */
export async function clearLoginPair(ip: string | null, email: string): Promise<void> {
  await clearRateLimit("LOGIN", "pair", loginPairKey(ip, email));
}

/** Admin unlock: forget every failure recorded for the email, on every address. */
export async function clearLoginFailuresForEmail(email: string): Promise<void> {
  const normalised = normalizeLoginEmail(email);
  await clearRateLimit("LOGIN", "email", normalised);
  await adminDb.authRateLimitAttempt.deleteMany({ where: { action: "LOGIN", scope: "pair", key: { endsWith: `|${normalised}` } } });
}
