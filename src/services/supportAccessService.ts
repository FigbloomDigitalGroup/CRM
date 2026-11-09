import type { SupportAccessGrant } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { NotFoundError, ValidationError } from "../auth/errors";
import type { PlatformContext } from "../auth/platformSession";
import { adminDb } from "../db/adminClient";
import { withOrgContext } from "../db/orgScopedClient";
import { getPlatformDb } from "../db/platformClient";
import { loadFeatureConfig } from "../lib/featureConfig";
import { releaseAtLeast } from "../lib/featureFlags";
import { ApiError } from "../lib/apiErrors";
import { logger } from "../lib/logger";
import { recordAuditEvent } from "../repositories/auditEvents";
import { notifyEvent } from "./notificationService";
import { recordPlatformAudit } from "./platformAuditService";

/**
 * Support access, the break-glass for customer data (FIG-1183, B7.01; screens PL7, OS2, OS3, OS4).
 * Requirements R1 to R12 are in docs/SECURITY_REVIEW_PLATFORM_CONSOLE.md section 5; how each is met is in
 * docs/M17_LANE_A_SUPPORT_FLAGS_ANNOUNCEMENTS.md.
 *
 *   PENDING   --organisation approves-->  APPROVED  --the requesting admin opens it (fresh second step)-->  ACTIVE  --> ENDED
 *   PENDING   --organisation denies-->    DENIED
 *   PENDING or APPROVED  --the admin withdraws-->  CANCELLED
 *   anything open that is not used in time  -->  EXPIRED   (a request lapses after 24 hours, an approval after one hour unopened,
 *                                                          a session when its window ends: 30, 60 or 120 minutes)
 *
 * Who may make which move is enforced by a trigger on the table, by the database role making the change, so a bug here cannot turn a
 * request into a session without the organisation's approval. What a session can read is one SQL function (`support_access_read`) that
 * checks the grant, the clock and the scope, selects only named, masked columns, and writes the page-view log the organisation reads.
 * The platform has no other path to a tenant record.
 */

export const SUPPORT_SCOPES = ["COMPANIES", "CONTACTS", "LEADS", "DEALS", "TASKS"] as const;
export type SupportScope = (typeof SUPPORT_SCOPES)[number];
export const SUPPORT_DURATIONS = [30, 60, 120] as const;
/** A request waits this long for the organisation, an approval this long to be opened. */
export const REQUEST_VALID_HOURS = 24;
export const APPROVAL_VALID_MINUTES = 60;
export const REASON_MIN = 10;
export const REASON_MAX = 500;
const MIN_MS = 60_000;

export type SupportStatus = "PENDING" | "APPROVED" | "ACTIVE" | "DENIED" | "ENDED" | "EXPIRED" | "CANCELLED";

/** The status as of `now`: a record the clock has overtaken reads EXPIRED before any job has marked it. */
export function effectiveStatus(g: Pick<SupportAccessGrant, "status" | "requestExpiresAt" | "decidedAt" | "endsAt">, now: Date = new Date()): SupportStatus {
  const status = g.status as SupportStatus;
  if (status === "PENDING" && now >= g.requestExpiresAt) return "EXPIRED";
  if (status === "APPROVED" && g.decidedAt && now.getTime() - g.decidedAt.getTime() > APPROVAL_VALID_MINUTES * MIN_MS) return "EXPIRED";
  if (status === "ACTIVE" && g.endsAt && now >= g.endsAt) return "EXPIRED";
  return status;
}

export function presentGrant(g: SupportAccessGrant, now: Date = new Date()) {
  const status = effectiveStatus(g, now);
  return {
    id: g.id,
    organizationId: g.organizationId,
    status,
    requestedBy: g.requestedByLabel,
    reason: g.reason,
    ticketReference: g.ticketReference,
    scope: g.scope as SupportScope[],
    durationMinutes: g.durationMinutes,
    unmaskContactDetails: g.unmaskContactDetails,
    requestedAt: g.requestedAt.toISOString(),
    requestExpiresAt: g.requestExpiresAt.toISOString(),
    decidedAt: g.decidedAt?.toISOString() ?? null,
    decidedBy: g.decidedByLabel,
    decisionNote: g.decisionNote,
    startsAt: g.startsAt?.toISOString() ?? null,
    endsAt: g.endsAt?.toISOString() ?? null,
    endedAt: g.endedAt?.toISOString() ?? null,
    endedBy: g.endedByLabel,
    endReason: g.endReason,
    /** Seconds left in a running session, for the countdown; null otherwise. */
    secondsLeft: status === "ACTIVE" && g.endsAt ? Math.max(0, Math.floor((g.endsAt.getTime() - now.getTime()) / 1000)) : null,
  };
}

