import type { Prisma } from "@prisma/client";
import { withOrgContext, type OrgScopedClient } from "../db/orgScopedClient";

/**
 * Merging two companies or two contacts, and undoing it (FIG-601, FIG-1033).
 *
 * A merge moves everything that points at the loser onto the winner, applies
 * the field choices to the winner, and archives the loser with `mergedIntoId`
 * set. It runs in one transaction and writes a `merge_records` row listing the
 * ids it moved and the field values before and after, so an undo within the
 * window can put everything back. Nothing is deleted.
 *
 * Every table that can point at a company or contact has a line in `LINKS`.
 * A new record type that links to a company or contact (attachments, tags,
 * comments, custom field values) must add its line here, or a merge would leave
 * it behind on the archived loser. `tests/mergeDuplicates.test.ts` covers each.
 */

export type MergeEntity = "Company" | "Contact";

interface Link {
  /** Key in the snapshot. */
  key: string;
  /** Moves the rows from `from` to `to` and returns the ids moved. */
  move: (tx: OrgScopedClient, organizationId: string, from: string, to: string) => Promise<string[]>;
  /** Moves exactly these rows back, only if they still point at `from`. */
  moveBack: (tx: OrgScopedClient, organizationId: string, ids: string[], from: string, to: string) => Promise<void>;
}

/** Defines a link for a table with one id column pointing at the merged record. */
function link<
  D extends {
    findMany: (args: never) => Promise<{ id: string }[]>;
    updateMany: (args: never) => Promise<unknown>;
  },
>(key: string, delegate: (tx: OrgScopedClient) => D, column: string): Link {
  return {
    key,
    async move(tx, organizationId, from, to) {
      const d = delegate(tx);
      const rows = await d.findMany({ where: { organizationId, [column]: from }, select: { id: true } } as never);
      const ids = rows.map((r) => r.id);
      if (ids.length > 0) await d.updateMany({ where: { organizationId, id: { in: ids } }, data: { [column]: to } } as never);
      return ids;
    },
    async moveBack(tx, organizationId, ids, from, to) {
      if (ids.length === 0) return;
      await delegate(tx).updateMany({ where: { organizationId, id: { in: ids }, [column]: from }, data: { [column]: to } } as never);
    },
  };
}

/**
 * Tag links move like any other link, except a tag the winner already has: the
 * loser duplicate is dropped (and recorded as `drop:<tagId>` so an undo can give
 * it back).
 */
function tagLinks(column: "companyId" | "contactId"): Link {
  return {
    key: "tagLinks",
    async move(tx, organizationId, from, to) {
      const loserLinks = await tx.tagLink.findMany({ where: { organizationId, [column]: from }, select: { id: true, tagId: true } });
      const winnerTags = new Set(
        (await tx.tagLink.findMany({ where: { organizationId, [column]: to }, select: { tagId: true } })).map((l) => l.tagId),
      );
      const moved: string[] = [];
      for (const link of loserLinks) {
        if (winnerTags.has(link.tagId)) {
          await tx.tagLink.delete({ where: { id: link.id } });
          moved.push(`drop:${link.tagId}`);
        } else {
          await tx.tagLink.update({ where: { id: link.id }, data: { [column]: to } });
          moved.push(link.id);
        }
      }
      return moved;
    },
    async moveBack(tx, organizationId, ids, from, to) {
      for (const id of ids) {
        if (id.startsWith("drop:")) {
          await tx.tagLink.createMany({ data: [{ organizationId, tagId: id.slice(5), [column]: to }], skipDuplicates: true });
        } else {
          await tx.tagLink.updateMany({ where: { id, organizationId, [column]: from }, data: { [column]: to } });
        }
      }
    },
  };
}

/**
 * Follows move like tag links: a member who already follows the winner keeps
 * that one and the loser's is dropped (recorded as `drop:<membershipId>` so an
 * undo gives it back).
 */
