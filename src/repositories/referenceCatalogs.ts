import { type OrgScopedClient, withOrgContext } from "../db/orgScopedClient";

/**
 * The 5 organization-configurable reference-data catalogs covered by
 * FIG-599 (CustomerLifecycleState is the same shape but out of this
 * ticket's scope). Keyed by the plural name used in routes/UI; `delegateFor`
 * below maps each to its actual Prisma model.
 */
export const CATALOG_KEYS = [
  "leadSources",
  "leadStatuses",
  "pipelineStages",
  "lostReasons",
  "services",
] as const;

export type CatalogKey = (typeof CATALOG_KEYS)[number];

export function isCatalogKey(value: string): value is CatalogKey {
  return (CATALOG_KEYS as readonly string[]).includes(value);
}

/**
 * Superset of every field any one catalog can have. LeadSource/LeadStatus/
 * LostReason only ever populate the first block; PipelineStage additionally
 * has `probability`/`isWon`/`isLost`; Service has `category` instead.
 */
export interface CatalogEntry {
  id: string;
  organizationId: string;
  key: string;
  name: string;
  description: string | null;
  sequence: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  probability?: number | null;
  isWon?: boolean;
  isLost?: boolean;
  category?: string | null;
}

export interface CreateCatalogEntryInput {
  key: string;
  name: string;
  description?: string;
  probability?: number;
  isWon?: boolean;
  isLost?: boolean;
  category?: string;
}

export interface UpdateCatalogEntryInput {
  name?: string;
  description?: string | null;
  probability?: number | null;
  isWon?: boolean;
  isLost?: boolean;
  category?: string | null;
  isActive?: boolean;
  sequence?: number;
}

/**
 * Every catalog delegate exposes the same CRUD methods Prisma generates for
 * any model -- this is a deliberate `any`-boundary cast so the 5 near-
 * identical catalogs share one implementation instead of 5 copy-pasted
 * repository files. Callers of this module only ever see the typed
 * `CatalogEntry` shape above.
 */
function delegateFor(tx: OrgScopedClient, catalogKey: CatalogKey) {
  const delegates = {
    leadSources: tx.leadSource,
    leadStatuses: tx.leadStatus,
    pipelineStages: tx.pipelineStage,
    lostReasons: tx.lostReason,
    services: tx.service,
  } as const;
  return delegates[catalogKey] as unknown as {
    findMany: (args: unknown) => Promise<CatalogEntry[]>;
    findFirst: (args: unknown) => Promise<CatalogEntry | null>;
    create: (args: unknown) => Promise<CatalogEntry>;
    update: (args: unknown) => Promise<CatalogEntry>;
    count: (args: unknown) => Promise<number>;
  };
}

/** Both active and inactive rows -- the management UI needs to show (and reactivate) inactive ones too. */
export async function listCatalogEntries(
  organizationId: string,
  catalogKey: CatalogKey,
): Promise<CatalogEntry[]> {
  return withOrgContext(organizationId, (tx) =>
    delegateFor(tx, catalogKey).findMany({
      where: { organizationId },
      orderBy: [{ sequence: "asc" }, { name: "asc" }],
    }),
  );
}

export async function getCatalogEntryById(
  organizationId: string,
  catalogKey: CatalogKey,
  id: string,
): Promise<CatalogEntry | null> {
  return withOrgContext(organizationId, (tx) =>
    delegateFor(tx, catalogKey).findFirst({ where: { organizationId, id } }),
  );
}