/**
 * The platform role has no privilege on the grants table (it carries an organisation id), so every platform-side read and write goes
 * through one of the `support_access_*` database functions, which return the table's row type in snake case.
 */
interface GrantRow {
  id: string;
  organization_id: string;
  requested_by_identity_id: string;
  requested_by_label: string;
  reason: string;
  ticket_reference: string;
  scope: string[];
  duration_minutes: number;
  unmask_contact_details: boolean;
  status: string;
  requested_at: Date;
  request_expires_at: Date;
  decided_at: Date | null;
  decided_by_membership_id: string | null;
  decided_by_label: string | null;
  decision_note: string | null;
  opened_at: Date | null;
  opened_by_identity_id: string | null;
  starts_at: Date | null;
  ends_at: Date | null;
  ended_at: Date | null;
  ended_by_label: string | null;
  end_reason: string | null;
  updated_at: Date;
}

function fromRow(r: GrantRow): SupportAccessGrant {
  return {
    id: r.id,
    organizationId: r.organization_id,
    requestedByIdentityId: r.requested_by_identity_id,
    requestedByLabel: r.requested_by_label,
    reason: r.reason,
    ticketReference: r.ticket_reference,
    scope: r.scope,
    durationMinutes: r.duration_minutes,
    unmaskContactDetails: r.unmask_contact_details,
    status: r.status,
    requestedAt: r.requested_at,
    requestExpiresAt: r.request_expires_at,
    decidedAt: r.decided_at,
    decidedByMembershipId: r.decided_by_membership_id,
    decidedByLabel: r.decided_by_label,
    decisionNote: r.decision_note,
    openedAt: r.opened_at,
    openedByIdentityId: r.opened_by_identity_id,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    endedAt: r.ended_at,
    endedByLabel: r.ended_by_label,
    endReason: r.end_reason,
    updatedAt: r.updated_at,
  };
}

interface ViewRow {
  id: string;
  viewed_at: Date;
  identity_label: string;
  resource: string;
  page_offset: number;
  row_count: number;
}

function oneLine(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
}

