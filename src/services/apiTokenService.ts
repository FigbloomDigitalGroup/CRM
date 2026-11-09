import type { AuthContext } from "../auth/context";
import { hasPermission } from "../auth/context";
import { API_SCOPES, generateApiToken } from "../auth/apiToken";
import { NotFoundError, ValidationError } from "../auth/errors";
import { withOrgContext } from "../db/orgScopedClient";
import { recordAuditEvent } from "../repositories/auditEvents";
import { requireFeature } from "./featureService";

/**
 * Management of personal API tokens (FIG-805). Any member may create tokens for themselves; a token runs as its creator and can never do
 * more than they can. A person with `organization.manage_settings` (Management) sees every token of the organisation and may revoke any.
 * The plain token is returned once, by `createApiToken`, and never again; the audit trail records who made or revoked which token, never
 * the token itself.
 */

export const MAX_ACTIVE_TOKENS_PER_MEMBER = 25;
export const DEFAULT_TOKEN_LIFETIME_DAYS = 90;
export const MAX_TOKEN_LIFETIME_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CreateApiTokenInput {
  name: string;
  scopes: string[];
  /** Days until it stops working; 1 to 365, default 90. A token never lives forever. */
  expiresInDays?: number;
}

function isAdmin(ctx: AuthContext): boolean {
  return hasPermission(ctx, "organization.manage_settings");
}

function toView(row: {
  id: string;
  membershipId: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}, ownerName: string | null = null) {
  const now = Date.now();
  return {
    id: row.id,
    membershipId: row.membershipId,
    ownerName,
    name: row.name,
    tokenPrefix: row.tokenPrefix,
    scopes: row.scopes,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    status: row.revokedAt ? ("REVOKED" as const) : row.expiresAt && row.expiresAt.getTime() <= now ? ("EXPIRED" as const) : ("ACTIVE" as const),
  };
}

export async function createApiToken(ctx: AuthContext, input: CreateApiTokenInput) {
  await requireFeature(ctx.organizationId, "release.v2");
  const name = input.name?.trim() ?? "";
  if (name.length < 1 || name.length > 80) throw new ValidationError("Give the token a name of 1 to 80 characters.", [{ path: "name", message: "Give the token a name of 1 to 80 characters." }]);
  const scopes = [...new Set(input.scopes ?? [])];
  const unknown = scopes.filter((s) => !API_SCOPES.includes(s));
  if (scopes.length === 0 || unknown.length > 0) {
    const message = scopes.length === 0 ? "Choose at least one scope." : `Unknown scope: ${unknown.join(", ")}.`;
    throw new ValidationError(message, [{ path: "scopes", message }]);
  }
  const days = input.expiresInDays ?? DEFAULT_TOKEN_LIFETIME_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > MAX_TOKEN_LIFETIME_DAYS) {
    const message = `A token lasts 1 to ${MAX_TOKEN_LIFETIME_DAYS} days.`;
    throw new ValidationError(message, [{ path: "expiresInDays", message }]);
  }
  const now = new Date();
  const generated = generateApiToken();
  const row = await withOrgContext(ctx.organizationId, async (tx) => {
    const active = await tx.apiToken.count({
      where: { organizationId: ctx.organizationId, membershipId: ctx.membershipId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    });
    if (active >= MAX_ACTIVE_TOKENS_PER_MEMBER) {
      throw new ValidationError(`You already have ${MAX_ACTIVE_TOKENS_PER_MEMBER} active tokens. Revoke one you no longer use.`);
    }
    return tx.apiToken.create({
      data: {
        organizationId: ctx.organizationId,
        membershipId: ctx.membershipId,
        name,
        tokenPrefix: generated.tokenPrefix,
        tokenHash: generated.tokenHash,
        scopes,
        expiresAt: new Date(now.getTime() + days * DAY_MS),
      },
    });
  });
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "api_token.created",
    entityType: "ApiToken",
    entityId: row.id,
    newValue: { name, scopes, expiresAt: row.expiresAt?.toISOString() ?? null, tokenPrefix: row.tokenPrefix },
  });
  // The one and only time the plain token leaves the server.
  return { ...toView(row), token: generated.plaintext };
}

export async function listApiTokens(ctx: AuthContext) {
  await requireFeature(ctx.organizationId, "release.v2");
  const admin = isAdmin(ctx);
  const rows = await withOrgContext(ctx.organizationId, (tx) =>
    tx.apiToken.findMany({
      where: { organizationId: ctx.organizationId, ...(admin ? {} : { membershipId: ctx.membershipId }) },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
  );
  const ids = [...new Set(rows.map((r) => r.membershipId))];
  const owners = ids.length
    ? await withOrgContext(ctx.organizationId, (tx) =>
        tx.membership.findMany({ where: { organizationId: ctx.organizationId, id: { in: ids } }, select: { id: true, user: { select: { name: true, email: true } } } }),
      )
    : [];
  const names = new Map(owners.map((m) => [m.id, m.user?.name ?? m.user?.email ?? null]));
  return { items: rows.map((r) => toView(r, names.get(r.membershipId) ?? null)), scope: admin ? ("organisation" as const) : ("own" as const) };
}

export async function revokeApiToken(ctx: AuthContext, tokenId: string) {
  await requireFeature(ctx.organizationId, "release.v2");
  const row = await withOrgContext(ctx.organizationId, (tx) => tx.apiToken.findFirst({ where: { id: tokenId, organizationId: ctx.organizationId } }));
  if (!row) throw new NotFoundError("API token", tokenId);
  if (row.membershipId !== ctx.membershipId && !isAdmin(ctx)) {
    // Someone else's token is not even confirmed to exist.
    throw new NotFoundError("API token", tokenId);
  }
  if (row.revokedAt) return toView(row);
  const updated = await withOrgContext(ctx.organizationId, (tx) =>
    tx.apiToken.update({ where: { id: row.id }, data: { revokedAt: new Date(), revokedByMembershipId: ctx.membershipId } }),
  );
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "api_token.revoked",
    entityType: "ApiToken",
    entityId: row.id,
    metadata: { name: row.name, ownedByActor: row.membershipId === ctx.membershipId },
  });
  return toView(updated);
}

/** Revokes every token a membership owns (used when a person is removed; their tokens stop at the membership check anyway). */
export async function revokeTokensOfMembership(organizationId: string, membershipId: string): Promise<number> {
  const result = await withOrgContext(organizationId, (tx) =>
    tx.apiToken.updateMany({ where: { organizationId, membershipId, revokedAt: null }, data: { revokedAt: new Date() } }),
  );
  return result.count;
}

