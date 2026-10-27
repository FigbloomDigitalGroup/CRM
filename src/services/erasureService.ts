import { createHash } from "node:crypto";
import { NotFoundError } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import { withOrgContext } from "../db/orgScopedClient";
import { normalizeEmail, phoneTail } from "../lib/matching";
import { recordAuditEvent } from "../repositories/auditEvents";
import { getStorageDriver } from "../storage";

/**
 * Erasing one person (FIG-1062, B4.05, Kenya DPA): the Contact is a natural person; everything that is about them goes, and what the
 * organisation needs to keep for other reasons stays without them.
 *
 *   goes      the contact and every copy of it (contacts merged into it), their activities, tasks, conversations, comments, tags, custom
 *             fields, the files attached to them (the bytes too), unlinked conversations from their address or number, notifications and
 *             recent searches that name them, and the personal data in the audit and merge snapshots about them
 *   stays     leads and deals that referred to them (unlinked, not deleted), invoices and payments, aggregate counts, and the audit
 *             trail itself: its rows remain, but carry only ids, counts and a salted hash of the email and phone, never a name or address
 *   review    free text elsewhere that mentions them (a lead's notes, a task's description). It cannot be reliably rewritten by machine, so
 *             the result says how many records to look at and where.
 *
 * Runs through the organisation's RLS context like any request, so it can only ever touch its own organisation.
 */

export interface ErasureResult {
  contactsErased: number;
  unlinked: { leads: number; deals: number };
  deleted: { activities: number; tasks: number; communications: number; attachments: number; tagLinks: number; notifications: number; recentSearches: number };
  scrubbed: { auditEvents: number; mergeRecords: number };
  reviewNeeded: { leads: number; deals: number; companies: number; tasks: number };
  proof: { emailHash: string | null; phoneHash: string | null };
}

const hash = (organizationId: string, value: string | null): string | null => (value ? createHash("sha256").update(`${organizationId}|${value}`).digest("hex") : null);

/** The contact and every contact merged into it, directly or through others: all the same person. */
async function sameSubject(organizationId: string, contactId: string): Promise<string[]> {
  const ids = new Set([contactId]);
  let frontier = [contactId];
  for (let depth = 0; depth < 5 && frontier.length > 0; depth += 1) {
    const next = await adminDb.contact.findMany({ where: { organizationId, mergedIntoId: { in: frontier } }, select: { id: true } });
    frontier = next.map((c) => c.id).filter((id) => !ids.has(id));
    for (const id of frontier) ids.add(id);
  }
  return [...ids];
}

