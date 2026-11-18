import type { Prisma } from "@prisma/client";
import { withOrgContext } from "../db/orgScopedClient";

/** Data access for `catalogue_items` (FIG-1142). Every call runs inside the organisation's RLS context. */

export interface CatalogueFilters {
  status?: "ACTIVE" | "HIDDEN";
  kind?: "PRODUCT" | "SERVICE";
  q?: string;
}

function where(organizationId: string, f: CatalogueFilters): Prisma.CatalogueItemWhereInput {
  const q = f.q?.trim();
  return {
    organizationId,
    ...(f.status ? { status: f.status } : {}),
    ...(f.kind ? { kind: f.kind } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }] } : {}),
  };
}

export function listCatalogueItems(organizationId: string, filters: CatalogueFilters, paging: { skip: number; take: number }) {
  return withOrgContext(organizationId, async (tx) => {
    const w = where(organizationId, filters);
    const [rows, total] = await Promise.all([
      tx.catalogueItem.findMany({ where: w, orderBy: [{ name: "asc" }, { id: "asc" }], skip: paging.skip, take: paging.take }),
      tx.catalogueItem.count({ where: w }),
    ]);
    return { rows, total };
  });
}

export function getCatalogueItem(organizationId: string, id: string) {
  return withOrgContext(organizationId, (tx) => tx.catalogueItem.findFirst({ where: { id, organizationId } }));
}

export function getCatalogueItems(organizationId: string, ids: string[]) {
  return withOrgContext(organizationId, (tx) => tx.catalogueItem.findMany({ where: { organizationId, id: { in: ids } } }));
}

export function findCatalogueItemByName(organizationId: string, name: string) {
  return withOrgContext(organizationId, (tx) => tx.catalogueItem.findFirst({ where: { organizationId, name: { equals: name, mode: "insensitive" } } }));
}

export function findCatalogueItemBySku(organizationId: string, sku: string) {
  return withOrgContext(organizationId, (tx) => tx.catalogueItem.findFirst({ where: { organizationId, sku: { equals: sku, mode: "insensitive" } } }));
}

export function createCatalogueItem(data: Prisma.CatalogueItemUncheckedCreateInput) {
  return withOrgContext(data.organizationId, (tx) => tx.catalogueItem.create({ data }));
}

export function updateCatalogueItem(organizationId: string, id: string, data: Prisma.CatalogueItemUncheckedUpdateInput) {
  return withOrgContext(organizationId, (tx) => tx.catalogueItem.update({ where: { id, organizationId }, data }));
}