/** New entries sort after every existing one by default. */
export async function createCatalogEntry(
  organizationId: string,
  catalogKey: CatalogKey,
  input: CreateCatalogEntryInput,
): Promise<CatalogEntry> {
  return withOrgContext(organizationId, async (tx) => {
    const delegate = delegateFor(tx, catalogKey);
    const maxSequence = await delegate.findMany({
      where: { organizationId },
      orderBy: { sequence: "desc" },
      take: 1,
      select: { sequence: true },
    });
    const nextSequence = (maxSequence[0]?.sequence ?? 0) + 1;

    return delegate.create({
      data: {
        organizationId,
        key: input.key,
        name: input.name,
        description: input.description,
        sequence: nextSequence,
        ...(catalogKey === "pipelineStages"
          ? {
              probability: input.probability,
              isWon: input.isWon ?? false,
              isLost: input.isLost ?? false,
            }
          : {}),
        ...(catalogKey === "services" ? { category: input.category } : {}),
      },
    });
  });
}

export async function updateCatalogEntry(
  organizationId: string,
  catalogKey: CatalogKey,
  id: string,
  input: UpdateCatalogEntryInput,
): Promise<CatalogEntry> {
  return withOrgContext(organizationId, (tx) =>
    delegateFor(tx, catalogKey).update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        isActive: input.isActive,
        sequence: input.sequence,
        ...(catalogKey === "pipelineStages"
          ? {
              probability: input.probability,
              isWon: input.isWon,
              isLost: input.isLost,
            }
          : {}),
        ...(catalogKey === "services" ? { category: input.category } : {}),
      },
    }),
  );
}

/**
 * Swaps `sequence` with the adjacent active-or-inactive neighbor in display
 * order -- a no-op at either boundary. Runs inside a single transaction so
 * two concurrent moves can't produce a duplicate sequence value.
 */
export async function moveCatalogEntry(
  organizationId: string,
  catalogKey: CatalogKey,
  id: string,
  direction: "up" | "down",
): Promise<void> {
  await withOrgContext(organizationId, async (tx) => {
    const delegate = delegateFor(tx, catalogKey);
    const all = await delegate.findMany({
      where: { organizationId },
      orderBy: [{ sequence: "asc" }, { name: "asc" }],
    });
    const index = all.findIndex((entry) => entry.id === id);
    if (index === -1) return;

    const neighborIndex = direction === "up" ? index - 1 : index + 1;
    if (neighborIndex < 0 || neighborIndex >= all.length) return;

    const current = all[index]!;
    const neighbor = all[neighborIndex]!;
    await delegate.update({ where: { id: current.id }, data: { sequence: neighbor.sequence } });
    await delegate.update({ where: { id: neighbor.id }, data: { sequence: current.sequence } });
  });
}

/**
 * How many Lead/Deal/Company/CompanyService rows currently reference this
 * entry -- shown in the UI so deactivating something still in heavy use is
 * an informed choice, not a blind one. Deactivation itself never blocks on
 * this count: existing records keep their foreign key untouched (`isActive`
 * only gates picking a value for a *new* record), and the hard-delete path
 * doesn't exist at all for these catalogs.
 */
export async function countCatalogEntryUsage(
  organizationId: string,
  catalogKey: CatalogKey,
  id: string,
): Promise<number> {
  return withOrgContext(organizationId, async (tx) => {
    switch (catalogKey) {
      case "leadSources":
        return tx.lead.count({ where: { organizationId, leadSourceId: id } });
      case "leadStatuses":
        return tx.lead.count({ where: { organizationId, leadStatusId: id } });
      case "pipelineStages":
        return tx.deal.count({ where: { organizationId, pipelineStageId: id } });
      case "lostReasons": {
        const [leads, deals] = await Promise.all([
          tx.lead.count({ where: { organizationId, lostReasonId: id } }),
          tx.deal.count({ where: { organizationId, lostReasonId: id } }),
        ]);
        return leads + deals;
      }
      case "services": {
        const [leads, deals, companyServices] = await Promise.all([
          tx.lead.count({ where: { organizationId, serviceInterestId: id } }),
          tx.deal.count({ where: { organizationId, serviceId: id } }),
          tx.companyService.count({ where: { organizationId, serviceId: id } }),
        ]);
        return leads + deals + companyServices;
      }
    }
  });
}