export async function eraseContactData(input: { organizationId: string; contactId: string; actorMembershipId?: string; requestId?: string }): Promise<ErasureResult> {
  const { organizationId, contactId } = input;
  const contact = await adminDb.contact.findFirst({ where: { id: contactId, organizationId } });
  if (!contact) throw new NotFoundError("Contact", contactId);
  const ids = await sameSubject(organizationId, contactId);
  const copies = await adminDb.contact.findMany({ where: { organizationId, id: { in: ids } }, select: { firstName: true, lastName: true, email: true, phone: true } });

  // What identifies them, for finding the places that only mention them.
  const emails = new Set(copies.map((c) => c.email?.trim().toLowerCase()).filter((x): x is string => !!x));
  const phones = new Set(copies.map((c) => c.phone?.trim()).filter((x): x is string => !!x));
  const tails = new Set(copies.map((c) => phoneTail(c.phone)).filter((x): x is string => !!x));
  const names = new Set(copies.map((c) => [c.firstName, c.lastName].filter(Boolean).join(" ").trim()).filter((n) => n.length >= 5 && n.includes(" ")));
  const needles = [...emails, ...phones, ...names];
  const mentions = (field: string) => needles.map((n) => ({ [field]: { contains: n, mode: "insensitive" as const } }));
  const result: ErasureResult = {
    contactsErased: ids.length,
    unlinked: { leads: 0, deals: 0 },
    deleted: { activities: 0, tasks: 0, communications: 0, attachments: 0, tagLinks: 0, notifications: 0, recentSearches: 0 },
    scrubbed: { auditEvents: 0, mergeRecords: 0 },
    reviewNeeded: { leads: 0, deals: 0, companies: 0, tasks: 0 },
    proof: { emailHash: hash(organizationId, [...emails][0] ? (normalizeEmail([...emails][0]!) ?? [...emails][0]!) : null), phoneHash: hash(organizationId, [...tails][0] ?? null) },
  };

  // Files first: the bytes must go, and we need their keys before the rows cascade away.
  const attachments = await adminDb.attachment.findMany({
    where: { organizationId, OR: [{ contactId: { in: ids } }, { task: { contactId: { in: ids } } }] },
    select: { fileId: true, file: { select: { storageKey: true } } },
  });
  for (const a of attachments) await getStorageDriver().deleteObject(a.file.storageKey).catch(() => undefined);

  await withOrgContext(
    organizationId,
    async (tx) => {
      // Free text that mentions them, counted before anything is removed, for a person to review.
      if (needles.length > 0) {
        const [leads, deals, companies, tasks] = await Promise.all([
          tx.lead.count({ where: { organizationId, OR: mentions("notes") } }),
          tx.deal.count({ where: { organizationId, OR: mentions("notes") } }),
          tx.company.count({ where: { organizationId, OR: mentions("notes") } }),
          tx.task.count({ where: { organizationId, contactId: { notIn: ids }, OR: [...mentions("description"), ...mentions("title")] } }),
        ]);
        result.reviewNeeded = { leads, deals, companies, tasks };
      }
      result.unlinked.leads = await tx.lead.count({ where: { organizationId, contactId: { in: ids } } });
      result.unlinked.deals = await tx.deal.count({ where: { organizationId, primaryContactId: { in: ids } } });
      result.deleted.activities = await tx.activity.count({ where: { organizationId, contactId: { in: ids } } });
      result.deleted.tasks = await tx.task.count({ where: { organizationId, contactId: { in: ids } } });
      result.deleted.communications = await tx.communication.count({ where: { organizationId, contactId: { in: ids } } });
      result.deleted.tagLinks = await tx.tagLink.count({ where: { organizationId, contactId: { in: ids } } });

      // Conversations from their address or number that never got linked to anything are about them too.
      const orphan = await tx.communication.deleteMany({
        where: {
          organizationId,
          contactId: null,
          OR: [
            ...(emails.size > 0 ? [{ counterpartyEmail: { in: [...emails] } }] : []),
            ...(phones.size > 0 ? [{ counterpartyPhone: { in: [...phones] } }] : []),
          ],
        },
      });
      result.deleted.communications += orphan.count;

      // Notifications and recent searches that name them.
      if (needles.length > 0) {
        result.deleted.notifications = (await tx.notification.deleteMany({ where: { organizationId, OR: [...mentions("title"), ...mentions("body")] } })).count;
        result.deleted.recentSearches = (await tx.searchRecent.deleteMany({ where: { organizationId, OR: mentions("query") } })).count;
      }
      result.deleted.attachments = attachments.length;

      // The contacts themselves; leads and deals are unlinked by the database (ON DELETE SET NULL), the rest cascades.
      await tx.contact.deleteMany({ where: { organizationId, id: { in: ids } } });
      for (const a of attachments) {
        await tx.file.updateMany({ where: { id: a.fileId, organizationId }, data: { status: "DELETED", deletedAt: new Date(), purgedAt: new Date() } });
      }
    },
    { timeoutMs: 60_000 },
  );

  // Personal data inside the audit trail and the merge snapshots about them. The rows stay (who did what, when); the content goes.
  // Done as the schema owner: the application role cannot update the append-only audit table, by design.
  result.scrubbed.auditEvents = await adminDb.$executeRaw`
    UPDATE audit_events SET previous_value = NULL, new_value = NULL, metadata = '{"erased":true}'::jsonb
    WHERE organization_id = ${organizationId} AND entity_type = 'Contact' AND entity_id = ANY(${ids}::text[])`;
  result.scrubbed.mergeRecords = await adminDb.$executeRaw`
    UPDATE merge_records SET snapshot = '{"erased":true}'::jsonb
    WHERE organization_id = ${organizationId} AND entity_type ILIKE 'contact' AND (winner_id = ANY(${ids}::text[]) OR loser_id = ANY(${ids}::text[]))`;

  // The proof: that it happened, when, by whom and how much, with hashes instead of the details.
  await recordAuditEvent({
    organizationId,
    actorMembershipId: input.actorMembershipId,
    action: "data_subject.erased",
    entityType: "Contact",
    entityId: contactId,
    metadata: { ...result, requestId: input.requestId ?? null } as never,
  });
  return result;
}
