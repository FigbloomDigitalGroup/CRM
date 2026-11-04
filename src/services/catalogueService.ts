import type { CatalogueItem } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { deny, hasPermission, requirePermission } from "../auth/context";
import { NotFoundError, ValidationError, type ValidationIssue } from "../auth/errors";
import { canSeeMargin } from "../auth/masking";
import { normaliseCurrency, parseMoney } from "../lib/commercialMoney";
import { buildPage, resolvePaging, type PageRequest } from "../lib/pagination";
import { recordAuditEvent } from "../repositories/auditEvents";
import {
  createCatalogueItem,
  findCatalogueItemByName,
  findCatalogueItemBySku,
  getCatalogueItem,
  listCatalogueItems,
  updateCatalogueItem,
  type CatalogueFilters,
} from "../repositories/catalogueItems";
import { requireFeature } from "./featureService";

/**
 * The catalogue of products and services (FIG-1142, B6.10).
 *
 *  - Reading: anyone who builds or approves quotes (`quotes.create`, `quotes.approve`), manages the catalogue
 *    (`catalogue.manage`) or may see deal values (`deals.view.value`, Finance). They see name, unit, price, tax flag and
 *    state. Everyone except `catalogue.manage` sees ACTIVE items only.
 *  - Cost and margin: only with `deals.margin` (Management). Without it they are `null` with `costMasked: true` in every
 *    response, and writing a cost is refused. One helper (`presentCatalogueItem`) builds every response, so no surface
 *    can forget it (docs/MASKING.md).
 *  - Writing: `catalogue.manage`. Each change is audited; the audit snapshot's price and cost go through
 *    `maskAuditSnapshot` for readers without the permissions.
 */

export const CATALOGUE_KINDS = ["PRODUCT", "SERVICE"] as const;
export const CATALOGUE_STATUSES = ["ACTIVE", "HIDDEN"] as const;

const READ_KEYS = ["catalogue.manage", "quotes.create", "quotes.approve", "deals.view.value"];

function requireRead(ctx: AuthContext): void {
  if (!READ_KEYS.some((k) => hasPermission(ctx, k))) {
    throw deny(ctx, "the catalogue (quotes.create, catalogue.manage or deals.view.value)", READ_KEYS);
  }
}

