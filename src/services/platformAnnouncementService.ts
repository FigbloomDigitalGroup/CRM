import type { PlatformAnnouncement } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { NotFoundError, ValidationError } from "../auth/errors";
import type { PlatformContext } from "../auth/platformSession";
import { adminDb } from "../db/adminClient";
import { withOrgContext } from "../db/orgScopedClient";
import { getPlatformDb } from "../db/platformClient";
import { recordPlatformAudit } from "./platformAuditService";

/**
 * Platform announcements and banners (FIG-1185, B7.03; screens PL13, OS5).
 *
 * The platform writes an announcement with a kind (maintenance, new feature, incident), a severity, a window, who it is for (every
 * organisation, or a list) and a dismiss rule. Organisations read their own feed; no organisation can see another's targeting, or
 * an announcement that is not for it.
 *
 *   dismiss rules   PERMANENT        a member who dismisses it does not see it again.
 *                   DAILY            it comes back the next day while it is still live (for a warning that must not be forgotten).
 *                   NOT_DISMISSIBLE  it stays until its window ends (an incident everyone must see).
 *
 * Text is plain: titles up to 120 and bodies up to 1000 characters, no markup is interpreted anywhere. Every change by the platform is
 * one platform audit entry; a body is never copied into the audit log (only that it changed).
 */

export const ANNOUNCEMENT_KINDS = ["MAINTENANCE", "NEW_FEATURE", "INCIDENT"] as const;
export const ANNOUNCEMENT_SEVERITIES = ["INFO", "WARNING", "CRITICAL"] as const;
export const DISMISS_RULES = ["PERMANENT", "DAILY", "NOT_DISMISSIBLE"] as const;
export type AnnouncementKind = (typeof ANNOUNCEMENT_KINDS)[number];
export type AnnouncementSeverity = (typeof ANNOUNCEMENT_SEVERITIES)[number];
export type DismissRule = (typeof DISMISS_RULES)[number];

export const TITLE_MAX = 120;
export const BODY_MAX = 1000;
export const MAX_TARGETS = 200;
export const MAX_WINDOW_DAYS = 90;
const DAY_MS = 86_400_000;

export type AnnouncementStatus = "SCHEDULED" | "LIVE" | "EXPIRED" | "CANCELLED";

export interface AnnouncementInput {
  title: string;
  body: string;
  kind?: string;
  severity?: string;
  startsAt: string | Date;
  endsAt: string | Date;
  /** True: every organisation. Otherwise `organizationIds` names who it is for. */
  targetAll?: boolean;
  organizationIds?: string[];
  dismissRule?: string;
}

export function statusOf(a: Pick<PlatformAnnouncement, "startsAt" | "endsAt" | "cancelledAt">, now: Date = new Date()): AnnouncementStatus {
  if (a.cancelledAt) return "CANCELLED";
  if (now < a.startsAt) return "SCHEDULED";
  if (now >= a.endsAt) return "EXPIRED";
  return "LIVE";
}

/** What an unspecified rule defaults to: an incident cannot be waved away, a warning comes back, information is dismissed once. */
export function defaultDismissRule(severity: AnnouncementSeverity): DismissRule {
  return severity === "CRITICAL" ? "NOT_DISMISSIBLE" : severity === "WARNING" ? "DAILY" : "PERMANENT";
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function plainText(raw: unknown, field: "title" | "body", max: number): string {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new ValidationError(`The ${field} is required.`, [{ path: field, message: `Write a ${field}.` }]);
  }
  const text = raw.trim();
  if (text.length > max) throw new ValidationError(`Keep the ${field} under ${max} characters.`, [{ path: field, message: `At most ${max} characters.` }]);
  if (CONTROL.test(text)) throw new ValidationError(`The ${field} has characters that cannot be shown.`, [{ path: field, message: "Remove control characters." }]);
  return text;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], path: string, fallback: T): T {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new ValidationError(`Unknown ${path}.`, [{ path, message: `Use one of ${allowed.join(", ")}.` }]);
  }
  return value as T;
}

function parseDate(value: unknown, path: string): Date {
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : new Date(NaN);
  if (Number.isNaN(date.getTime())) throw new ValidationError(`${path} must be a date and time.`, [{ path, message: "Use an ISO date and time." }]);
  return date;
}

