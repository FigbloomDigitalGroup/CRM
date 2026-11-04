import { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { deny, hasPermission } from "../auth/context";
import { NotFoundError, ValidationError } from "../auth/errors";
import {
  firstForbiddenPart,
  isViewEntity,
  MAX_NAME,
  MAX_VIEWS_PER_PERSON,
  mayOpenEntity,
  parseViewParts,
  sanitiseForViewer,
  ViewPartsError,
  VIEW_SCOPES,
  type ViewEntity,
  type ViewParts,
  type ViewScope,
} from "../lib/savedViews";
import { recordAuditEvent } from "../repositories/auditEvents";
import {
  countOwnedViews,
  createViewRow,
  deleteViewRow,
  findOwnedByName,
  getViewRow,
  listPinsOf,
  listViewRows,
  ownerNames,
  pinView,
  removePinsOfOthers,
  setPinOrder,
  unpinView,
  updateViewRow,
} from "../repositories/savedViews";
import { requireFeature } from "./featureService";

/**
 * Saved views, personal and shared, pinned in the sidebar (FIG-1148, B6.16, design X4). See docs/SAVED_VIEWS.md.
 *
 *   - A view is a list set-up (entity, filters, sort, columns). It holds no records.
 *   - Personal views are seen by their owner only. Shared views are seen by every member whose role may open that list.
 *   - Sharing needs `views.share`. Only the owner edits, shares, unshares or deletes.
 *   - A shared view never reveals more than the viewer's role allows: it is only returned for lists the viewer may open (anything
 *     else answers 404), the parts that need a permission the viewer lacks are removed (`hiddenParts` counts them), and a person
 *     cannot save a view that uses a part they cannot see themselves.
 *   - Pins are per person, with a position, so one person's sidebar does not change another's.
 */

type Row = NonNullable<Awaited<ReturnType<typeof getViewRow>>>;

const asParts = (row: Row): ViewParts => ({
  filters: (row.filters ?? {}) as ViewParts["filters"],
  sort: (row.sort ?? null) as ViewParts["sort"],
  columns: (row.columns ?? null) as ViewParts["columns"],
});

function canSee(ctx: AuthContext, row: Row): boolean {
  if (!isViewEntity(row.entity) || !mayOpenEntity(row.entity, ctx.permissionKeys)) return false;
  return row.ownerMembershipId === ctx.membershipId || row.scope === "SHARED";
}

function present(ctx: AuthContext, row: Row, pin: { position: number } | undefined, ownerName: string | null) {
  const { parts, hiddenParts } = sanitiseForViewer(asParts(row), ctx.permissionKeys);
  return {
    id: row.id,
    entity: row.entity,
    name: row.name,
    scope: row.scope as ViewScope,
    ...parts,
    hiddenParts,
    mine: row.ownerMembershipId === ctx.membershipId,
    ownerName,
    canEdit: row.ownerMembershipId === ctx.membershipId,
    pinned: Boolean(pin),
    pinPosition: pin?.position ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function loadVisible(ctx: AuthContext, id: string): Promise<Row> {
  const row = await getViewRow(ctx.organizationId, id);
  // The same answer for a view that does not exist, one that is someone's private view, and one for a list the caller may not open.
  if (!row || !canSee(ctx, row)) throw new NotFoundError("SavedView", id);
  return row;
}

async function presentOne(ctx: AuthContext, row: Row) {
  const [pins, owners] = await Promise.all([listPinsOf(ctx.organizationId, ctx.membershipId), ownerNames(ctx.organizationId)]);
  return present(ctx, row, pins.find((p) => p.savedViewId === row.id), owners.find((o) => o.id === row.ownerMembershipId)?.user.name ?? null);
}

function cleanName(name: unknown): string {
  const n = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
  if (!n || n.length > MAX_NAME) throw new ValidationError(`A name of 1 to ${MAX_NAME} characters is required.`, [{ path: "name", message: `1 to ${MAX_NAME} characters.` }]);
  return n;
}

function checkParts(ctx: AuthContext, input: { filters?: unknown; sort?: unknown; columns?: unknown }) {
  let parts: Partial<ViewParts>;
  try {
    parts = parseViewParts(input);
  } catch (err) {
    if (err instanceof ViewPartsError) throw new ValidationError(err.message, [{ path: err.path, message: err.message }]);
    throw err;
  }
  const forbidden = firstForbiddenPart(parts, ctx.permissionKeys);
  if (forbidden) {
    throw new ValidationError("This view uses a field your role cannot see.", [{ path: forbidden.path, message: "Remove the field your role cannot see.", code: "FIELD_NOT_VISIBLE" }]);
  }
  return parts;
}

function checkScope(ctx: AuthContext, scope: unknown): ViewScope {
  if (!(VIEW_SCOPES as readonly unknown[]).includes(scope)) throw new ValidationError("scope is PERSONAL or SHARED.", [{ path: "scope", message: "PERSONAL or SHARED." }]);
  if (scope === "SHARED" && !hasPermission(ctx, "views.share")) throw deny(ctx, "views.share", ["views.share"]);
  return scope as ViewScope;
}

export async function listViews(ctx: AuthContext, options: { entity?: string; pinned?: boolean } = {}) {
  await requireFeature(ctx.organizationId, "release.v11");
  if (options.entity !== undefined && !isViewEntity(options.entity)) throw new ValidationError("Unknown list.", [{ path: "entity", message: "Use leads, deals, companies, contacts or tasks." }]);
  const [rows, pins, owners] = await Promise.all([listViewRows(ctx.organizationId, options.entity), listPinsOf(ctx.organizationId, ctx.membershipId), ownerNames(ctx.organizationId)]);
  const pinById = new Map(pins.map((p) => [p.savedViewId, p]));
  const names = new Map(owners.map((o) => [o.id, o.user.name]));
  let items = rows.filter((r) => canSee(ctx, r)).map((r) => present(ctx, r, pinById.get(r.id), names.get(r.ownerMembershipId) ?? null));
  if (options.pinned) items = items.filter((v) => v.pinned).sort((a, b) => (a.pinPosition ?? 0) - (b.pinPosition ?? 0));
  else items = items.sort((a, b) => Number(b.mine) - Number(a.mine) || a.name.localeCompare(b.name));
  return { items };
}

export async function getView(ctx: AuthContext, id: string) {
  await requireFeature(ctx.organizationId, "release.v11");
  return presentOne(ctx, await loadVisible(ctx, id));
}

export async function createView(
  ctx: AuthContext,
  input: { entity: string; name: string; scope?: string; filters?: unknown; sort?: unknown; columns?: unknown; pinned?: boolean },
) {
  await requireFeature(ctx.organizationId, "release.v11");
  if (!isViewEntity(input.entity)) throw new ValidationError("Unknown list.", [{ path: "entity", message: "Use leads, deals, companies, contacts or tasks." }]);
  const entity: ViewEntity = input.entity;
  if (!mayOpenEntity(entity, ctx.permissionKeys)) throw deny(ctx, `${entity} list`, ENTITY_KEYS_HINT[entity]);
  const name = cleanName(input.name);
  const scope = checkScope(ctx, input.scope ?? "PERSONAL");
  const parts = checkParts(ctx, input);
  if ((await countOwnedViews(ctx.organizationId, ctx.membershipId)) >= MAX_VIEWS_PER_PERSON) {
    throw new ValidationError(`You can keep at most ${MAX_VIEWS_PER_PERSON} saved views.`, [{ path: "name", message: "Delete a view first.", code: "TOO_MANY_VIEWS" }]);
  }
  if (await findOwnedByName(ctx.organizationId, ctx.membershipId, entity, name)) {
    throw new ValidationError("You already have a view with that name.", [{ path: "name", message: "Pick a different name.", code: "DUPLICATE_VIEW" }]);
  }
  const row = await createViewRow({
    organizationId: ctx.organizationId,
    ownerMembershipId: ctx.membershipId,
    entity,
    name,
    scope,
    filters: (parts.filters ?? {}) as object,
    sort: (parts.sort ?? undefined) as object | undefined,
    columns: (parts.columns ?? undefined) as object | undefined,
  });
  if (input.pinned) await pinView(ctx.organizationId, ctx.membershipId, row.id);
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "saved_view.created",
    entityType: "SavedView",
    entityId: row.id,
    newValue: { entity, name, scope },
  });
  return presentOne(ctx, row);
}

export async function updateView(
  ctx: AuthContext,
  id: string,
  patch: { name?: string; scope?: string; filters?: unknown; sort?: unknown; columns?: unknown },
) {
  await requireFeature(ctx.organizationId, "release.v11");
  const row = await loadVisible(ctx, id);
  if (row.ownerMembershipId !== ctx.membershipId) throw deny(ctx, "edit a view someone else made", []);
  const data: Prisma.SavedViewUncheckedUpdateInput = {};
  if (patch.name !== undefined) {
    const name = cleanName(patch.name);
    const clash = await findOwnedByName(ctx.organizationId, ctx.membershipId, row.entity, name);
    if (clash && clash.id !== row.id) throw new ValidationError("You already have a view with that name.", [{ path: "name", message: "Pick a different name.", code: "DUPLICATE_VIEW" }]);
    data.name = name;
  }
  const newScope = patch.scope !== undefined ? checkScope(ctx, patch.scope) : undefined;
  if (newScope) data.scope = newScope;
  if (patch.filters !== undefined || patch.sort !== undefined || patch.columns !== undefined) {
    const parts = checkParts(ctx, patch);
    if (parts.filters !== undefined) data.filters = parts.filters;
    if (parts.sort !== undefined) data.sort = parts.sort ? { ...parts.sort } : Prisma.DbNull;
    if (parts.columns !== undefined) data.columns = parts.columns ?? Prisma.DbNull;
  }
  const updated = await updateViewRow(ctx.organizationId, id, data);
  if (newScope === "PERSONAL" && row.scope === "SHARED") await removePinsOfOthers(ctx.organizationId, id, ctx.membershipId);
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: newScope && newScope !== row.scope ? (newScope === "SHARED" ? "saved_view.shared" : "saved_view.unshared") : "saved_view.updated",
    entityType: "SavedView",
    entityId: id,
    previousValue: { name: row.name, scope: row.scope },
    newValue: { name: updated.name, scope: updated.scope },
  });
  return presentOne(ctx, updated);
}

