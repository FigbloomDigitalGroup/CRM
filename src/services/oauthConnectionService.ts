import { createHash, randomBytes } from "node:crypto";
import type { OAuthConnection } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { hasPermission, requirePermission } from "../auth/context";
import { NotFoundError, ValidationError } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import { getOAuthProvider } from "../integrations/oauth/providers";
import { OAuthInvalidGrantError, SCOPES, type ConnectionKind, type OAuthProviderKey, type TokenSet } from "../integrations/oauth/types";
import { hashToken, openSecret, sealSecret } from "../lib/secretBox";
import { recordAuditEvent } from "../repositories/auditEvents";
import { requireFeature } from "./featureService";

/**
 * OAuth connections for email and calendar (FIG-1153, B6.21).
 *
 * A person connects their own Google or Microsoft mailbox or calendar. Management may connect one shared organisation
 * mailbox per kind (`shared: true`). The flow is authorization-code with PKCE; the `state` is one-time, bound to the person
 * and organisation that started it, and only its hash is stored. Tokens are encrypted at rest (`src/lib/secretBox.ts`),
 * never returned by any API and never logged. Disconnecting revokes at the provider (best effort), wipes the tokens and
 * marks the connection REVOKED; every sync entry point goes through `getUsableConnection`, which refuses anything that is
 * not CONNECTED, so a revoked connection stops syncing at once.
 */
export const STATE_TTL_MS = 10 * 60_000;
/** An access token is refreshed when it has less than this left. */
export const REFRESH_MARGIN_MS = 2 * 60_000;

const KIND_PERMISSION: Record<ConnectionKind, string> = { EMAIL: "communications.create", CALENDAR: "activities.create" };
const KINDS: ConnectionKind[] = ["EMAIL", "CALENDAR"];
const PROVIDERS: OAuthProviderKey[] = ["GOOGLE", "MICROSOFT"];

export type ConnectionState = "CONNECTED" | "NEEDS_RECONNECT" | "DISCONNECTED";

export interface ConnectionView {
  id: string | null;
  kind: ConnectionKind;
  provider: OAuthProviderKey | null;
  state: ConnectionState;
  /** Why it is in this state, in a sentence the screen can show. */
  stateReason: string;
  accountEmail: string | null;
  shared: boolean;
  mine: boolean;
  scopes: string[];
  connectedAt: Date | null;
  lastSyncedAt: Date | null;
  lastError: { at: Date | null; message: string } | null;
  settings: Record<string, unknown>;
}

/** A connection is unusable (disconnected, revoked or the provider refused it): the caller shows the disconnected state. */
export class ConnectionUnavailableError extends ValidationError {
  constructor(readonly state: ConnectionState, message: string) {
    super(message, [{ path: "connection", message, code: state === "NEEDS_RECONNECT" ? "CONNECTION_NEEDS_RECONNECT" : "CONNECTION_NOT_CONNECTED" }]);
  }
}

function assertKind(kind: string): asserts kind is ConnectionKind {
  if (!KINDS.includes(kind as ConnectionKind)) throw new ValidationError("Choose email or calendar.", [{ path: "kind", message: "Use EMAIL or CALENDAR." }]);
}
function assertProvider(provider: string): asserts provider is OAuthProviderKey {
  if (!PROVIDERS.includes(provider as OAuthProviderKey)) throw new ValidationError("Choose Google or Microsoft.", [{ path: "provider", message: "Use GOOGLE or MICROSOFT." }]);
}

function redirectUriFor(): string {
  return `${process.env.APP_BASE_URL ?? "http://localhost:3000"}/api/integrations/oauth/callback`;
}

const pkceChallenge = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