function checkWindow(startsAt: Date, endsAt: Date, now: Date) {
  if (endsAt <= startsAt) throw new ValidationError("The end must be after the start.", [{ path: "endsAt", message: "Choose an end after the start." }]);
  if (endsAt <= now) throw new ValidationError("The end is already in the past.", [{ path: "endsAt", message: "Choose an end in the future." }]);
  if (endsAt.getTime() - startsAt.getTime() > MAX_WINDOW_DAYS * DAY_MS) {
    throw new ValidationError(`An announcement can run for at most ${MAX_WINDOW_DAYS} days.`, [{ path: "endsAt", message: `At most ${MAX_WINDOW_DAYS} days.` }]);
  }
}

async function checkTargets(targetAll: boolean, ids: string[] | undefined): Promise<string[]> {
  if (targetAll) {
    if (ids && ids.length > 0) throw new ValidationError("Choose all organisations or a list, not both.", [{ path: "organizationIds", message: "Leave empty when targeting everyone." }]);
    return [];
  }
  const unique = [...new Set((ids ?? []).filter((i) => typeof i === "string" && i.length > 0))];
  if (unique.length === 0) throw new ValidationError("Choose who this is for.", [{ path: "organizationIds", message: "Pick at least one organisation, or target everyone." }]);
  if (unique.length > MAX_TARGETS) throw new ValidationError(`Target at most ${MAX_TARGETS} organisations.`, [{ path: "organizationIds", message: `At most ${MAX_TARGETS}.` }]);
  const found = await getPlatformDb().$queryRaw<{ organization_id: string }[]>`
    SELECT organization_id FROM platform_organization_counts WHERE organization_id = ANY(${unique}::text[]) AND status <> 'OFFBOARDED'`;
  const known = new Set(found.map((r) => r.organization_id));
  const unknown = unique.filter((i) => !known.has(i));
  if (unknown.length > 0) throw new ValidationError("Some organisations were not found.", unknown.map((i) => ({ path: "organizationIds", message: `Unknown organisation ${i}.` })));
  return unique;
}

export function presentAnnouncement(a: PlatformAnnouncement, now: Date = new Date()) {
  return {
    id: a.id,
    title: a.title,
    body: a.body,
    kind: a.kind as AnnouncementKind,
    severity: a.severity as AnnouncementSeverity,
    status: statusOf(a, now),
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    targetAll: a.targetAll,
    organizationIds: a.targetOrganizationIds,
    dismissRule: a.dismissRule as DismissRule,
    createdBy: a.createdByLabel,
    createdAt: a.createdAt.toISOString(),
    cancelledAt: a.cancelledAt?.toISOString() ?? null,
  };
}

type Actor = Pick<PlatformContext, "identityId" | "email">;

export async function createAnnouncement(actor: Actor, input: AnnouncementInput, options: { requestId?: string | null; now?: Date } = {}) {
  const now = options.now ?? new Date();
  const title = plainText(input.title, "title", TITLE_MAX);
  const body = plainText(input.body, "body", BODY_MAX);
  const kind = oneOf(input.kind, ANNOUNCEMENT_KINDS, "kind", "MAINTENANCE");
  const severity = oneOf(input.severity, ANNOUNCEMENT_SEVERITIES, "severity", "INFO");
  const dismissRule = oneOf(input.dismissRule, DISMISS_RULES, "dismissRule", defaultDismissRule(severity));
  const startsAt = parseDate(input.startsAt, "startsAt");
  const endsAt = parseDate(input.endsAt, "endsAt");
  checkWindow(startsAt, endsAt, now);
  const targetAll = input.targetAll === true;
  const ids = await checkTargets(targetAll, input.organizationIds);

  const db = getPlatformDb();
  const row = await db.$transaction(async (tx) => {
    const created = await tx.platformAnnouncement.create({
      data: {
        title, body, kind, severity, dismissRule, startsAt, endsAt, targetAll, targetOrganizationIds: ids,
        createdByIdentityId: actor.identityId, createdByLabel: actor.email,
      },
    });
    await recordPlatformAudit(tx, {
      actorIdentityId: actor.identityId,
      actorLabel: actor.email,
      action: "announcement.created",
      targetType: "Announcement",
      targetId: created.id,
      metadata: { kind, severity, dismissRule, audience: targetAll ? "all" : `${ids.length} organisations` },
      requestId: options.requestId ?? null,
    });
    return created;
  });
  return presentAnnouncement(row, now);
}

