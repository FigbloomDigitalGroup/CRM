import { type OrgScopedClient, withOrgContext } from "../db/orgScopedClient";

export interface AssignmentRule {
  id: string;
  organizationId: string;
  name: string;
  leadSourceId: string | null;
  serviceId: string | null;
  assigneeMembershipId: string | null;
  assigneeMembershipIds: string[];
  lastAssignedMembershipId: string | null;
  sequence: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface RuleFields {
  name: string;
  leadSourceId: string | null;
  serviceId: string | null;
  assigneeMembershipId: string | null;
  assigneeMembershipIds: string[];
}

export async function listRules(organizationId: string): Promise<AssignmentRule[]> {
  return withOrgContext(organizationId, (tx) =>
    tx.websiteLeadAssignmentRule.findMany({
      where: { organizationId },
      orderBy: [{ sequence: "asc" }, { name: "asc" }],
    }),
  );
}

export async function getRuleById(
  organizationId: string,
  id: string,
): Promise<AssignmentRule | null> {
  return withOrgContext(organizationId, (tx) =>
    tx.websiteLeadAssignmentRule.findFirst({ where: { organizationId, id } }),
  );
}

/** New rules sort after every existing one by default, same as the reference catalogs. */
export async function createRule(
  organizationId: string,
  input: RuleFields,
): Promise<AssignmentRule> {
  return withOrgContext(organizationId, async (tx) => {
    const maxSequence = await tx.websiteLeadAssignmentRule.findMany({
      where: { organizationId },
      orderBy: { sequence: "desc" },
      take: 1,
      select: { sequence: true },
    });
    const nextSequence = (maxSequence[0]?.sequence ?? 0) + 1;

    return tx.websiteLeadAssignmentRule.create({
      data: {
        organizationId,
        name: input.name,
        leadSourceId: input.leadSourceId,
        serviceId: input.serviceId,
        assigneeMembershipId: input.assigneeMembershipId,
        assigneeMembershipIds: input.assigneeMembershipIds,
        sequence: nextSequence,
      },
    });
  });
}

export async function updateRule(
  organizationId: string,
  id: string,
  input: Partial<RuleFields> & { isActive?: boolean },
): Promise<AssignmentRule> {
  return withOrgContext(organizationId, (tx) =>
    tx.websiteLeadAssignmentRule.update({
      where: { id },
      data: {
        name: input.name,
        leadSourceId: input.leadSourceId,
        serviceId: input.serviceId,
        assigneeMembershipId: input.assigneeMembershipId,
        assigneeMembershipIds: input.assigneeMembershipIds,
        isActive: input.isActive,
      },
    }),
  );
}

/**
 * Swaps `sequence` with the adjacent neighbor in display order -- a no-op
 * at either boundary. Same pattern as `moveCatalogEntry` in
 * `referenceCatalogs.ts`, run inside a single transaction so two concurrent
 * moves can't produce a duplicate sequence value.
 */
export async function moveRule(
  organizationId: string,
  id: string,
  direction: "up" | "down",
): Promise<void> {
  await withOrgContext(organizationId, async (tx) => {
    const all = await tx.websiteLeadAssignmentRule.findMany({
      where: { organizationId },
      orderBy: [{ sequence: "asc" }, { name: "asc" }],
    });
    const index = all.findIndex((rule) => rule.id === id);
    if (index === -1) return;

    const neighborIndex = direction === "up" ? index - 1 : index + 1;
    if (neighborIndex < 0 || neighborIndex >= all.length) return;

    const current = all[index]!;
    const neighbor = all[neighborIndex]!;
    await tx.websiteLeadAssignmentRule.update({
      where: { id: current.id },
      data: { sequence: neighbor.sequence },
    });
    await tx.websiteLeadAssignmentRule.update({
      where: { id: neighbor.id },
      data: { sequence: current.sequence },
    });
  });
}

/**
 * The rule engine itself (FIG-751), called from inside `ingestWebsiteLead`'s
 * own transaction so a match's round-robin cursor update is atomic with the
 * Lead it's assigning. Active rules are checked in `sequence` order; the
 * first one whose non-null `leadSourceId`/`serviceId` both match the
 * incoming lead AND has a currently-eligible assignee wins. A rule that
 * matches but has nobody eligible (its specific rep went inactive, or every
 * member of its round-robin group did) is skipped rather than treated as a
 * dead end -- the next rule in sequence still gets a chance. Returning
 * `null` means "no rule applies" and the caller falls back to the existing
 * global round-robin/unassigned switch.
 */
export async function pickOwnerForRule(
  tx: OrgScopedClient,
  organizationId: string,
  match: { leadSourceId: string | null; serviceId: string | null },
): Promise<string | null> {
  const rules = await tx.websiteLeadAssignmentRule.findMany({
    where: { organizationId, isActive: true },
    orderBy: { sequence: "asc" },
  });

  for (const rule of rules) {
    const sourceOk = rule.leadSourceId === null || rule.leadSourceId === match.leadSourceId;
    const serviceOk = rule.serviceId === null || rule.serviceId === match.serviceId;
    if (!sourceOk || !serviceOk) continue;

    if (rule.assigneeMembershipId) {
      const membership = await tx.membership.findFirst({
        where: { id: rule.assigneeMembershipId, organizationId, status: "ACTIVE" },
        select: { id: true },
      });
      if (membership) return membership.id;
      continue;
    }

    if (rule.assigneeMembershipIds.length > 0) {
      // Locks this rule's own row for the transaction's duration, so two
      // concurrent submissions matching the same rule can't grab the same
      // group member -- the same mechanism as the global cursor in
      // leadIngestion.ts's pickNextAssignmentOwner, scoped to this one row.
      //
      // Reads `last_assigned_membership_id` back in the SAME query that
      // takes the lock -- not the `rule` object fetched before the lock
      // above -- so a transaction that waited on the lock sees the value
      // the previous holder just committed, not the one it read before
      // blocking. Using the pre-lock value here was a real bug (caught by
      // the concurrency test below): every blocked transaction would
      // recompute "next" from the same stale cursor.
      const locked = await tx.$queryRaw<
        { last_assigned_membership_id: string | null }[]
      >`
        SELECT last_assigned_membership_id FROM website_lead_assignment_rules
        WHERE id = ${rule.id}
        FOR UPDATE
      `;
      const lastAssignedMembershipId = locked[0]?.last_assigned_membership_id ?? null;

      const activeGroup = await tx.membership.findMany({
        where: {
          organizationId,
          status: "ACTIVE",
          id: { in: rule.assigneeMembershipIds },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true },
      });
      if (activeGroup.length === 0) continue;

      const lastIndex = activeGroup.findIndex((m) => m.id === lastAssignedMembershipId);
      const next = activeGroup[(lastIndex + 1) % activeGroup.length]!;

      await tx.websiteLeadAssignmentRule.update({
        where: { id: rule.id },
        data: { lastAssignedMembershipId: next.id },
      });

      return next.id;
    }
  }

  return null;
}
