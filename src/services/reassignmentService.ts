import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import {
  NotFoundError,
  ValidationError,
  type ReassignmentChecklistDetail,
} from "../auth/errors";
import { adminDb } from "../db/adminClient";
import { withOrgContext } from "../db/orgScopedClient";
import { recordAuditEvent } from "../repositories/auditEvents";
import {
  assertEligibleAccountOwner,
  assertEligibleDealOwner,
  assertEligibleLeadOwner,
  assertEligibleTaskAssignee,
  loadActiveMemberWithPermissions,
} from "./ownerEligibility";

/**
 * What a member still owns (B1.05). Deactivating a member keeps everything
 * they own where it is -- but returns this checklist so Management can hand
 * the open work on; removing a member is blocked until the checklist is empty.
 *
 * "Owns" means open work: pending/in-progress tasks, leads that have not been
 * converted or archived, open deals, live companies and contacts, and
 * proposals that are not yet decided. Won and lost deals, completed tasks and
 * authored history stay attributed to the member and are never reassigned --
 * that history is the record of who did what.
 */
export const REASSIGNMENT_KINDS = [
  "tasks",
  "leads",
  "deals",
  "companies",
  "contacts",
  "proposals",
] as const;
export type ReassignmentKind = (typeof REASSIGNMENT_KINDS)[number];

/** How many records of each kind the checklist lists by name; the totals are always exact. */
const ITEMS_PER_KIND = 50;

const OPEN_TASK = { status: { in: ["PENDING", "IN_PROGRESS"] as ("PENDING" | "IN_PROGRESS")[] } };
const OPEN_PROPOSAL = {
  status: { in: ["DRAFT", "SENT", "VIEWED"] as ("DRAFT" | "SENT" | "VIEWED")[] },
};

export async function buildReassignmentChecklist(
  organizationId: string,
  membershipId: string,
): Promise<ReassignmentChecklistDetail> {
  const membership = await adminDb.membership.findFirst({
    where: { id: membershipId, organizationId },
    include: { user: { select: { name: true } } },
  });
  if (!membership) throw new NotFoundError("Membership", membershipId);

  const take = ITEMS_PER_KIND;
  const orderBy = { createdAt: "asc" as const };
  const [tasks, leads, deals, companies, contacts, proposals] = await withOrgContext(
    organizationId,
    async (tx) =>
      Promise.all([
        Promise.all([
          tx.task.count({ where: { organizationId, assigneeMembershipId: membershipId, ...OPEN_TASK } }),
          tx.task.findMany({
            where: { organizationId, assigneeMembershipId: membershipId, ...OPEN_TASK },
            select: { id: true, title: true },
            orderBy,
            take,
          }),
        ]),
        Promise.all([
          tx.lead.count({
            where: { organizationId, ownerMembershipId: membershipId, convertedAt: null, archivedAt: null },
          }),
          tx.lead.findMany({
            where: { organizationId, ownerMembershipId: membershipId, convertedAt: null, archivedAt: null },
            select: { id: true, company: { select: { name: true } }, contact: { select: { firstName: true, lastName: true } } },
            orderBy,
            take,
          }),
        ]),
        Promise.all([
          tx.deal.count({
            where: { organizationId, ownerMembershipId: membershipId, outcome: "OPEN", archivedAt: null },
          }),
          tx.deal.findMany({
            where: { organizationId, ownerMembershipId: membershipId, outcome: "OPEN", archivedAt: null },
            select: { id: true, company: { select: { name: true } } },
            orderBy,
            take,
          }),
        ]),
        Promise.all([
          tx.company.count({ where: { organizationId, ownerMembershipId: membershipId, archivedAt: null } }),
          tx.company.findMany({
            where: { organizationId, ownerMembershipId: membershipId, archivedAt: null },
            select: { id: true, name: true },
            orderBy,
            take,
          }),
        ]),
        Promise.all([
          tx.contact.count({ where: { organizationId, ownerMembershipId: membershipId, archivedAt: null } }),
          tx.contact.findMany({
            where: { organizationId, ownerMembershipId: membershipId, archivedAt: null },
            select: { id: true, firstName: true, lastName: true },
            orderBy,
            take,
          }),
        ]),
        Promise.all([
          tx.proposalReference.count({
            where: { organizationId, ownerMembershipId: membershipId, ...OPEN_PROPOSAL },
          }),
          tx.proposalReference.findMany({
            where: { organizationId, ownerMembershipId: membershipId, ...OPEN_PROPOSAL },
            select: { id: true, proposalNumber: true },
            orderBy,
            take,
          }),
        ]),
      ]),
  );

  const person = (c: { firstName: string | null; lastName: string | null } | null) =>
    [c?.firstName, c?.lastName].filter(Boolean).join(" ");
  const totals = {
    tasks: tasks[0],
    leads: leads[0],
    deals: deals[0],
    companies: companies[0],
    contacts: contacts[0],
    proposals: proposals[0],
  };
  return {
    membershipId,
    userName: membership.user.name,
    total: Object.values(totals).reduce((a, b) => a + b, 0),
    totals,
    items: {
      tasks: tasks[1].map((t) => ({ id: t.id, label: t.title })),
      leads: leads[1].map((l) => ({
        id: l.id,
        label: l.company?.name || person(l.contact) || "Lead",
      })),
      deals: deals[1].map((d) => ({ id: d.id, label: d.company?.name ?? "Deal" })),
      companies: companies[1].map((c) => ({ id: c.id, label: c.name })),
      contacts: contacts[1].map((c) => ({ id: c.id, label: person(c) || "Contact" })),
      proposals: proposals[1].map((p) => ({ id: p.id, label: p.proposalNumber })),
    },
  };
}