export async function deleteView(ctx: AuthContext, id: string) {
  await requireFeature(ctx.organizationId, "release.v11");
  const row = await loadVisible(ctx, id);
  if (row.ownerMembershipId !== ctx.membershipId) throw deny(ctx, "delete a view someone else made", []);
  await deleteViewRow(ctx.organizationId, id);
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "saved_view.deleted",
    entityType: "SavedView",
    entityId: id,
    previousValue: { entity: row.entity, name: row.name, scope: row.scope },
  });
  return { id };
}

/** Pins or unpins a view in the caller's own sidebar. Anyone who can see a view can pin it for themselves. */
export async function setPinned(ctx: AuthContext, id: string, pinned: boolean) {
  await requireFeature(ctx.organizationId, "release.v11");
  const row = await loadVisible(ctx, id);
  if (pinned) await pinView(ctx.organizationId, ctx.membershipId, id);
  else await unpinView(ctx.organizationId, ctx.membershipId, id);
  return presentOne(ctx, row);
}

/** Puts the caller's pinned views in the given order. Ids that are not pinned and visible to the caller are refused. */
export async function reorderPins(ctx: AuthContext, orderedIds: string[]) {
  await requireFeature(ctx.organizationId, "release.v11");
  const pinned = await listViews(ctx, { pinned: true });
  const have = new Set(pinned.items.map((v) => v.id));
  if (orderedIds.length !== have.size || new Set(orderedIds).size !== orderedIds.length || !orderedIds.every((i) => have.has(i))) {
    throw new ValidationError("Send every pinned view exactly once.", [{ path: "ids", message: "The list must match your pinned views." }]);
  }
  await setPinOrder(ctx.organizationId, ctx.membershipId, orderedIds);
  return listViews(ctx, { pinned: true });
}

const ENTITY_KEYS_HINT: Record<ViewEntity, string[]> = {
  leads: ["leads.view.own"],
  deals: ["deals.view.own"],
  companies: ["companies.view"],
  contacts: ["contacts.view"],
  tasks: ["tasks.view.own"],
};