export async function listAnnouncements(query: { status?: string } = {}) {
  if (query.status && !["SCHEDULED", "LIVE", "EXPIRED", "CANCELLED"].includes(query.status)) {
    throw new ValidationError("Unknown status.", [{ path: "status", message: "Use SCHEDULED, LIVE, EXPIRED or CANCELLED." }]);
  }
  const now = new Date();
  const rows = await getPlatformDb().platformAnnouncement.findMany({ orderBy: { startsAt: "desc" }, take: 200 });
  const items = rows.map((r) => presentAnnouncement(r, now)).filter((a) => !query.status || a.status === query.status);
  return { items, total: items.length };
}

export async function getAnnouncement(id: string) {
  const row = await getPlatformDb().platformAnnouncement.findUnique({ where: { id } });
  if (!row) throw new NotFoundError("Announcement", id);
  return presentAnnouncement(row);
}

export async function updateAnnouncement(
  actor: Actor,
  id: string,
  patch: Partial<AnnouncementInput>,
  options: { requestId?: string | null; now?: Date } = {},
) {
  const now = options.now ?? new Date();
  const db = getPlatformDb();
  const current = await db.platformAnnouncement.findUnique({ where: { id } });
  if (!current) throw new NotFoundError("Announcement", id);
  const status = statusOf(current, now);
  if (status === "CANCELLED" || status === "EXPIRED") {
    throw new ValidationError(`A ${status.toLowerCase()} announcement cannot be changed. Create a new one.`, [{ path: "status", message: "Not editable.", code: "NOT_EDITABLE" }]);
  }
  const changed: string[] = [];
  const data: Partial<PlatformAnnouncement> = {};
  if (patch.title !== undefined) { data.title = plainText(patch.title, "title", TITLE_MAX); changed.push("title"); }
  if (patch.body !== undefined) { data.body = plainText(patch.body, "body", BODY_MAX); changed.push("body"); }
  if (patch.kind !== undefined) { data.kind = oneOf(patch.kind, ANNOUNCEMENT_KINDS, "kind", "MAINTENANCE"); changed.push("kind"); }
  if (patch.severity !== undefined) { data.severity = oneOf(patch.severity, ANNOUNCEMENT_SEVERITIES, "severity", "INFO"); changed.push("severity"); }
  if (patch.dismissRule !== undefined) { data.dismissRule = oneOf(patch.dismissRule, DISMISS_RULES, "dismissRule", "PERMANENT"); changed.push("dismissRule"); }
  if (patch.startsAt !== undefined) {
    if (status === "LIVE") throw new ValidationError("A live announcement has already started; change its end instead.", [{ path: "startsAt", message: "Already started." }]);
    data.startsAt = parseDate(patch.startsAt, "startsAt");
    changed.push("startsAt");
  }
  if (patch.endsAt !== undefined) { data.endsAt = parseDate(patch.endsAt, "endsAt"); changed.push("endsAt"); }
  if (patch.targetAll !== undefined || patch.organizationIds !== undefined) {
    const all = patch.targetAll ?? (patch.organizationIds !== undefined ? false : current.targetAll);
    data.targetAll = all;
    data.targetOrganizationIds = await checkTargets(all, patch.organizationIds);
    changed.push("audience");
  }
  if (changed.length === 0) throw new ValidationError("Send at least one field to change.");
  checkWindow(data.startsAt ?? current.startsAt, data.endsAt ?? current.endsAt, now);

  const row = await db.$transaction(async (tx) => {
    const updated = await tx.platformAnnouncement.update({ where: { id }, data: { ...data, updatedAt: now } });
    await recordPlatformAudit(tx, {
      actorIdentityId: actor.identityId,
      actorLabel: actor.email,
      action: "announcement.updated",
      targetType: "Announcement",
      targetId: id,
      metadata: { changed: changed.join(",") },
      requestId: options.requestId ?? null,
    });
    return updated;
  });
  return presentAnnouncement(row, now);
}

