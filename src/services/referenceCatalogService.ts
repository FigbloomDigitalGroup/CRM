import { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { NotFoundError, ValidationError } from "../auth/errors";
import { recordAuditEvent } from "../repositories/auditEvents";
import {
  type CatalogEntry,
  type CatalogKey,
  countCatalogEntryUsage,
  createCatalogEntry as createCatalogEntryRecord,
  getCatalogEntryById,
  listCatalogEntries,
  moveCatalogEntry,
  updateCatalogEntry as updateCatalogEntryRecord,
} from "../repositories/referenceCatalogs";

/**
 * Reuses `configuration.manage` (Management-only) -- the permission's own
 * seed description already names "lead sources, pipeline stages, etc." as
 * exactly what it's for (see prisma/seedData.ts); FIG-599 is what actually
 * wires it to those catalogs.
 */
const PERMISSION = "configuration.manage";

const CATALOG_LABELS: Record<CatalogKey, string> = {
  leadSources: "Lead source",
  leadStatuses: "Lead status",
  pipelineStages: "Pipeline stage",
  lostReasons: "Lost reason",
  services: "Service",
};

const CATALOG_ENTITY_TYPES: Record<CatalogKey, string> = {
  leadSources: "LeadSource",
  leadStatuses: "LeadStatus",
  pipelineStages: "PipelineStage",
  lostReasons: "LostReason",
  services: "Service",
};

function deriveKey(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export interface CatalogEntryWithUsage extends CatalogEntry {
  usageCount: number;
}

export async function listCatalog(
  ctx: AuthContext,
  catalogKey: CatalogKey,
): Promise<CatalogEntryWithUsage[]> {
  requirePermission(ctx, PERMISSION);
  const entries = await listCatalogEntries(ctx.organizationId, catalogKey);
  return Promise.all(
    entries.map(async (entry) => ({
      ...entry,
      usageCount: await countCatalogEntryUsage(ctx.organizationId, catalogKey, entry.id),
    })),
  );
}

export interface CreateCatalogEntryServiceInput {
  name: string;
  description?: string;
  probability?: number;
  isWon?: boolean;
  isLost?: boolean;
  category?: string;
}

export async function createCatalogEntry(
  ctx: AuthContext,
  catalogKey: CatalogKey,
  input: CreateCatalogEntryServiceInput,
): Promise<CatalogEntry> {
  requirePermission(ctx, PERMISSION);

  const name = input.name.trim();
  if (!name) {
    throw new ValidationError(`${CATALOG_LABELS[catalogKey]} name is required.`);
  }
  const key = deriveKey(name);
  if (!key) {
    throw new ValidationError(
      `${CATALOG_LABELS[catalogKey]} name must contain at least one letter or number.`,
    );
  }

  let entry: CatalogEntry;
  try {
    entry = await createCatalogEntryRecord(ctx.organizationId, catalogKey, {
      key,
      name,
      description: input.description?.trim() || undefined,
      probability: input.probability,
      isWon: input.isWon,
      isLost: input.isLost,
      category: input.category?.trim() || undefined,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ValidationError(
        `A ${CATALOG_LABELS[catalogKey].toLowerCase()} with a matching key ("${key}") already exists.`,
      );
    }
    throw err;
  }

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "reference_catalog.created",
    entityType: CATALOG_ENTITY_TYPES[catalogKey],
    entityId: entry.id,
    newValue: { key: entry.key, name: entry.name } as Prisma.InputJsonValue,
    metadata: { catalogKey },
  });

  return entry;
}

export interface UpdateCatalogEntryServiceInput {
  name?: string;
  description?: string | null;
  probability?: number | null;
  isWon?: boolean;
  isLost?: boolean;
  category?: string | null;
}

async function requireEntry(
  ctx: AuthContext,
  catalogKey: CatalogKey,
  id: string,
): Promise<CatalogEntry> {
  const existing = await getCatalogEntryById(ctx.organizationId, catalogKey, id);
  if (!existing) throw new NotFoundError(CATALOG_ENTITY_TYPES[catalogKey], id);
  return existing;
}

export async function updateCatalogEntry(
  ctx: AuthContext,
  catalogKey: CatalogKey,
  id: string,
  input: UpdateCatalogEntryServiceInput,
): Promise<CatalogEntry> {
  requirePermission(ctx, PERMISSION);
  const existing = await requireEntry(ctx, catalogKey, id);

  const name = input.name !== undefined ? input.name.trim() : undefined;
  if (name !== undefined && !name) {
    throw new ValidationError(`${CATALOG_LABELS[catalogKey]} name cannot be blank.`);
  }

  const updated = await updateCatalogEntryRecord(ctx.organizationId, catalogKey, id, {
    name,
    description: input.description,
    probability: input.probability,
    isWon: input.isWon,
    isLost: input.isLost,
    category: input.category,
  });

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "reference_catalog.updated",
    entityType: CATALOG_ENTITY_TYPES[catalogKey],
    entityId: id,
    previousValue: {
      name: existing.name,
      description: existing.description,
    } as Prisma.InputJsonValue,
    newValue: { name: updated.name, description: updated.description } as Prisma.InputJsonValue,
    metadata: { catalogKey },
  });

  return updated;
}

/**
 * Deactivating never deletes or touches existing records -- see
 * `countCatalogEntryUsage`'s doc comment in the repository. Reactivating is
 * the same action with the flag flipped the other way.
 */
export async function setCatalogEntryActive(
  ctx: AuthContext,
  catalogKey: CatalogKey,
  id: string,
  isActive: boolean,
): Promise<CatalogEntry> {
  requirePermission(ctx, PERMISSION);
  await requireEntry(ctx, catalogKey, id);

  const updated = await updateCatalogEntryRecord(ctx.organizationId, catalogKey, id, { isActive });

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: isActive ? "reference_catalog.reactivated" : "reference_catalog.deactivated",
    entityType: CATALOG_ENTITY_TYPES[catalogKey],
    entityId: id,
    metadata: { catalogKey },
  });

  return updated;
}

export async function reorderCatalogEntry(
  ctx: AuthContext,
  catalogKey: CatalogKey,
  id: string,
  direction: "up" | "down",
): Promise<void> {
  requirePermission(ctx, PERMISSION);
  await requireEntry(ctx, catalogKey, id);

  await moveCatalogEntry(ctx.organizationId, catalogKey, id, direction);

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "reference_catalog.reordered",
    entityType: CATALOG_ENTITY_TYPES[catalogKey],
    entityId: id,
    metadata: { catalogKey, direction },
  });
}