/** Management view of what a member owns, with names, before deciding what to do with them. */
export async function getMemberReassignmentChecklist(
  ctx: AuthContext,
  membershipId: string,
): Promise<ReassignmentChecklistDetail> {
  requirePermission(ctx, "membership.manage");
  return buildReassignmentChecklist(ctx.organizationId, membershipId);
}

export interface ReassignInput {
  toMembershipId: string;
  /** Which kinds to move; every kind with something to move when omitted. */
  kinds?: ReassignmentKind[];
}

export interface ReassignResult {
  moved: Record<ReassignmentKind, number>;
  total: number;
  remaining: ReassignmentChecklistDetail;
}

/**
 * Hands a member's open records to another active member in one step.
 * Checks the new owner can actually work every kind being moved (Finance
 * cannot own leads, say) before changing anything, so it either moves all it
 * was asked to or none.
 */
export async function reassignMemberRecords(
  ctx: AuthContext,
  fromMembershipId: string,
  input: ReassignInput,
): Promise<ReassignResult> {
  requirePermission(ctx, "membership.manage");
  const organizationId = ctx.organizationId;

  if (input.toMembershipId === fromMembershipId) {
    throw new ValidationError("Pick someone other than the member being reassigned.", [
      { path: "toMembershipId", message: "Choose a different member." },
    ]);
  }
  const from = await adminDb.membership.findFirst({
    where: { id: fromMembershipId, organizationId },
    select: { id: true },
  });
  if (!from) throw new NotFoundError("Membership", fromMembershipId);
  await loadActiveMemberWithPermissions(organizationId, input.toMembershipId);

  const current = await buildReassignmentChecklist(organizationId, fromMembershipId);
  const wanted = (input.kinds?.length ? input.kinds : [...REASSIGNMENT_KINDS]).filter(
    (kind) => current.totals[kind] > 0,
  );

  // Eligibility first, so a refusal leaves everything where it was.
  const to = input.toMembershipId;
  for (const kind of wanted) {
    if (kind === "tasks") await assertEligibleTaskAssignee(organizationId, to);
    if (kind === "leads") await assertEligibleLeadOwner(organizationId, to);
    if (kind === "deals") await assertEligibleDealOwner(organizationId, to);
    if (kind === "companies") await assertEligibleAccountOwner(organizationId, to, "companies");
    if (kind === "contacts") await assertEligibleAccountOwner(organizationId, to, "contacts");
  }

  const moved: Record<ReassignmentKind, number> = {
    tasks: 0,
    leads: 0,
    deals: 0,
    companies: 0,
    contacts: 0,
    proposals: 0,
  };
  await withOrgContext(organizationId, async (tx) => {
    const has = (k: ReassignmentKind) => wanted.includes(k);
    if (has("tasks")) {
      moved.tasks = (
        await tx.task.updateMany({
          where: { organizationId, assigneeMembershipId: fromMembershipId, ...OPEN_TASK },
          data: { assigneeMembershipId: to },
        })
      ).count;
    }
    if (has("leads")) {
      moved.leads = (
        await tx.lead.updateMany({
          where: { organizationId, ownerMembershipId: fromMembershipId, convertedAt: null, archivedAt: null },
          data: { ownerMembershipId: to },
        })
      ).count;
    }
    if (has("deals")) {
      moved.deals = (
        await tx.deal.updateMany({
          where: { organizationId, ownerMembershipId: fromMembershipId, outcome: "OPEN", archivedAt: null },
          data: { ownerMembershipId: to },
        })
      ).count;
    }
    if (has("companies")) {
      moved.companies = (
        await tx.company.updateMany({
          where: { organizationId, ownerMembershipId: fromMembershipId, archivedAt: null },
          data: { ownerMembershipId: to },
        })
      ).count;
    }
    if (has("contacts")) {
      moved.contacts = (
        await tx.contact.updateMany({
          where: { organizationId, ownerMembershipId: fromMembershipId, archivedAt: null },
          data: { ownerMembershipId: to },
        })
      ).count;
    }
    if (has("proposals")) {
      moved.proposals = (
        await tx.proposalReference.updateMany({
          where: { organizationId, ownerMembershipId: fromMembershipId, ...OPEN_PROPOSAL },
          data: { ownerMembershipId: to },
        })
      ).count;
    }
  });

  const total = Object.values(moved).reduce((a, b) => a + b, 0);
  if (total > 0) {
    await recordAuditEvent({
      organizationId,
      actorMembershipId: ctx.membershipId,
      action: "membership.records_reassigned",
      entityType: "Membership",
      entityId: fromMembershipId,
      metadata: { toMembershipId: to, ...moved },
    });
  }
  return {
    moved,
    total,
    remaining: await buildReassignmentChecklist(organizationId, fromMembershipId),
  };
}