export async function cancelAnnouncement(actor: Actor, id: string, options: { requestId?: string | null; now?: Date } = {}) {
  const now = options.now ?? new Date();
  const db = getPlatformDb();
  const current = await db.platformAnnouncement.findUnique({ where: { id } });
  if (!current) throw new NotFoundError("Announcement", id);
  if (current.cancelledAt) return presentAnnouncement(current, now);
  const row = await db.$transaction(async (tx) => {
    const updated = await tx.platformAnnouncement.update({ where: { id }, data: { cancelledAt: now, cancelledByLabel: actor.email, updatedAt: now } });
    await recordPlatformAudit(tx, {
      actorIdentityId: actor.identityId,
      actorLabel: actor.email,
      action: "announcement.cancelled",
      targetType: "Announcement",
      targetId: id,
      metadata: { statusWas: statusOf(current, now) },
      requestId: options.requestId ?? null,
    });
    return updated;
  });
  return presentAnnouncement(row, now);
}

// ---------------------------------------------------------------------------
// The organisation's side (OS5)
// ---------------------------------------------------------------------------

/** Announcements that are live and meant for this organisation. The only place the target list is read; it is never returned. */
async function liveForOrganization(organizationId: string, now: Date): Promise<PlatformAnnouncement[]> {
  return adminDb.$queryRaw<PlatformAnnouncement[]>`
    SELECT id, title, body, kind, severity, starts_at AS "startsAt", ends_at AS "endsAt", target_all AS "targetAll",
           target_organization_ids AS "targetOrganizationIds", dismiss_rule AS "dismissRule", cancelled_at AS "cancelledAt",
           cancelled_by_label AS "cancelledByLabel", created_by_identity_id AS "createdByIdentityId", created_by_label AS "createdByLabel",
           created_at AS "createdAt", updated_at AS "updatedAt"
    FROM platform_announcements
    WHERE cancelled_at IS NULL AND starts_at <= ${now.toISOString()}::timestamp AND ends_at > ${now.toISOString()}::timestamp
      AND (target_all OR ${organizationId} = ANY(target_organization_ids))
    ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'WARNING' THEN 1 ELSE 2 END, starts_at DESC`;
}

/** The banners this member should see now: live, for their organisation, and not dismissed under the announcement's rule. */
export async function listAnnouncementFeed(ctx: AuthContext, now: Date = new Date()) {
  const live = await liveForOrganization(ctx.organizationId, now);
  if (live.length === 0) return { items: [] };
  const dismissals = await withOrgContext(ctx.organizationId, (tx) =>
    tx.announcementDismissal.findMany({ where: { organizationId: ctx.organizationId, membershipId: ctx.membershipId, announcementId: { in: live.map((a) => a.id) } } }),
  );
  const dismissedAt = new Map(dismissals.map((d) => [d.announcementId, d.dismissedAt]));
  const items = live
    .filter((a) => {
      const at = dismissedAt.get(a.id);
      if (!at || a.dismissRule === "NOT_DISMISSIBLE") return true;
      if (a.dismissRule === "DAILY") return now.getTime() - at.getTime() >= DAY_MS;
      return false;
    })
    .map((a) => ({
      id: a.id,
      title: a.title,
      body: a.body,
      kind: a.kind as AnnouncementKind,
      severity: a.severity as AnnouncementSeverity,
      startsAt: new Date(a.startsAt).toISOString(),
      endsAt: new Date(a.endsAt).toISOString(),
      dismissible: a.dismissRule !== "NOT_DISMISSIBLE",
    }));
  return { items };
}

/** A member dismisses a banner. An announcement that is not for their organisation is "not found", whatever its id. */
export async function dismissAnnouncement(ctx: AuthContext, announcementId: string, now: Date = new Date()) {
  const live = await liveForOrganization(ctx.organizationId, now);
  const announcement = live.find((a) => a.id === announcementId);
  if (!announcement) throw new NotFoundError("Announcement", announcementId);
  if (announcement.dismissRule === "NOT_DISMISSIBLE") {
    throw new ValidationError("This announcement stays until it ends.", [{ path: "announcementId", message: "Not dismissible.", code: "NOT_DISMISSIBLE" }]);
  }
  await withOrgContext(ctx.organizationId, (tx) =>
    tx.announcementDismissal.upsert({
      where: { membershipId_announcementId: { membershipId: ctx.membershipId, announcementId } },
      update: { dismissedAt: now },
      create: { organizationId: ctx.organizationId, membershipId: ctx.membershipId, announcementId, dismissedAt: now },
    }),
  );
  return { dismissed: true, announcementId };
}
