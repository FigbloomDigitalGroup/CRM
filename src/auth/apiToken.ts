import { createHash, randomBytes } from "node:crypto";
import { adminDb } from "../db/adminClient";
import { withOrgContext } from "../db/orgScopedClient";
import { resolveActiveMembership } from "../repositories/memberships";
import { requireFeature } from "../services/featureService";
import type { AuthContext } from "./context";
import { ForbiddenError, UnauthorizedError } from "./errors";
import { enforceRateLimit } from "./rateLimiter";

/**
 * Personal API tokens for the public REST API (FIG-805, `docs/M17_LANE_C_PUBLIC_API_WEBHOOKS.md`).
 *
 * A token is `fbk_` plus 32 random bytes (base64url). Only its SHA-256 is stored; the plain text is shown once, when it is created. The
 * token never carries permissions of its own: every request resolves the owning membership afresh (`resolveActiveMembership`), so the
 * same permission checks, masking, tenant scoping and RLS apply as for that person in the browser, and a removed person, a changed
 * role or a suspended organisation takes effect on the next request. Scopes can only narrow that.
 */

export const API_TOKEN_PREFIX = "fbk_";
const TOKEN_BYTES = 32;

/** The records the public API serves, and what a scope can allow on each. */
export const API_ENTITIES = ["companies", "contacts", "leads", "deals", "activities", "tasks"] as const;
export type ApiEntity = (typeof API_ENTITIES)[number];
export const API_SCOPES: readonly string[] = API_ENTITIES.flatMap((e) => [`${e}:read`, `${e}:write`]);
export type ApiScope = `${ApiEntity}:${"read" | "write"}`;

/** Requests per token per minute, and per address per minute (for requests that carry no valid token). */
export const API_RATE_LIMIT_PER_TOKEN = 120;
export const API_RATE_LIMIT_PER_ADDRESS = 600;
const RATE_WINDOW_MS = 60_000;
/** `last_used_at` is written at most this often, so reading does not turn into writing on every request. */
const LAST_USED_GRANULARITY_MS = 60_000;

export function generateApiToken(): { plaintext: string; tokenHash: string; tokenPrefix: string } {
  const plaintext = `${API_TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString("base64url")}`;
  return { plaintext, tokenHash: hashApiToken(plaintext), tokenPrefix: plaintext.slice(0, 12) };
}

export function hashApiToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/** The token from `Authorization: Bearer <token>`; null when the header is missing or is not a bearer credential. */
export function bearerTokenFrom(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1]! : null;
}

function clientAddress(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || null;
}

export interface ApiTokenAuth {
  ctx: AuthContext;
  tokenId: string;
  scopes: string[];
}

/** One message for every way a token can be wrong, so a prober learns nothing from the difference. */
function badToken(): UnauthorizedError {
  return new UnauthorizedError("The API token is missing, invalid, expired or revoked.");
}

/**
 * Authenticates a public API request and returns the owning membership's context. The order matters: the cheap checks and the address
 * limit come first, so a flood of bad tokens costs one counter row each and never reaches a membership lookup.
 *
 * `scope` is the one the route needs (`companies:read`). A token without it is refused with an explained 403; a token whose owner no longer
 * has access is refused with the same 401 as a wrong token.
 */
export async function authenticateApiToken(request: Request, scope: string, options: { skipScope?: boolean } = {}): Promise<ApiTokenAuth> {
  const address = clientAddress(request);
  await enforceRateLimit("API_TOKEN", [{ scope: "ip", key: address, windowMs: RATE_WINDOW_MS, max: API_RATE_LIMIT_PER_ADDRESS }]);

  const plaintext = bearerTokenFrom(request);
  if (!plaintext || !plaintext.startsWith(API_TOKEN_PREFIX) || plaintext.length > 200) throw badToken();

  const token = await adminDb.apiToken.findUnique({ where: { tokenHash: hashApiToken(plaintext) } });
  if (!token || token.revokedAt || (token.expiresAt && token.expiresAt.getTime() <= Date.now())) throw badToken();

  // The per-token limit uses the token's id, never the secret.
  await enforceRateLimit("API_TOKEN", [{ scope: "token", key: token.id, windowMs: RATE_WINDOW_MS, max: API_RATE_LIMIT_PER_TOKEN }]);

  const membershipRow = await adminDb.membership.findUnique({ where: { id: token.membershipId }, select: { userId: true, organizationId: true } });
  if (!membershipRow || membershipRow.organizationId !== token.organizationId) throw badToken();
  // Suspended and offboarded organisations throw from here; a removed or deactivated person gives null.
  const ctx = await resolveActiveMembership(membershipRow.userId, token.organizationId);
  if (!ctx || ctx.membershipId !== token.membershipId) throw badToken();

  // The public API belongs to release V2; an organisation below it gets the explained "not available yet" answer.
  await requireFeature(token.organizationId, "release.v2");

  if (!options.skipScope && !token.scopes.includes(scope)) {
    throw new ForbiddenError(`token scope ${scope}`, { roleKey: ctx.roleKey, organizationId: ctx.organizationId, permissionKeys: [scope] });
  }

  if (!token.lastUsedAt || Date.now() - token.lastUsedAt.getTime() > LAST_USED_GRANULARITY_MS) {
    // Best effort: a failed bookkeeping write must not fail the request.
    await withOrgContext(token.organizationId, (tx) => tx.apiToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } })).catch(() => undefined);
  }

  return { ctx, tokenId: token.id, scopes: token.scopes };
}