function toView(c: OAuthConnection, ctx: Pick<AuthContext, "membershipId">): ConnectionView {
  const state: ConnectionState = c.status === "CONNECTED" ? "CONNECTED" : c.status === "NEEDS_RECONNECT" ? "NEEDS_RECONNECT" : "DISCONNECTED";
  return {
    id: c.id,
    kind: c.kind as ConnectionKind,
    provider: c.provider as OAuthProviderKey,
    state,
    stateReason:
      state === "CONNECTED"
        ? "Connected."
        : state === "NEEDS_RECONNECT"
          ? "The provider no longer accepts this connection. Connect again to keep syncing."
          : "Disconnected. Access was revoked.",
    accountEmail: c.accountEmail,
    shared: c.membershipId === null,
    mine: c.membershipId === ctx.membershipId,
    scopes: c.scopes,
    connectedAt: c.connectedAt,
    lastSyncedAt: c.lastSyncedAt,
    lastError: c.lastError ? { at: c.lastErrorAt, message: c.lastError } : null,
    settings: (c.settings ?? {}) as Record<string, unknown>,
  };
}

function disconnectedView(kind: ConnectionKind): ConnectionView {
  return {
    id: null,
    kind,
    provider: null,
    state: "DISCONNECTED",
    stateReason: kind === "EMAIL" ? "No mailbox is connected." : "No calendar is connected.",
    accountEmail: null,
    shared: false,
    mine: false,
    scopes: [],
    connectedAt: null,
    lastSyncedAt: null,
    lastError: null,
    settings: {},
  };
}

/** Step 1: where to send the person. Returns the provider's authorisation URL; nothing is stored but the hashed state. */
export async function startConnection(ctx: AuthContext, input: { kind: string; provider: string; shared?: boolean; loginHint?: string }) {
  assertKind(input.kind);
  assertProvider(input.provider);
  await requireFeature(ctx.organizationId, "integrations.enabled");
  requirePermission(ctx, KIND_PERMISSION[input.kind]);
  const shared = input.shared === true;
  if (shared) requirePermission(ctx, "configuration.manage");

  const state = randomBytes(32).toString("base64url");
  const codeVerifier = randomBytes(48).toString("base64url");
  const scopes = SCOPES[input.provider][input.kind];
  const provider = getOAuthProvider(input.provider);
  const authorizationUrl = provider.buildAuthorizationUrl({
    state,
    codeChallenge: pkceChallenge(codeVerifier),
    scopes,
    redirectUri: redirectUriFor(),
    loginHint: input.loginHint,
  });
  await adminDb.oAuthState.create({
    data: {
      organizationId: ctx.organizationId,
      membershipId: ctx.membershipId,
      kind: input.kind,
      provider: input.provider,
      shared,
      stateHash: hashToken(state),
      codeVerifierEnc: sealSecret(codeVerifier),
      scopes,
      expiresAt: new Date(Date.now() + STATE_TTL_MS),
    },
  });
  // Old, unused authorisations are not kept.
  await adminDb.oAuthState.deleteMany({ where: { organizationId: ctx.organizationId, expiresAt: { lt: new Date(Date.now() - 24 * 3_600_000) } } });
  return { authorizationUrl, expiresInSeconds: STATE_TTL_MS / 1000, scopes };
}

/**
 * Step 2: the provider sent the person back with a `code` and our `state`. The state must exist, be unused and unexpired, and
 * belong to this person in this organisation, otherwise it is refused as if it had never existed (no hint which part failed).
 */
