import { Prisma } from "@prisma/client";
import { withOrgContext } from "../db/orgScopedClient";

/** Data access for `tags` and `tag_links` (FIG-798). Every call runs inside the organisation's RLS context. */

export type TaggableEntity = "lead" | "contact" | "company" | "deal";

const LINK_COLUMN: Record<TaggableEntity, "leadId" | "contactId" | "companyId" | "dealId"> = {
  lead: "leadId",
  contact: "contactId",
  company: "companyId",
  deal: "dealId",
};

export interface TagSummary {
  id: string;
  name: string;
  colour: string;
}

/** Spread into a record's `include` to load its tags. */
export const TAG_LINKS_INCLUDE = {
  tagLinks: {
    select: { tag: { select: { id: true, name: true, colour: true } } },
    orderBy: { tag: { name: "asc" } },
  },
} satisfies Prisma.LeadInclude;

type WithLinks = { tagLinks?: { tag: TagSummary }[] };

/** A record row with its tag links flattened to `tags: [{ id, name, colour }]`. */
export function flattenTags<T extends WithLinks>(row: T): Omit<T, "tagLinks"> & { tags: TagSummary[] } {
  const { tagLinks, ...rest } = row;
  return { ...rest, tags: (tagLinks ?? []).map((l) => l.tag) };
}

/** `tagIds` list filter: records carrying any of these tags. */
export function tagFilter(tagIds: string[] | undefined) {
  return tagIds && tagIds.length > 0 ? { tagLinks: { some: { tagId: { in: tagIds } } } } : {};
}

/** `onlyActive` is what a picker wants (B4.06: a hidden tag leaves the pickers); the settings list asks for every tag. */
export function listTagsWithUsage(organizationId: string, query?: string, onlyActive = false) {
  return withOrgContext(organizationId, async (tx) => {
    const tags = await tx.tag.findMany({
      where: { organizationId, ...(onlyActive ? { isActive: true } : {}), ...(query ? { name: { contains: query, mode: "insensitive" } } : {}) },
      orderBy: { name: "asc" },
      take: 500,
    });
    const counts = await tx.tagLink.groupBy({
      by: ["tagId"],
      where: { organizationId, tagId: { in: tags.map((t) => t.id) } },
      _count: { _all: true },
    });
    const usage = new Map(counts.map((c) => [c.tagId, c._count._all]));
    return tags.map((t) => ({ ...t, usage: usage.get(t.id) ?? 0 }));
  });
}

export function getTag(organizationId: string, id: string) {
  return withOrgContext(organizationId, (tx) => tx.tag.findFirst({ where: { id, organizationId } }));
}

export function findTagByName(organizationId: string, name: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.tag.findFirst({ where: { organizationId, name: { equals: name, mode: "insensitive" } } }),
  );
}

export function findTagsByIds(organizationId: string, ids: string[]) {
  if (ids.length === 0) return Promise.resolve([]);
  return withOrgContext(organizationId, (tx) => tx.tag.findMany({ where: { organizationId, id: { in: ids } } }));
}

export function createTagRecord(input: { organizationId: string; name: string; colour: string; createdByMembershipId?: string }) {
  return withOrgContext(input.organizationId, (tx) => tx.tag.create({ data: input }));
}

export function updateTagRecord(organizationId: string, id: string, data: { name?: string; colour?: string }) {
  return withOrgContext(organizationId, (tx) => tx.tag.update({ where: { id, organizationId }, data }));
}

export function deleteTagRecord(organizationId: string, id: string) {
  return withOrgContext(organizationId, (tx) => tx.tag.delete({ where: { id, organizationId } }));
}

/**
 * Moves every link of `fromId` to `intoId`, dropping the ones whose record
 * already has `intoId`, then deletes `fromId`. Returns how many links moved.
 */
export function mergeTagRecords(organizationId: string, fromId: string, intoId: string) {
  return withOrgContext(organizationId, async (tx) => {
    const moved = await tx.$executeRaw`
      UPDATE tag_links SET tag_id = ${intoId}
      WHERE organization_id = ${organizationId} AND tag_id = ${fromId}
        AND NOT EXISTS (
          SELECT 1 FROM tag_links t2
          WHERE t2.tag_id = ${intoId}
            AND t2.company_id IS NOT DISTINCT FROM tag_links.company_id
            AND t2.contact_id IS NOT DISTINCT FROM tag_links.contact_id
            AND t2.lead_id IS NOT DISTINCT FROM tag_links.lead_id
            AND t2.deal_id IS NOT DISTINCT FROM tag_links.deal_id
        )`;
    await tx.tagLink.deleteMany({ where: { organizationId, tagId: fromId } });
    await tx.tag.delete({ where: { id: fromId, organizationId } });
    return moved;
  });
}

export function listTagsForRecord(organizationId: string, entity: TaggableEntity, recordId: string) {
  return withOrgContext(organizationId, async (tx) => {
    const links = await tx.tagLink.findMany({
      where: { organizationId, [LINK_COLUMN[entity]]: recordId },
      select: { tag: { select: { id: true, name: true, colour: true } } },
      orderBy: { tag: { name: "asc" } },
    });
    return links.map((l) => l.tag);
  });
}

export function countTagsForRecord(organizationId: string, entity: TaggableEntity, recordId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.tagLink.count({ where: { organizationId, [LINK_COLUMN[entity]]: recordId } }),
  );
}

/** Adds links (ignoring ones that exist) and removes others, in one transaction. */
export function changeRecordTags(input: {
  organizationId: string;
  entity: TaggableEntity;
  recordId: string;
  addTagIds: string[];
  removeTagIds: string[];
  createdByMembershipId?: string;
}) {
  const column = LINK_COLUMN[input.entity];
  return withOrgContext(input.organizationId, async (tx) => {
    if (input.removeTagIds.length > 0) {
      await tx.tagLink.deleteMany({
        where: { organizationId: input.organizationId, [column]: input.recordId, tagId: { in: input.removeTagIds } },
      });
    }
    if (input.addTagIds.length > 0) {
      await tx.tagLink.createMany({
        data: input.addTagIds.map((tagId) => ({
          organizationId: input.organizationId,
          tagId,
          [column]: input.recordId,
          createdByMembershipId: input.createdByMembershipId,
        })),
        skipDuplicates: true,
      });
    }
  });
}

/** Tag names for many records at once, for exports. */
export function tagNamesForRecords(organizationId: string, entity: TaggableEntity, recordIds: string[]) {
  if (recordIds.length === 0) return Promise.resolve(new Map<string, string[]>());
  const column = LINK_COLUMN[entity];
  return withOrgContext(organizationId, async (tx) => {
    const links = await tx.tagLink.findMany({
      where: { organizationId, [column]: { in: recordIds } },
      select: { leadId: true, contactId: true, companyId: true, dealId: true, tag: { select: { name: true } } },
    });
    const map = new Map<string, string[]>();
    for (const link of links) {
      const id = link[column];
      if (!id) continue;
      map.set(id, [...(map.get(id) ?? []), link.tag.name]);
    }
    for (const [id, names] of map) map.set(id, names.sort((a, b) => a.localeCompare(b)));
    return map;
  });
}