export interface CatalogueItemView {
  id: string;
  sku: string | null;
  name: string;
  description: string | null;
  kind: string;
  unit: string;
  price: number;
  currency: string;
  taxable: boolean;
  status: string;
  /** Null without `deals.margin`. */
  cost: number | null;
  /** Margin on the price as a whole percentage; null without `deals.margin` or when no cost is set. */
  marginPct: number | null;
  costMasked: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function marginPct(price: number, cost: number | null): number | null {
  if (cost === null || price <= 0) return null;
  return Math.round(((price - cost) / price) * 100);
}

/** The one place a catalogue row becomes a response. */
export function presentCatalogueItem(ctx: Pick<AuthContext, "permissionKeys">, row: CatalogueItem): CatalogueItemView {
  const showMargin = ctx.permissionKeys.includes("deals.margin");
  const price = Number(row.price);
  const cost = row.cost === null ? null : Number(row.cost);
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    description: row.description,
    kind: row.kind,
    unit: row.unit,
    price,
    currency: row.currency,
    taxable: row.taxable,
    status: row.status,
    cost: showMargin ? cost : null,
    marginPct: showMargin ? marginPct(price, cost) : null,
    costMasked: !showMargin,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function auditSnapshot(row: CatalogueItem) {
  return {
    name: row.name,
    sku: row.sku,
    kind: row.kind,
    unit: row.unit,
    price: Number(row.price),
    cost: row.cost === null ? null : Number(row.cost),
    currency: row.currency,
    taxable: row.taxable,
    status: row.status,
  };
}

export interface CatalogueInput {
  name?: string;
  sku?: string | null;
  description?: string | null;
  kind?: string;
  unit?: string;
  price?: number | string;
  cost?: number | string | null;
  currency?: string;
  taxable?: boolean;
  status?: string;
}

interface Clean {
  name?: string;
  sku?: string | null;
  description?: string | null;
  kind?: string;
  unit?: string;
  price?: number;
  cost?: number | null;
  currency?: string;
  taxable?: boolean;
  status?: string;
}

function clean(ctx: AuthContext, input: CatalogueInput, partial: boolean): Clean {
  const issues: ValidationIssue[] = [];
  const out: Clean = {};
  if (!partial || input.name !== undefined) {
    const name = (input.name ?? "").trim().replace(/\s+/g, " ");
    if (!name || name.length > 120) issues.push({ path: "name", message: "A name of 1 to 120 characters is required." });
    out.name = name;
  }
  if (input.sku !== undefined) {
    const sku = input.sku === null ? "" : input.sku.trim();
    if (sku.length > 40) issues.push({ path: "sku", message: "A SKU is at most 40 characters." });
    out.sku = sku === "" ? null : sku;
  }
  if (input.description !== undefined) {
    const d = input.description === null ? "" : input.description.trim();
    if (d.length > 2000) issues.push({ path: "description", message: "A description is at most 2000 characters." });
    out.description = d === "" ? null : d;
  }
  if (input.kind !== undefined) {
    if (!(CATALOGUE_KINDS as readonly string[]).includes(input.kind)) issues.push({ path: "kind", message: "Use PRODUCT or SERVICE." });
    else out.kind = input.kind;
  }
  if (input.unit !== undefined) {
    const unit = input.unit.trim();
    if (!unit || unit.length > 30) issues.push({ path: "unit", message: "A unit of 1 to 30 characters is required (for example unit, month, site)." });
    out.unit = unit;
  }
  if (!partial && input.price === undefined) issues.push({ path: "price", message: "A price is required.", code: "INVALID_AMOUNT" });
  if (input.price !== undefined) {
    const price = parseMoney(input.price, "price", issues, "The price");
    if (price !== null) out.price = price;
  }
  if (input.cost !== undefined) {
    if (!canSeeMargin(ctx)) throw deny(ctx, "setting a catalogue cost (deals.margin)", ["deals.margin"]);
    if (input.cost === null) out.cost = null;
    else {
      const cost = parseMoney(input.cost, "cost", issues, "The cost");
      if (cost !== null) out.cost = cost;
    }
  }
  if (input.currency !== undefined) {
    const c = normaliseCurrency(input.currency, "currency", issues);
    if (c) out.currency = c;
  }
  if (input.taxable !== undefined) out.taxable = input.taxable;
  if (input.status !== undefined) {
    if (!(CATALOGUE_STATUSES as readonly string[]).includes(input.status)) issues.push({ path: "status", message: "Use ACTIVE or HIDDEN." });
    else out.status = input.status;
  }
  if (issues.length > 0) throw new ValidationError("This catalogue item is not valid.", issues);
  return out;
}

async function assertUnique(organizationId: string, data: Clean, exceptId?: string) {
  const issues: ValidationIssue[] = [];
  if (data.name) {
    const hit = await findCatalogueItemByName(organizationId, data.name);
    if (hit && hit.id !== exceptId) issues.push({ path: "name", message: "An item with this name already exists.", code: "DUPLICATE_ITEM" });
  }
  if (data.sku) {
    const hit = await findCatalogueItemBySku(organizationId, data.sku);
    if (hit && hit.id !== exceptId) issues.push({ path: "sku", message: "An item with this SKU already exists.", code: "DUPLICATE_SKU" });
  }
  if (issues.length > 0) throw new ValidationError("This catalogue item is not valid.", issues);
}

export async function listCatalogue(ctx: AuthContext, filters: { status?: string; kind?: string; q?: string } = {}, request: PageRequest = {}) {
  await requireFeature(ctx.organizationId, "quotes.enabled");
  requireRead(ctx);
  const f: CatalogueFilters = {};
  if (filters.status !== undefined) {
    if (!(CATALOGUE_STATUSES as readonly string[]).includes(filters.status)) throw new ValidationError("status must be ACTIVE or HIDDEN.", [{ path: "status", message: "Use ACTIVE or HIDDEN." }]);
    f.status = filters.status as "ACTIVE" | "HIDDEN";
  }
  if (filters.kind !== undefined) {
    if (!(CATALOGUE_KINDS as readonly string[]).includes(filters.kind)) throw new ValidationError("kind must be PRODUCT or SERVICE.", [{ path: "kind", message: "Use PRODUCT or SERVICE." }]);
    f.kind = filters.kind as "PRODUCT" | "SERVICE";
  }
  if (filters.q) f.q = filters.q;
  // Quote builders pick from what is on offer; hidden items are for the people who manage the catalogue.
  if (!hasPermission(ctx, "catalogue.manage")) f.status = "ACTIVE";
  const paging = resolvePaging(request);
  const { rows, total } = await listCatalogueItems(ctx.organizationId, f, paging);
  return buildPage(rows.map((r) => presentCatalogueItem(ctx, r)), total, paging);
}

export async function getCatalogueEntry(ctx: AuthContext, id: string) {
  await requireFeature(ctx.organizationId, "quotes.enabled");
  requireRead(ctx);
  const row = await getCatalogueItem(ctx.organizationId, id);
  if (!row || (row.status === "HIDDEN" && !hasPermission(ctx, "catalogue.manage"))) throw new NotFoundError("CatalogueItem", id);
  return presentCatalogueItem(ctx, row);
}

export async function createCatalogueEntry(ctx: AuthContext, input: CatalogueInput & { name: string; price: number | string }) {
  await requireFeature(ctx.organizationId, "quotes.enabled");
  requirePermission(ctx, "catalogue.manage");
  const data = clean(ctx, input, false);
  await assertUnique(ctx.organizationId, data);
  const row = await createCatalogueItem({
    organizationId: ctx.organizationId,
    name: data.name!,
    price: data.price!,
    sku: data.sku ?? null,
    description: data.description ?? null,
    kind: data.kind ?? "PRODUCT",
    unit: data.unit ?? "unit",
    cost: data.cost ?? null,
    currency: data.currency ?? "KES",
    taxable: data.taxable ?? true,
    status: data.status ?? "ACTIVE",
    createdByMembershipId: ctx.membershipId,
  });
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "catalogue_item.created",
    entityType: "CatalogueItem",
    entityId: row.id,
    newValue: auditSnapshot(row),
  });
  return presentCatalogueItem(ctx, row);
}

export async function updateCatalogueEntry(ctx: AuthContext, id: string, patch: CatalogueInput) {
  await requireFeature(ctx.organizationId, "quotes.enabled");
  requirePermission(ctx, "catalogue.manage");
  const existing = await getCatalogueItem(ctx.organizationId, id);
  if (!existing) throw new NotFoundError("CatalogueItem", id);
  const data = clean(ctx, patch, true);
  await assertUnique(ctx.organizationId, data, id);
  const row = await updateCatalogueItem(ctx.organizationId, id, data);
  const action =
    existing.status !== row.status ? (row.status === "HIDDEN" ? "catalogue_item.hidden" : "catalogue_item.shown") : "catalogue_item.updated";
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action,
    entityType: "CatalogueItem",
    entityId: id,
    previousValue: auditSnapshot(existing),
    newValue: auditSnapshot(row),
  });
  return presentCatalogueItem(ctx, row);
}