function followLinks(column: "companyId" | "contactId"): Link {
  return {
    key: "recordFollows",
    async move(tx, organizationId, from, to) {
      const loserFollows = await tx.recordFollow.findMany({ where: { organizationId, [column]: from }, select: { id: true, membershipId: true } });
      const winnerMembers = new Set(
        (await tx.recordFollow.findMany({ where: { organizationId, [column]: to }, select: { membershipId: true } })).map((f) => f.membershipId),
      );
      const moved: string[] = [];
      for (const follow of loserFollows) {
        if (winnerMembers.has(follow.membershipId)) {
          await tx.recordFollow.delete({ where: { id: follow.id } });
          moved.push(`drop:${follow.membershipId}`);
        } else {
          await tx.recordFollow.update({ where: { id: follow.id }, data: { [column]: to } });
          moved.push(follow.id);
        }
      }
      return moved;
    },
    async moveBack(tx, organizationId, ids, from, to) {
      for (const id of ids) {
        if (id.startsWith("drop:")) {
          await tx.recordFollow.createMany({ data: [{ organizationId, membershipId: id.slice(5), [column]: to }], skipDuplicates: true });
        } else {
          await tx.recordFollow.updateMany({ where: { id, organizationId, [column]: from }, data: { [column]: to } });
        }
      }
    },
  };
}

const COMPANY_LINKS: Link[] = [
  link("contacts", (tx) => tx.contact, "companyId"),
  link("leads", (tx) => tx.lead, "companyId"),
  link("deals", (tx) => tx.deal, "companyId"),
  link("activities", (tx) => tx.activity, "companyId"),
  link("tasks", (tx) => tx.task, "companyId"),
  link("communications", (tx) => tx.communication, "companyId"),
  link("companyServices", (tx) => tx.companyService, "companyId"),
  link("attachments", (tx) => tx.attachment, "companyId"),
  link("comments", (tx) => tx.comment, "companyId"),
  followLinks("companyId"),
  tagLinks("companyId"),
];

const CONTACT_LINKS: Link[] = [
  link("leads", (tx) => tx.lead, "contactId"),
  link("dealsAsPrimary", (tx) => tx.deal, "primaryContactId"),
  link("activities", (tx) => tx.activity, "contactId"),
  link("tasks", (tx) => tx.task, "contactId"),
  link("communications", (tx) => tx.communication, "contactId"),
  link("attachments", (tx) => tx.attachment, "contactId"),
  link("comments", (tx) => tx.comment, "contactId"),
  followLinks("contactId"),
  tagLinks("contactId"),
];

/** Fields a person may choose between when merging. Values are copied from the loser when it is chosen. */
export const MERGE_FIELDS: Record<MergeEntity, readonly string[]> = {
  Company: ["name", "industry", "website", "location", "phone", "email", "notes", "lifecycleStateId", "ownerMembershipId"],
  Contact: ["firstName", "lastName", "phone", "email", "jobTitle", "department", "notes", "ownerMembershipId"],
};

type Row = Record<string, unknown>;

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

/**
 * The field changes a merge applies to the winner. With explicit choices only
 * those fields change (to the loser's value); with none, fields the winner left
 * blank take the loser's value, so nothing the loser knew is lost.
 */
export function planFieldChanges(
  entity: MergeEntity,
  winner: Row,
  loser: Row,
  choices: Record<string, "winner" | "loser"> | undefined,
): Record<string, unknown> {
  const changes: Record<string, unknown> = {};
  for (const field of MERGE_FIELDS[entity]) {
    const choice = choices?.[field];
    if (choice === "loser") {
      if (winner[field] !== loser[field]) changes[field] = loser[field] ?? null;
    } else if (choice === undefined && !choices) {
      if (isBlank(winner[field]) && !isBlank(loser[field])) changes[field] = loser[field];
    }
  }
  return changes;
}

export interface MergeInput {
  organizationId: string;
  entity: MergeEntity;
  loserId: string;
  winnerId: string;
  mergedByMembershipId: string;
  choices?: Record<string, "winner" | "loser">;
  undoExpiresAt: Date;
  archiveReason: string;
}

export interface MergeOutcome<R = Row> {
  mergeRecordId: string;
  loser: R;
  winner: R;
  moved: Record<string, number>;
  changedFields: string[];
}

function delegateFor(tx: OrgScopedClient, entity: MergeEntity) {
  return entity === "Company" ? tx.company : tx.contact;
}