export async function completeConnection(ctx: AuthContext, input: { state: string; code: string }) {
  const refused = () => new ValidationError("This sign-in link is not valid any more. Start the connection again.", [{ path: "state", message: "Start the connection again.", code: "OAUTH_STATE_INVALID" }]);
  if (!input.state || !input.code) throw refused();
  const row = await adminDb.oAuthState.findUnique({ where: { stateHash: hashToken(input.state) } });
  if (!row || row.organizationId !== ctx.organizationId || row.membershipId !== ctx.membershipId || row.consumedAt || row.expiresAt <= new Date()) throw refused();
  // One use only: the update succeeds for exactly one caller.
  const claimed = await adminDb.oAuthState.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: new Date() } });
  if (claimed.count !== 1) throw refused();

  const kind = row.kind as ConnectionKind;
  const providerKey = row.provider as OAuthProviderKey;
  await requireFeature(ctx.organizationId, "integrations.enabled");
  requirePermission(ctx, KIND_PERMISSION[kind]);
  if (row.shared) requirePermission(ctx, "configuration.manage");

  const tokens = await getOAuthProvider(providerKey).exchangeCode({
    code: input.code,
    codeVerifier: openSecret(row.codeVerifierEnc),
    redirectUri: redirectUriFor(),
  });
  if (!tokens.refreshToken) {
    throw new ValidationError("The provider did not allow offline access, so Figbloom cannot keep syncing. Connect again and accept all the requested access.", [
      { path: "code", message: "No refresh token was granted.", code: "OAUTH_NO_REFRESH_TOKEN" },
    ]);
  }
  const membershipId = row.shared ? null : ctx.membershipId;
  const data = {
    provider: providerKey,
    status: "CONNECTED",
    accountEmail: tokens.accountEmail ?? null,
    scopes: tokens.scopes?.length ? tokens.scopes : row.scopes,
    accessTokenEnc: sealSecret(tokens.accessToken),
    refreshTokenEnc: sealSecret(tokens.refreshToken),
    tokenExpiresAt: new Date(Date.now() + tokens.expiresInSeconds * 1000),
    lastRefreshedAt: new Date(),
    connectedAt: new Date(),
    lastError: null,
    lastErrorAt: null,
  };
  const live = await adminDb.oAuthConnection.findFirst({ where: { organizationId: ctx.organizationId, membershipId, kind, revokedAt: null } });
  // Connecting again replaces the live connection in place (a changed provider or account starts a fresh sync cursor).
  const connection = live
    ? await adminDb.oAuthConnection.update({
        where: { id: live.id },
        data: { ...data, ...(live.provider !== providerKey || live.accountEmail !== data.accountEmail ? { syncCursor: null } : {}) },
      })
    : await adminDb.oAuthConnection.create({ data: { ...data, organizationId: ctx.organizationId, membershipId, kind } });
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "oauth.connected",
    entityType: "OAuthConnection",
    entityId: connection.id,
    metadata: { kind, provider: providerKey, shared: row.shared, scopes: connection.scopes },
  });
  return toView(connection, ctx);
}

/**
 * The provider sends the browser back to one fixed address, so the callback route has to find the organisation from the
 * `state` before it can resolve the session. Only the slug is returned, and only for a state that is still open.
 */
export async function organizationSlugForState(state: string): Promise<string | null> {
  if (!state) return null;
  const row = await adminDb.oAuthState.findUnique({ where: { stateHash: hashToken(state) } });
  if (!row || row.consumedAt || row.expiresAt <= new Date()) return null;
  const org = await adminDb.organization.findUnique({ where: { id: row.organizationId }, select: { slug: true } });
  return org?.slug ?? null;
}

/**
 * The state of each connection kind for this person: their own connection, else the shared organisation one, else a clear
 * DISCONNECTED entry. Screens (Preferences, Mail, Video) read this. Tokens are never part of it.
 */
export async function listConnections(ctx: AuthContext) {
  const rows = await adminDb.oAuthConnection.findMany({
    where: {
      organizationId: ctx.organizationId,
      OR: [{ membershipId: ctx.membershipId }, { membershipId: null }],
      // A revoked row stays as history; it is shown only when nothing live replaced it.
    },
    orderBy: { createdAt: "desc" },
  });
  const canSeeEmail = hasPermission(ctx, "communications.view") || hasPermission(ctx, "communications.create");
  const canSeeCalendar = hasPermission(ctx, "activities.view") || hasPermission(ctx, "activities.create");
  const items: ConnectionView[] = [];
  for (const kind of KINDS) {
    if (kind === "EMAIL" && !canSeeEmail) continue;
    if (kind === "CALENDAR" && !canSeeCalendar) continue;
    const ofKind = rows.filter((r) => r.kind === kind);
    const live = ofKind.filter((r) => r.revokedAt === null);
    const pick = live.find((r) => r.membershipId === ctx.membershipId) ?? live.find((r) => r.membershipId === null) ?? ofKind[0];
    items.push(pick ? toView(pick, ctx) : disconnectedView(kind));
  }
  return { items };
}

