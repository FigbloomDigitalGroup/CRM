import type { Prisma } from "@prisma/client";
import { withOrgContext } from "../db/orgScopedClient";

/** Data access for `saved_views` and `saved_view_pins` (FIG-1148). Every call runs inside the organisation's RLS context. */

export function listViewRows(organizationId: string, entity?: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.savedView.findMany({ where: { organizationId, ...(entity ? { entity } : {}) }, orderBy: [{ name: "asc" }] }),
  );
}

export function getViewRow(organizationId: string, id: string) {
  return withOrgContext(organizationId, (tx) => tx.savedView.findFirst({ where: { id, organizationId } }));
}

export function countOwnedViews(organizationId: string, ownerMembershipId: string) {
  return withOrgContext(organizationId, (tx) => tx.savedView.count({ where: { organizationId, ownerMembershipId } }));
}

export function findOwnedByName(organizationId: string, ownerMembershipId: string, entity: string, name: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.savedView.findFirst({ where: { organizationId, ownerMembershipId, entity, name: { equals: name, mode: "insensitive" } } }),
  );
}

export function createViewRow(data: Prisma.SavedViewUncheckedCreateInput) {
  return withOrgContext(data.organizationId, (tx) => tx.savedView.create({ data }));
}

export function updateViewRow(organizationId: string, id: string, data: Prisma.SavedViewUncheckedUpdateInput) {
  return withOrgContext(organizationId, (tx) => tx.savedView.update({ where: { id, organizationId }, data }));
}

export function deleteViewRow(organizationId: string, id: string) {
  return withOrgContext(organizationId, (tx) => tx.savedView.delete({ where: { id, organizationId } }));
}

/** When a view stops being shared, everybody else's pin of it goes (the owner keeps theirs). */
export function removePinsOfOthers(organizationId: string, savedViewId: string, ownerMembershipId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.savedViewPin.deleteMany({ where: { organizationId, savedViewId, membershipId: { not: ownerMembershipId } } }),
  );
}

export function listPinsOf(organizationId: string, membershipId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.savedViewPin.findMany({ where: { organizationId, membershipId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
  );
}

export function pinView(organizationId: string, membershipId: string, savedViewId: string) {
  return withOrgContext(organizationId, async (tx) => {
    const existing = await tx.savedViewPin.findFirst({ where: { organizationId, membershipId, savedViewId } });
    if (existing) return existing;
    const last = await tx.savedViewPin.aggregate({ where: { organizationId, membershipId }, _max: { position: true } });
    return tx.savedViewPin.create({ data: { organizationId, membershipId, savedViewId, position: (last._max.position ?? 0) + 1 } });
  });
}

export function unpinView(organizationId: string, membershipId: string, savedViewId: string) {
  return withOrgContext(organizationId, (tx) => tx.savedViewPin.deleteMany({ where: { organizationId, membershipId, savedViewId } }));
}

export function setPinOrder(organizationId: string, membershipId: string, orderedViewIds: string[]) {
  return withOrgContext(organizationId, async (tx) => {
    for (const [i, savedViewId] of orderedViewIds.entries()) {
      await tx.savedViewPin.updateMany({ where: { organizationId, membershipId, savedViewId }, data: { position: i + 1 } });
    }
  });
}

export function ownerNames(organizationId: string) {
  return withOrgContext(organizationId, (tx) => tx.membership.findMany({ where: { organizationId }, select: { id: true, user: { select: { name: true } } } }));
}
