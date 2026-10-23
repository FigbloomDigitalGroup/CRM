import type { AuthContext } from "../auth/context";
import { textForViewer } from "../auth/masking";
import { ValidationError } from "../auth/errors";
import { NOTIFICATION_TYPES, type NotificationTypeKey } from "../notifications/catalogue";
import {
  archiveNotification as archiveRecord,
  deleteReadNotificationsBefore,
  listNotificationFeed,
} from "../repositories/notifications";
import { buildPage, resolvePaging, type PageRequest } from "../lib/pagination";
import { getCompany } from "./companyService";
import { getContact } from "./contactService";
import { getDeal } from "./dealService";
import { getLead } from "./leadService";
import { getTask } from "./taskService";
import { filterByPreferences } from "./notificationService";

/** The feed looks at this many of the newest rows; retention keeps the table well inside it. */
const FEED_SCAN_LIMIT = 500;
export const READ_NOTIFICATION_RETENTION_DAYS = 90;

export interface NotificationFeedQuery {
  unreadOnly?: boolean;
  archived?: boolean;
  types?: string[];
  paging?: PageRequest;
}

/**
 * The record a notification points at, so the feed can check the member may
 * still open it. The link carries it (`/o/acme/deals/<id>`); tasks have their
 * own entity type.
 */
function targetOf(row: { entityType: string | null; entityId: string | null; link: string | null }) {
  if (row.entityType === "Task" && row.entityId) return { kind: "task" as const, id: row.entityId };
  const task = row.link ? /\/tasks#task-([0-9a-f-]{36})$/i.exec(row.link) : null;
  if (task) return { kind: "task" as const, id: task[1]! };
  const match = row.link ? /\/(leads|deals|contacts|companies)\/([0-9a-f-]{36})(?:[/?#]|$)/i.exec(row.link) : null;
  return match ? { kind: match[1] as "leads" | "deals" | "contacts" | "companies", id: match[2]! } : null;
}

async function canOpen(ctx: AuthContext, target: NonNullable<ReturnType<typeof targetOf>>): Promise<boolean> {
  try {
    if (target.kind === "task") await getTask(ctx, target.id);
    else if (target.kind === "leads") await getLead(ctx, target.id);
    else if (target.kind === "deals") await getDeal(ctx, target.id);
    else if (target.kind === "contacts") await getContact(ctx, target.id);
    else await getCompany(ctx, target.id);
    return true;
  } catch {
    return false;
  }
}

/**
 * Notifications the member may see: switched on in their preferences, and about a record they can
 * still open (a lead reassigned away, a deal they lost access to, a deleted record all drop out, so
 * a notification never reveals what the member cannot open). The text is redacted for roles without
 * the value permission.
 */
async function visibleFeed(ctx: AuthContext, query: NotificationFeedQuery) {
  const types = (query.types ?? []).map((t) => {
    if (!NOTIFICATION_TYPES.includes(t as NotificationTypeKey)) {
      throw new ValidationError("Unknown notification type.", [{ path: "type", message: `"${t}" is not a notification type.` }]);
    }
    return t as NotificationTypeKey;
  });
  const rows = await listNotificationFeed(ctx.organizationId, ctx.membershipId, {
    unreadOnly: query.unreadOnly,
    archived: query.archived,
    types,
    limit: FEED_SCAN_LIMIT,
  });
  const enabled = await filterByPreferences(ctx, rows);
  const verdicts = new Map<string, boolean>();
  const out = [];
  for (const row of enabled) {
    const target = targetOf(row);
    if (target) {
      const key = `${target.kind}:${target.id}`;
      if (!verdicts.has(key)) verdicts.set(key, await canOpen(ctx, target));
      if (!verdicts.get(key)) continue;
    }
    out.push({
      id: row.id,
      type: row.type,
      title: textForViewer(ctx, row.title),
      body: textForViewer(ctx, row.body),
      entityType: row.entityType,
      entityId: row.entityId,
      /** Where the notification opens: the record under this organisation. */
      deepLink: row.link,
      organizationId: row.organizationId,
      read: row.readAt !== null,
      readAt: row.readAt,
      archivedAt: row.archivedAt,
      createdAt: row.createdAt,
    });
  }
  return out;
}

export async function listNotificationCentre(ctx: AuthContext, query: NotificationFeedQuery = {}) {
  const all = await visibleFeed(ctx, query);
  const paging = resolvePaging(query.paging ?? {});
  const slice = all.slice(paging.skip, paging.skip + paging.take);
  return { ...buildPage(slice, all.length, paging), unreadCount: await countUnread(ctx) };
}

/** Unread, unarchived and visible to the member, the same set the list shows, so the badge and the list agree. */
export async function countUnread(ctx: AuthContext): Promise<number> {
  return (await visibleFeed(ctx, { unreadOnly: true })).length;
}

export async function setNotificationArchived(ctx: AuthContext, notificationId: string, archived: boolean) {
  const result = await archiveRecord(ctx.organizationId, ctx.membershipId, notificationId, archived);
  return { updated: result.count };
}

/**
 * Retention (B2.18 job): read notifications older than 90 days are removed so the feed stays short.
 * Unread ones are kept however old.
 */
export async function expireOldNotifications(organizationId: string, now = new Date()) {
  const cutoff = new Date(now.getTime() - READ_NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60_000);
  const { count } = await deleteReadNotificationsBefore(organizationId, cutoff);
  return { deleted: count };
}