/** Management's view of every live connection in the organisation (who is connected, nothing secret). */
export async function listOrganizationConnections(ctx: AuthContext) {
  requirePermission(ctx, "configuration.manage");
  const rows = await adminDb.oAuthConnection.findMany({
    where: { organizationId: ctx.organizationId, revokedAt: null },
    orderBy: { createdAt: "asc" },
  });
  const members = await adminDb.membership.findMany({
    where: { organizationId: ctx.organizationId, id: { in: rows.map((r) => r.membershipId).filter((x): x is string => !!x) } },
    select: { id: true, user: { select: { name: true } } },
  });
  const names = new Map(members.map((m) => [m.id, m.user.name]));
  return { items: rows.map((r) => ({ ...toView(r, ctx), memberName: r.membershipId ? (names.get(r.membershipId) ?? null) : "Shared organisation mailbox" })) };
}

async function loadOwned(ctx: AuthContext, id: string): Promise<OAuthConnection> {
  const row = await adminDb.oAuthConnection.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!row) throw new NotFoundError("Connection", id);
  const mine = row.membershipId === ctx.membershipId;
  // Someone else's connection is invisible to a member; Management may see and revoke any (a leaver's, the shared one).
  if (!mine && !hasPermission(ctx, "configuration.manage")) throw new NotFoundError("Connection", id);
  return row;
}

/** Revokes at the provider (best effort), wipes the tokens, marks REVOKED. Sync stops at once. */
export async function disconnectConnection(ctx: AuthContext, id: string) {
  const row = await loadOwned(ctx, id);
  if (row.revokedAt) return toView(row, ctx);
  if (row.refreshTokenEnc) {
    try {
      await getOAuthProvider(row.provider as OAuthProviderKey).revoke(openSecret(row.refreshTokenEnc));
    } catch {
      /* the local revoke below is what stops the sync; the provider call is a courtesy */
    }
  }
  const updated = await adminDb.oAuthConnection.update({
    where: { id: row.id },
    data: { status: "REVOKED", revokedAt: new Date(), accessTokenEnc: null, refreshTokenEnc: null, tokenExpiresAt: null, syncCursor: null },
  });
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "oauth.disconnected",
    entityType: "OAuthConnection",
    entityId: row.id,
    metadata: { kind: row.kind, provider: row.provider, byOwner: row.membershipId === ctx.membershipId },
  });
  return toView(updated, ctx);
}

/** What a person may change on their own connection: the calendar to use, the mail exclusion list. Merged into `settings`. */
export async function updateConnectionSettings(ctx: AuthContext, id: string, patch: Record<string, unknown>) {
  const row = await loadOwned(ctx, id);
  if (row.revokedAt) throw new ConnectionUnavailableError("DISCONNECTED", "This connection was disconnected.");
  const updated = await adminDb.oAuthConnection.update({ where: { id: row.id }, data: { settings: { ...((row.settings ?? {}) as object), ...patch } as never } });
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "oauth.settings_updated",
    entityType: "OAuthConnection",
    entityId: row.id,
    metadata: { keys: Object.keys(patch) },
  });
  return toView(updated, ctx);
}

// ---------------------------------------------------------------------------
// Used by sync and send code (never by a route): a usable connection and a valid access token.
// ---------------------------------------------------------------------------

async function recordError(id: string, message: string, status?: "NEEDS_RECONNECT") {
  await adminDb.oAuthConnection.update({ where: { id }, data: { lastError: message.slice(0, 300), lastErrorAt: new Date(), ...(status ? { status } : {}) } });
}

/** A CONNECTED connection of this organisation, or `ConnectionUnavailableError` (the disconnected state the screens show). */
export async function getUsableConnection(organizationId: string, id: string): Promise<OAuthConnection> {
  const row = await adminDb.oAuthConnection.findFirst({ where: { id, organizationId } });
  if (!row || row.revokedAt || row.status === "REVOKED") throw new ConnectionUnavailableError("DISCONNECTED", "This account is disconnected.");
  if (row.status === "NEEDS_RECONNECT") throw new ConnectionUnavailableError("NEEDS_RECONNECT", "The provider no longer accepts this connection. Connect again.");
  return row;
}

