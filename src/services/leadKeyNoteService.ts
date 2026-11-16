import { textForViewer } from "../auth/masking";
import type { AuthContext } from "../auth/context";
import { hasPermission, requirePermission } from "../auth/context";
import { canView } from "../auth/permissions";
import { ValidationError } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import { withOrgContext } from "../db/orgScopedClient";

/**
 * Key notes on a lead (FIG-1678, P2-24). A "key note" is a lead's most recent NOTE activity, the same record the lead's
 * Conversation / timeline shows and `POST /activities` writes. There is no second notes store. One batched read answers for
 * every visible lead on a page (never one request per row).
 *
 * Rules: only leads the caller may open are answered (others are left out, as a 404 would be); `activities.view` is needed;
 * the text passes through `textForViewer` so a deal value typed into a note is hidden from roles without `deals.view.value`
 * (rule 7); the read runs inside the organisation's row-level security (rule 8). `canAdd` tells the screen whether to offer the
 * box or the explained "no access" state.
 */

export const KEY_NOTES_PER_LEAD = 3;
export const KEY_NOTES_MAX_LEADS = 50;

export interface KeyNote {
  id: string;
  authorName: string | null;
  occurredAt: string;
  text: string;
}
export interface LeadKeyNotes {
  total: number;
  notes: KeyNote[];
}
export interface LeadKeyNotesResult {
  canAdd: boolean;
  leads: Record<string, LeadKeyNotes>;
}

interface Row {
  id: string;
  lead_id: string;
  subject: string | null;
  description: string | null;
  occurred_at: Date;
  author_membership_id: string;
  total: bigint | number;
}

export async function listLeadKeyNotes(ctx: AuthContext, leadIds: string[]): Promise<LeadKeyNotesResult> {
  requirePermission(ctx, "activities.view");
  // A role that cannot open any lead gets the explained refusal, not an empty answer (the reviewed access matrix keeps leads to the roles that work them).
  if (!hasPermission(ctx, "leads.view.all") && !hasPermission(ctx, "leads.view.shared")) requirePermission(ctx, "leads.view.own");
  const ids = [...new Set(leadIds.filter(Boolean))];
  if (ids.length > KEY_NOTES_MAX_LEADS) throw new ValidationError(`Ask for at most ${KEY_NOTES_MAX_LEADS} leads at a time.`);
  const canAdd = hasPermission(ctx, "activities.create");
  if (ids.length === 0) return { canAdd, leads: {} };

  const leads = await adminDb.lead.findMany({ where: { organizationId: ctx.organizationId, id: { in: ids } }, select: { id: true, ownerMembershipId: true } });
  const visible = leads.filter((l) => canView(ctx, "leads", l)).map((l) => l.id);
  if (visible.length === 0) return { canAdd, leads: {} };

  const rows = await withOrgContext(ctx.organizationId, (tx) =>
    tx.$queryRaw<Row[]>`
      SELECT id, lead_id, subject, description, occurred_at, author_membership_id, total FROM (
        SELECT a.id, a.lead_id, a.subject, a.description, a.occurred_at, a.author_membership_id,
               ROW_NUMBER() OVER (PARTITION BY a.lead_id ORDER BY a.occurred_at DESC, a.id DESC) AS rn,
               COUNT(*) OVER (PARTITION BY a.lead_id) AS total
        FROM activities a
        WHERE a.organization_id = ${ctx.organizationId} AND a.type = 'NOTE' AND a.lead_id = ANY(${visible}::text[])
      ) n WHERE rn <= ${KEY_NOTES_PER_LEAD} ORDER BY lead_id, rn`,
  );

  const authorIds = [...new Set(rows.map((r) => r.author_membership_id))];
  const authors = authorIds.length
    ? await adminDb.membership.findMany({ where: { organizationId: ctx.organizationId, id: { in: authorIds } }, select: { id: true, user: { select: { name: true } } } })
    : [];
  const nameOf = new Map(authors.map((a) => [a.id, a.user.name]));

  const out: Record<string, LeadKeyNotes> = {};
  for (const id of visible) out[id] = { total: 0, notes: [] };
  for (const r of rows) {
    const body = (r.description ?? "").trim() || (r.subject && r.subject !== "Note" ? r.subject : "");
    const entry = out[r.lead_id]!;
    entry.total = Number(r.total);
    entry.notes.push({ id: r.id, authorName: nameOf.get(r.author_membership_id) ?? null, occurredAt: r.occurred_at.toISOString(), text: textForViewer(ctx, body) });
  }
  return { canAdd, leads: out };
}