export function mergeRecords<R = Row>(input: MergeInput): Promise<MergeOutcome<R>> {
  const links = input.entity === "Company" ? COMPANY_LINKS : CONTACT_LINKS;
  return withOrgContext(input.organizationId, async (tx) => {
    const d = delegateFor(tx, input.entity) as unknown as {
      findUniqueOrThrow: (a: unknown) => Promise<Row>;
      update: (a: unknown) => Promise<Row>;
    };
    const winnerBefore = await d.findUniqueOrThrow({ where: { id: input.winnerId, organizationId: input.organizationId } });
    const loserBefore = await d.findUniqueOrThrow({ where: { id: input.loserId, organizationId: input.organizationId } });

    const moved: Record<string, string[]> = {};
    for (const l of links) moved[l.key] = await l.move(tx, input.organizationId, input.loserId, input.winnerId);

    const changes = planFieldChanges(input.entity, winnerBefore, loserBefore, input.choices);
    const winnerAfter = Object.keys(changes).length
      ? await d.update({ where: { id: input.winnerId, organizationId: input.organizationId }, data: changes })
      : winnerBefore;

    const loserAfter = await d.update({
      where: { id: input.loserId, organizationId: input.organizationId },
      data: {
        archivedAt: new Date(),
        archivedByMembershipId: input.mergedByMembershipId,
        archiveReason: input.archiveReason,
        mergedIntoId: input.winnerId,
      },
    });

    const changedFields = Object.keys(changes);
    const record = await tx.mergeRecord.create({
      data: {
        organizationId: input.organizationId,
        entityType: input.entity,
        winnerId: input.winnerId,
        loserId: input.loserId,
        mergedByMembershipId: input.mergedByMembershipId,
        undoExpiresAt: input.undoExpiresAt,
        snapshot: {
          moved,
          before: Object.fromEntries(changedFields.map((f) => [f, winnerBefore[f] ?? null])),
          after: Object.fromEntries(changedFields.map((f) => [f, changes[f] ?? null])),
        } as Prisma.InputJsonValue,
      },
    });

    return {
      mergeRecordId: record.id,
      loser: loserAfter as R,
      winner: winnerAfter as R,
      moved: Object.fromEntries(Object.entries(moved).map(([k, v]) => [k, v.length])),
      changedFields,
    };
  });
}

export function getMergeRecord(organizationId: string, mergeRecordId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.mergeRecord.findFirst({ where: { id: mergeRecordId, organizationId } }),
  );
}

export function listMergeRecords(organizationId: string, entity: MergeEntity, recordId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.mergeRecord.findMany({
      where: { organizationId, entityType: entity, OR: [{ winnerId: recordId }, { loserId: recordId }] },
      orderBy: { mergedAt: "desc" },
    }),
  );
}

interface Snapshot {
  moved: Record<string, string[]>;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

/**
 * Puts a merge back: the moved rows return to the loser, the winner's merged
 * fields return to their earlier values (only where nobody has edited them
 * since), and the loser is active again. The caller has checked the window.
 */
export function undoMergeRecords(organizationId: string, mergeRecordId: string, undoneByMembershipId: string) {
  return withOrgContext(organizationId, async (tx) => {
    const record = await tx.mergeRecord.findFirstOrThrow({ where: { id: mergeRecordId, organizationId } });
    const entity = record.entityType as MergeEntity;
    const links = entity === "Company" ? COMPANY_LINKS : CONTACT_LINKS;
    const snapshot = record.snapshot as unknown as Snapshot;

    for (const l of links) {
      await l.moveBack(tx, organizationId, snapshot.moved[l.key] ?? [], record.winnerId, record.loserId);
    }

    const d = delegateFor(tx, entity) as unknown as {
      findUniqueOrThrow: (a: unknown) => Promise<Row>;
      update: (a: unknown) => Promise<Row>;
    };
    const winnerNow = await d.findUniqueOrThrow({ where: { id: record.winnerId, organizationId } });
    const restore: Record<string, unknown> = {};
    for (const [field, before] of Object.entries(snapshot.before)) {
      if (winnerNow[field] === snapshot.after[field]) restore[field] = before;
    }
    if (Object.keys(restore).length > 0) {
      await d.update({ where: { id: record.winnerId, organizationId }, data: restore });
    }
    const loser = await d.update({
      where: { id: record.loserId, organizationId },
      data: { archivedAt: null, archivedByMembershipId: null, archiveReason: null, mergedIntoId: null },
    });
    await tx.mergeRecord.update({
      where: { id: record.id },
      data: { undoneAt: new Date(), undoneByMembershipId },
    });
    return { loser, restoredFields: Object.keys(restore) };
  });
}