/** The message a database trigger raised, or null when the error is something else. */
function triggerMessage(err: unknown): string | null {
  const text = err instanceof Error ? err.message : "";
  if (/support_access_grants_one_open_per_organization/.test(text) || (err as { code?: string } | null)?.code === "P2002" || (err as { meta?: { code?: string } } | null)?.meta?.code === "23505") return "OPEN";
  const m = /(A support access [^\n`]*|What was asked for [^\n`]*|The decision and the window[^\n`]*|The approval is older[^\n`]*|The window must[^\n`]*|A decision names[^\n`]*|Only the platform asks[^\n`]*)/.exec(text);
  return m ? m[1]!.trim() : null;
}

function refusal(err: unknown): never {
  const message = triggerMessage(err);
  if (message === "OPEN") {
    throw new ValidationError("This organisation already has an open support request. Wait for it to be decided, or end it first.", [
      { path: "organizationId", message: "A request is already open.", code: "REQUEST_OPEN" },
    ]);
  }
  if (message) throw new ValidationError(message, [{ path: "status", message, code: "INVALID_TRANSITION" }]);
  throw err;
}

async function organisationBasics(organizationId: string) {
  const rows = await getPlatformDb().$queryRaw<{ organization_id: string; slug: string; name: string; status: string }[]>`
    SELECT organization_id, slug, name, status FROM platform_organization_counts WHERE organization_id = ${organizationId}`;
  const org = rows[0];
  if (!org) throw new NotFoundError("Organization", organizationId);
  return org;
}

/** Every active Management member is told (in the app, and by email under their own notification settings). Best effort: never throws. */
async function notifyManagement(organizationId: string, slug: string, title: string, body: string, grantId: string) {
  try {
    const members = await adminDb.membership.findMany({
      where: { organizationId, status: "ACTIVE", role: { key: "MANAGEMENT" } },
      select: { id: true },
    });
    for (const m of members) {
      await notifyEvent({
        organizationId,
        membershipId: m.id,
        type: "SUPPORT_ACCESS_REQUEST",
        title,
        body,
        entityType: "SupportAccessGrant",
        entityId: grantId,
        path: `/o/${slug}/settings?tab=supportaccess`,
      });
    }
  } catch (err) {
    logger.warn({ err, organizationId, grantId }, "Support access: telling Management failed");
  }
}

// ---------------------------------------------------------------------------
// The platform's side (PL7)
// ---------------------------------------------------------------------------

type Actor = Pick<PlatformContext, "identityId" | "email">;

export interface SupportRequestInput {
  organizationId: string;
  reason: string;
  ticketReference: string;
  scope: string[];
  durationMinutes: number;
  /** Ask to see contact emails and phone numbers unmasked. A separate, rarer approval (R5); money is never shown either way. */
  unmaskContactDetails?: boolean;
}

export async function requestSupportAccess(actor: Actor, input: SupportRequestInput, options: { requestId?: string | null; now?: Date } = {}) {
  const now = options.now ?? new Date();
  const reason = oneLine(typeof input.reason === "string" ? input.reason : "");
  const ticket = oneLine(typeof input.ticketReference === "string" ? input.ticketReference : "");
  const problems: { path: string; message: string }[] = [];
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) problems.push({ path: "reason", message: `Say why, in ${REASON_MIN} to ${REASON_MAX} characters. Do not paste customer data.` });
  if (!/^[A-Za-z0-9][A-Za-z0-9 _#/.-]{2,59}$/.test(ticket)) problems.push({ path: "ticketReference", message: "Give the support ticket reference (3 to 60 letters, digits or - _ # / .)." });
  const scope = [...new Set(Array.isArray(input.scope) ? input.scope : [])];
  if (scope.length === 0 || scope.some((s) => !(SUPPORT_SCOPES as readonly string[]).includes(s))) {
    problems.push({ path: "scope", message: `Choose what support may look at: ${SUPPORT_SCOPES.join(", ")}.` });
  }
  if (!(SUPPORT_DURATIONS as readonly number[]).includes(input.durationMinutes)) problems.push({ path: "durationMinutes", message: "Choose 30, 60 or 120 minutes." });
  if (problems.length > 0) throw new ValidationError("Check the request.", problems);

  const org = await organisationBasics(input.organizationId);
  if (org.status !== "ACTIVE") {
    throw new ValidationError(`Support access can only be requested for an active organisation (this one is ${org.status.toLowerCase()}).`, [{ path: "organizationId", message: "Not active." }]);
  }
  const config = await loadFeatureConfig(input.organizationId);
  if (!releaseAtLeast(config.release, "v2")) {
    throw new ValidationError("This organisation is not on a release that has support access.", [{ path: "organizationId", message: "Not available for its release.", code: "FEATURE_UNAVAILABLE" }]);
  }

  const db = getPlatformDb();
  let row: SupportAccessGrant;
  try {
    const rows = await db.$queryRaw<GrantRow[]>`
      SELECT * FROM support_access_request(${input.organizationId}, ${actor.identityId}, ${actor.email}, ${reason}, ${ticket}, ${scope}::text[],
        ${input.durationMinutes}::int, ${input.unmaskContactDetails === true}, ${now.toISOString()}::timestamp, ${REQUEST_VALID_HOURS}::int)`;
    row = fromRow(rows[0]!);
  } catch (err) {
    refusal(err);
  }
  await recordPlatformAudit(db, {
    actorIdentityId: actor.identityId,
    actorLabel: actor.email,
    action: "support_access.requested",
    targetType: "SupportAccessGrant",
    targetId: row.id,
    organizationId: row.organizationId,
    organizationSlug: org.slug,
    reason,
    metadata: { ticket, scope: scope.join(","), minutes: row.durationMinutes, unmasked: row.unmaskContactDetails },
    requestId: options.requestId ?? null,
  });
  await recordAuditEvent({
    organizationId: row.organizationId,
    action: "support_access.requested",
    entityType: "SupportAccessGrant",
    entityId: row.id,
    metadata: { requestedBy: actor.email, ticket, scope, minutes: row.durationMinutes, unmaskContactDetails: row.unmaskContactDetails },
  });
  await notifyManagement(
    row.organizationId,
    org.slug,
    "Figbloom support asks to view your organisation",
    `${actor.email} asks for ${row.durationMinutes} minutes of read-only access (ticket ${ticket}). Approve or deny it in Settings.`,
    row.id,
  );
  return presentGrant(row, now);
}

export async function listSupportAccess(query: { organizationId?: string; status?: string } = {}) {
  const now = new Date();
  const rows = (
    await getPlatformDb().$queryRaw<GrantRow[]>`SELECT * FROM support_access_list(${query.organizationId ?? null}::text, 200)`
  ).map(fromRow);
  const items = rows.map((g) => presentGrant(g, now)).filter((g) => !query.status || g.status === query.status);
  const names = await getPlatformDb().$queryRaw<{ organization_id: string; slug: string; name: string }[]>`
    SELECT organization_id, slug, name FROM platform_organization_counts WHERE organization_id = ANY(${[...new Set(rows.map((r) => r.organizationId))]}::text[])`;
  const byId = new Map(names.map((n) => [n.organization_id, n]));
  return { items: items.map((g) => ({ ...g, organization: byId.get(g.organizationId) ? { slug: byId.get(g.organizationId)!.slug, name: byId.get(g.organizationId)!.name } : null })), total: items.length };
}

async function loadGrant(id: string) {
  const rows = await getPlatformDb().$queryRaw<GrantRow[]>`SELECT * FROM support_access_get(${id})`;
  if (rows.length === 0) throw new NotFoundError("Support access", id);
  return fromRow(rows[0]!);
}

export async function getSupportAccess(id: string) {
  const row = await loadGrant(id);
  const views = await getPlatformDb().$queryRaw<ViewRow[]>`SELECT * FROM support_access_page_views_for(${id}, 200)`;
  return {
    ...presentGrant(row),
    pageViews: views.map((v) => ({ id: v.id, viewedAt: v.viewed_at.toISOString(), by: v.identity_label, resource: v.resource, offset: v.page_offset, rows: v.row_count })),
  };
}

function presentView(v: { id: string; viewedAt: Date; identityLabel: string; resource: string; pageOffset: number; rowCount: number }) {
  return { id: v.id, viewedAt: v.viewedAt.toISOString(), by: v.identityLabel, resource: v.resource, offset: v.pageOffset, rows: v.rowCount };
}

/** Opens an approved request: the window starts now and lasts what was approved. Only the admin who asked may open it, with a fresh second step (the route checks). */
export async function openSupportAccess(actor: Actor, id: string, options: { requestId?: string | null; now?: Date } = {}) {
  const now = options.now ?? new Date();
  const grant = await loadGrant(id);
  const status = effectiveStatus(grant, now);
  if (grant.requestedByIdentityId !== actor.identityId) {
    throw new ValidationError("Only the admin who asked for this access can open it.", [{ path: "id", message: "Not your request.", code: "NOT_REQUESTER" }]);
  }
  if (status !== "APPROVED") {
    const message =
      status === "PENDING" ? "The organisation has not approved this request yet."
      : status === "ACTIVE" ? "This session is already open."
      : `This request is ${status.toLowerCase()}; it cannot be opened.`;
    throw new ValidationError(message, [{ path: "status", message, code: "INVALID_TRANSITION" }]);
  }
  const org = await organisationBasics(grant.organizationId);
  if (org.status !== "ACTIVE") throw new ValidationError(`The organisation is ${org.status.toLowerCase()}; support access cannot be opened.`);
  const endsAt = new Date(now.getTime() + grant.durationMinutes * MIN_MS);
  let count: number;
  try {
    count = (await getPlatformDb().$queryRaw<GrantRow[]>`SELECT * FROM support_access_open(${id}, ${actor.identityId}, ${now.toISOString()}::timestamp)`).length;
  } catch (err) {
    refusal(err);
  }
  if (count === 0) throw new ValidationError("This request can no longer be opened.", [{ path: "status", message: "Changed meanwhile.", code: "INVALID_TRANSITION" }]);
  await recordPlatformAudit(getPlatformDb(), {
    actorIdentityId: actor.identityId,
    actorLabel: actor.email,
    action: "support_access.opened",
    targetType: "SupportAccessGrant",
    targetId: id,
    organizationId: grant.organizationId,
    organizationSlug: org.slug,
    reason: grant.reason,
    metadata: { ticket: grant.ticketReference, minutes: grant.durationMinutes, endsAt: endsAt.toISOString() },
    requestId: options.requestId ?? null,
  });
  await recordAuditEvent({
    organizationId: grant.organizationId,
    action: "support_access.started",
    entityType: "SupportAccessGrant",
    entityId: id,
    metadata: { by: actor.email, ticket: grant.ticketReference, endsAt: endsAt.toISOString() },
  });
  await notifyManagement(
    grant.organizationId,
    org.slug,
    "A Figbloom support session has started",
    `${actor.email} is viewing your organisation read-only until ${endsAt.toISOString().slice(11, 16)} UTC (ticket ${grant.ticketReference}). You can end it any time in Settings.`,
    id,
  );
  return getSupportAccess(id);
}

/** Withdraws a request that is waiting or approved (CANCELLED), or ends a running session now (ENDED). */
export async function endSupportAccess(actor: Actor, id: string, options: { requestId?: string | null; now?: Date } = {}) {
  const now = options.now ?? new Date();
  const grant = await loadGrant(id);
  const status = effectiveStatus(grant, now);
  const target: SupportStatus | null = status === "ACTIVE" ? "ENDED" : status === "PENDING" || status === "APPROVED" ? "CANCELLED" : null;
  if (!target) return { ...presentGrant(grant, now), pageViews: [] };
  let count: number;
  try {
    count = (await getPlatformDb().$queryRaw<GrantRow[]>`SELECT * FROM support_access_end(${id}, ${grant.status}, ${actor.email}, ${now.toISOString()}::timestamp)`).length;
  } catch (err) {
    refusal(err);
  }
  if (count === 0) return getSupportAccess(id);
  const org = await organisationBasics(grant.organizationId);
  await recordPlatformAudit(getPlatformDb(), {
    actorIdentityId: actor.identityId,
    actorLabel: actor.email,
    action: target === "ENDED" ? "support_access.ended" : "support_access.cancelled",
    targetType: "SupportAccessGrant",
    targetId: id,
    organizationId: grant.organizationId,
    organizationSlug: org.slug,
    reason: grant.reason,
    metadata: { ticket: grant.ticketReference, by: "platform" },
    requestId: options.requestId ?? null,
  });
  await recordAuditEvent({
    organizationId: grant.organizationId,
    action: target === "ENDED" ? "support_access.ended" : "support_access.cancelled",
    entityType: "SupportAccessGrant",
    entityId: id,
    metadata: { by: actor.email },
  });
  if (target === "ENDED") {
    await notifyManagement(grant.organizationId, org.slug, "The Figbloom support session has ended", `${actor.email} ended the support session (ticket ${grant.ticketReference}).`, id);
  }
  return getSupportAccess(id);
}

const READ_ERRORS: Record<string, string> = {
  NOT_ACTIVE: "This support session is not open: it was not approved, has not been opened, or its time has run out.",
  ORGANISATION_UNAVAILABLE: "The organisation is not available (suspended or leaving), so nothing can be viewed.",
  OUT_OF_SCOPE: "This session was not approved for that kind of record.",
  UNKNOWN_RESOURCE: "Unknown kind of record.",
};

export interface SupportReadResult {
  resource: string;
  total: number;
  offset: number;
  limit: number;
  items: Record<string, unknown>[];
  contactDetailsMasked: boolean;
  endsAt: string;
}

/** One page of records, read through the database function that checks everything again. Logged for the organisation and the platform. */
export async function readSupportAccess(
  actor: Actor,
  grantId: string,
  resource: string,
  paging: { limit?: number; offset?: number } = {},
  options: { requestId?: string | null } = {},
): Promise<SupportReadResult> {
  const grant = await loadGrant(grantId);
  let result: SupportReadResult;
  try {
    const rows = await getPlatformDb().$queryRaw<{ r: SupportReadResult }[]>`
      SELECT support_access_read(${grantId}, ${actor.identityId}, ${actor.email}, ${resource}, ${paging.limit ?? 25}::int, ${paging.offset ?? 0}::int) AS r`;
    result = rows[0]!.r;
  } catch (err) {
    const m = /SUPPORT_ACCESS:([A-Z_]+)/.exec(err instanceof Error ? err.message : "");
    const code = m?.[1];
    // The platform audit log records the refusal, so an attempt on a closed or out-of-scope session is visible.
    await recordPlatformAudit(getPlatformDb(), {
      actorIdentityId: actor.identityId,
      actorLabel: actor.email,
      action: "support_access.read_refused",
      targetType: "SupportAccessGrant",
      targetId: grantId,
      organizationId: grant.organizationId,
      reason: grant.reason,
      metadata: { ticket: grant.ticketReference, resource: oneLine(resource).slice(0, 40), why: code ?? "UNKNOWN" },
      requestId: options.requestId ?? null,
    }).catch(() => undefined);
    if (code === "NO_GRANT") throw new NotFoundError("Support access", grantId);
    if (code && READ_ERRORS[code]) throw new ApiError(403, "FORBIDDEN", READ_ERRORS[code]!);
    throw err;
  }
  await recordPlatformAudit(getPlatformDb(), {
    actorIdentityId: actor.identityId,
    actorLabel: actor.email,
    action: "support_access.viewed",
    targetType: "SupportAccessGrant",
    targetId: grantId,
    organizationId: grant.organizationId,
    reason: grant.reason,
    metadata: { ticket: grant.ticketReference, resource, offset: result.offset, rows: result.items.length },
    requestId: options.requestId ?? null,
  });
  return result;
}

// ---------------------------------------------------------------------------
// The organisation's side (OS2, OS3, OS4)
// ---------------------------------------------------------------------------

const SECURITY = "security.manage";

async function memberLabel(ctx: AuthContext): Promise<string> {
  const user = await adminDb.user.findUnique({ where: { id: ctx.userId }, select: { name: true } });
  return `${user?.name ?? "Management"} (Management)`;
}

/** History of the organisation's support requests and sessions (OS4). Management. */
export async function listOrganisationSupportAccess(ctx: AuthContext) {
  requirePermission(ctx, SECURITY);
  const now = new Date();
  const rows = await withOrgContext(ctx.organizationId, (tx) =>
    tx.supportAccessGrant.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { requestedAt: "desc" }, take: 200 }),
  );
  return { items: rows.map((g) => presentGrant(g, now)) };
}

export async function getOrganisationSupportAccess(ctx: AuthContext, id: string) {
  requirePermission(ctx, SECURITY);
  const { grant, views } = await withOrgContext(ctx.organizationId, async (tx) => {
    const g = await tx.supportAccessGrant.findFirst({ where: { id, organizationId: ctx.organizationId } });
    const v = g ? await tx.supportAccessPageView.findMany({ where: { grantId: id, organizationId: ctx.organizationId }, orderBy: { viewedAt: "desc" }, take: 200 }) : [];
    return { grant: g, views: v };
  });
  if (!grant) throw new NotFoundError("Support access", id);
  return { ...presentGrant(grant), pageViews: views.map(presentView) };
}

/**
 * What the organisation's screens need on every page: whether a support session is running now (the banner every member sees, OS3), and,
 * for Management, the request waiting for a decision (the approval card, OS2). No reason or ticket is shown to anyone but Management.
 */
export async function getSupportBanner(ctx: AuthContext, now: Date = new Date()) {
  const isManagement = ctx.permissionKeys.includes(SECURITY);
  const rows = await withOrgContext(ctx.organizationId, (tx) =>
    tx.supportAccessGrant.findMany({ where: { organizationId: ctx.organizationId, status: { in: ["PENDING", "APPROVED", "ACTIVE"] } }, orderBy: { requestedAt: "desc" }, take: 5 }),
  );
  const presented = rows.map((g) => presentGrant(g, now));
  const active = presented.find((g) => g.status === "ACTIVE");
  const pending = presented.find((g) => g.status === "PENDING");
  return {
    active: active
      ? {
          id: active.id,
          startsAt: active.startsAt,
          endsAt: active.endsAt,
          secondsLeft: active.secondsLeft,
          scope: active.scope,
          contactDetailsMasked: !active.unmaskContactDetails,
          ...(isManagement ? { requestedBy: active.requestedBy, ticketReference: active.ticketReference, reason: active.reason } : {}),
        }
      : null,
    pending: isManagement && pending ? pending : null,
  };
}

/** Management approves or denies a waiting request. Approval does not open anything: the platform admin opens it with a fresh second step. */
export async function decideSupportAccess(
  ctx: AuthContext,
  id: string,
  decision: "approve" | "deny",
  note: string | undefined,
  now: Date = new Date(),
) {
  requirePermission(ctx, SECURITY);
  if (decision !== "approve" && decision !== "deny") {
    throw new ValidationError("Decision must be approve or deny.", [{ path: "decision", message: "Use approve or deny." }]);
  }
  const cleanNote = note ? oneLine(note).slice(0, 300) : null;
  const label = await memberLabel(ctx);
  const grant = await withOrgContext(ctx.organizationId, (tx) => tx.supportAccessGrant.findFirst({ where: { id, organizationId: ctx.organizationId } }));
  if (!grant) throw new NotFoundError("Support access", id);
  const status = effectiveStatus(grant, now);
  if (status !== "PENDING") {
    const message = status === "EXPIRED" ? "This request has expired. Support has to ask again." : `This request is already ${status.toLowerCase()}.`;
    throw new ValidationError(message, [{ path: "status", message, code: "INVALID_TRANSITION" }]);
  }
  const target = decision === "approve" ? "APPROVED" : "DENIED";
  let count: number;
  try {
    ({ count } = await withOrgContext(ctx.organizationId, (tx) =>
      tx.supportAccessGrant.updateMany({
        where: { id, organizationId: ctx.organizationId, status: "PENDING" },
        data: { status: target, decidedAt: now, decidedByMembershipId: ctx.membershipId, decidedByLabel: label, decisionNote: cleanNote },
      }),
    ));
  } catch (err) {
    refusal(err);
  }
  if (count === 0) throw new ValidationError("This request was decided meanwhile.", [{ path: "status", message: "Already decided.", code: "INVALID_TRANSITION" }]);
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: decision === "approve" ? "support_access.approved" : "support_access.denied",
    entityType: "SupportAccessGrant",
    entityId: id,
    metadata: { ticket: grant.ticketReference, minutes: grant.durationMinutes, unmaskContactDetails: grant.unmaskContactDetails },
  });
  await recordPlatformAudit(getPlatformDb(), {
    actorIdentityId: null,
    actorLabel: `organisation: ${label}`,
    action: decision === "approve" ? "support_access.approved" : "support_access.denied",
    targetType: "SupportAccessGrant",
    targetId: id,
    organizationId: ctx.organizationId,
    reason: null,
    metadata: { ticket: grant.ticketReference },
  }).catch((err) => logger.warn({ err }, "Support access: platform audit of a decision failed"));
  return getOrganisationSupportAccess(ctx, id);
}

/** Management ends a session (or withdraws an approval) at any moment. */
export async function endSupportAccessByOrganisation(ctx: AuthContext, id: string, now: Date = new Date()) {
  requirePermission(ctx, SECURITY);
  const label = await memberLabel(ctx);
  const grant = await withOrgContext(ctx.organizationId, (tx) => tx.supportAccessGrant.findFirst({ where: { id, organizationId: ctx.organizationId } }));
  if (!grant) throw new NotFoundError("Support access", id);
  const status = effectiveStatus(grant, now);
  if (status !== "ACTIVE" && status !== "APPROVED") {
    const message = status === "PENDING" ? "Deny the request instead; nothing has been approved." : `This session is already ${status.toLowerCase()}.`;
    throw new ValidationError(message, [{ path: "status", message, code: "INVALID_TRANSITION" }]);
  }
  let count: number;
  try {
    ({ count } = await withOrgContext(ctx.organizationId, (tx) =>
      tx.supportAccessGrant.updateMany({
        where: { id, organizationId: ctx.organizationId, status: grant.status },
        data: { status: "ENDED", endedAt: now, endedByLabel: label, endReason: "ENDED_BY_ORGANISATION" },
      }),
    ));
  } catch (err) {
    refusal(err);
  }
  if (count > 0) {
    await recordAuditEvent({
      organizationId: ctx.organizationId,
      actorMembershipId: ctx.membershipId,
      action: "support_access.ended",
      entityType: "SupportAccessGrant",
      entityId: id,
      metadata: { by: "organisation", ticket: grant.ticketReference },
    });
    await recordPlatformAudit(getPlatformDb(), {
      actorIdentityId: null,
      actorLabel: `organisation: ${label}`,
      action: "support_access.ended",
      targetType: "SupportAccessGrant",
      targetId: id,
      organizationId: ctx.organizationId,
      metadata: { ticket: grant.ticketReference, by: "organisation" },
    }).catch((err) => logger.warn({ err }, "Support access: platform audit of an end failed"));
  }
  return getOrganisationSupportAccess(ctx, id);
}

// ---------------------------------------------------------------------------
// Expiry (the job): tidies what the clock already refuses
// ---------------------------------------------------------------------------

/**
 * Marks requests, approvals and sessions the clock has passed as EXPIRED and tells Management when a session ran out. Reads never depend on
 * this: `support_access_read` compares the clock itself. Safe to run twice.
 */
export async function expireSupportAccess(organizationId: string, now: Date = new Date()) {
  const rows = await adminDb.$queryRaw<{ id: string; was: string; ticket_reference: string }[]>`
    UPDATE support_access_grants g SET status = 'EXPIRED', ended_at = ${now.toISOString()}::timestamp, end_reason = 'EXPIRED', ended_by_label = 'system', updated_at = ${now.toISOString()}::timestamp
    FROM (SELECT id, status AS was FROM support_access_grants WHERE organization_id = ${organizationId}
            AND ((status = 'PENDING' AND request_expires_at <= ${now.toISOString()}::timestamp)
              OR (status = 'APPROVED' AND decided_at <= ${new Date(now.getTime() - APPROVAL_VALID_MINUTES * MIN_MS).toISOString()}::timestamp)
              OR (status = 'ACTIVE' AND ends_at <= ${now.toISOString()}::timestamp))
          FOR UPDATE) due
    WHERE g.id = due.id
    RETURNING g.id, due.was, g.ticket_reference`;
  if (rows.length === 0) return { expired: 0 };
  const org = await adminDb.organization.findUnique({ where: { id: organizationId }, select: { slug: true } });
  for (const r of rows) {
    await recordAuditEvent({
      organizationId,
      action: "support_access.expired",
      entityType: "SupportAccessGrant",
      entityId: r.id,
      metadata: { was: r.was, ticket: r.ticket_reference },
    });
    await recordPlatformAudit(adminDb, {
      actorIdentityId: null,
      actorLabel: "system",
      action: "support_access.expired",
      targetType: "SupportAccessGrant",
      targetId: r.id,
      organizationId,
      organizationSlug: org?.slug ?? null,
      metadata: { was: r.was, ticket: r.ticket_reference },
    });
    if (r.was === "ACTIVE" && org) {
      await notifyManagement(organizationId, org.slug, "The Figbloom support session has ended", `The support session (ticket ${r.ticket_reference}) ran out of time and closed.`, r.id);
    }
  }
  return { expired: rows.length };
}