/** The connection a person sends or syncs with: their own live one, else the shared organisation one. */
export async function findConnectionFor(organizationId: string, membershipId: string, kind: ConnectionKind): Promise<OAuthConnection | null> {
  const rows = await adminDb.oAuthConnection.findMany({ where: { organizationId, kind, revokedAt: null, OR: [{ membershipId }, { membershipId: null }] } });
  return rows.find((r) => r.membershipId === membershipId) ?? rows[0] ?? null;
}

/**
 * A decrypted access token that is good for at least a couple of minutes, refreshing (and storing the new, encrypted, token) when
 * needed. A provider that refuses the refresh token for good moves the connection to NEEDS_RECONNECT and stops further attempts.
 */
export async function getAccessToken(organizationId: string, connectionId: string): Promise<{ token: string; connection: OAuthConnection }> {
  const row = await getUsableConnection(organizationId, connectionId);
  if (row.accessTokenEnc && row.tokenExpiresAt && row.tokenExpiresAt.getTime() - Date.now() > REFRESH_MARGIN_MS) {
    return { token: openSecret(row.accessTokenEnc), connection: row };
  }
  if (!row.refreshTokenEnc) {
    await recordError(row.id, "No refresh token is stored.", "NEEDS_RECONNECT");
    throw new ConnectionUnavailableError("NEEDS_RECONNECT", "The provider no longer accepts this connection. Connect again.");
  }
  let tokens: TokenSet;
  try {
    tokens = await getOAuthProvider(row.provider as OAuthProviderKey).refresh(openSecret(row.refreshTokenEnc));
  } catch (err) {
    if (err instanceof OAuthInvalidGrantError) {
      await recordError(row.id, "The provider refused the stored access. Connect again.", "NEEDS_RECONNECT");
      await recordAuditEvent({
        organizationId,
        actorMembershipId: undefined,
        action: "oauth.needs_reconnect",
        entityType: "OAuthConnection",
        entityId: row.id,
        metadata: { kind: row.kind, provider: row.provider },
      });
      throw new ConnectionUnavailableError("NEEDS_RECONNECT", "The provider no longer accepts this connection. Connect again.");
    }
    await recordError(row.id, "The provider could not be reached. It will be tried again.");
    throw err;
  }
  const updated = await adminDb.oAuthConnection.update({
    where: { id: row.id },
    data: {
      accessTokenEnc: sealSecret(tokens.accessToken),
      // A refresh may rotate the refresh token; when it does not, the old one stays.
      ...(tokens.refreshToken ? { refreshTokenEnc: sealSecret(tokens.refreshToken) } : {}),
      tokenExpiresAt: new Date(Date.now() + tokens.expiresInSeconds * 1000),
      lastRefreshedAt: new Date(),
      lastError: null,
      lastErrorAt: null,
    },
  });
  return { token: tokens.accessToken, connection: updated };
}

/** Marks a sync as done (or failed) for the status the person sees. */
export async function recordSyncResult(connectionId: string, result: { ok: true; cursor?: string | null } | { ok: false; message: string }) {
  if (result.ok) {
    await adminDb.oAuthConnection.update({
      where: { id: connectionId },
      data: { lastSyncedAt: new Date(), lastError: null, lastErrorAt: null, ...(result.cursor !== undefined ? { syncCursor: result.cursor } : {}) },
    });
  } else {
    await recordError(connectionId, result.message);
  }
}

/** The scheduled job: refreshes tokens that expire soon so a sync never starts with a dead token. Returns counts only. */
export async function refreshExpiringConnections(organizationId: string) {
  const soon = new Date(Date.now() + 10 * 60_000);
  const rows = await adminDb.oAuthConnection.findMany({
    where: { organizationId, status: "CONNECTED", revokedAt: null, tokenExpiresAt: { lt: soon } },
    select: { id: true },
  });
  let refreshed = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      await getAccessToken(organizationId, r.id);
      refreshed += 1;
    } catch {
      failed += 1;
    }
  }
  return { checked: rows.length, refreshed, failed };
}
