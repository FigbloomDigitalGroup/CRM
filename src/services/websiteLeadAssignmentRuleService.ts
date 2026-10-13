import { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { NotFoundError, ValidationError } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import { recordAuditEvent } from "../repositories/auditEvents";
import {
  type AssignmentRule,
  createRule,
  getRuleById,
  listRules,
  moveRule,
  updateRule,
} from "../repositories/websiteLeadAssignmentRules";

/**
 * Reuses `configuration.manage` (Management-only), the same permission the
 * reference-data catalogs are gated behind (see
 * `referenceCatalogService.ts`) -- this is the same kind of org-wide
 * lead-handling configuration.
 */
const PERMISSION = "configuration.manage";
const ENTITY_TYPE = "WebsiteLeadAssignmentRule";

export interface AssignmentRuleInput {
  name: string;
  leadSourceId?: string | null;
  serviceId?: string | null;
  assigneeMembershipId?: string | null;
  assigneeMembershipIds?: string[];
}

/**
 * Shared create/update validation: a rule must match on at least one of
 * lead source/service (otherwise it would apply to every lead, silently
 * starving every rule after it), and must assign to exactly one of a
 * specific rep or a round-robin group -- never both, never neither. Every
 * referenced id is checked against this organization so a rule can never
 * point at another tenant's lead source/service/membership.
 */
async function validateRuleInput(organizationId: string, input: AssignmentRuleInput) {
  const name = input.name.trim();
  if (!name) {
    throw new ValidationError("Rule name is required.");
  }

  const leadSourceId = input.leadSourceId || null;
  const serviceId = input.serviceId || null;
  if (!leadSourceId && !serviceId) {
    throw new ValidationError("A rule must match on lead source, service, or both.");
  }

  const specific = input.assigneeMembershipId || null;
  const group = (input.assigneeMembershipIds ?? []).filter((id) => id.trim().length > 0);
  if (specific && group.length > 0) {
    throw new ValidationError(
      "A rule can assign to a specific rep or a round-robin group, not both.",
    );
  }
  if (!specific && group.length === 0) {
    throw new ValidationError("A rule needs either a specific assignee or a round-robin group.");
  }

  if (leadSourceId) {
    const exists = await adminDb.leadSource.findFirst({
      where: { organizationId, id: leadSourceId },
      select: { id: true },
    });
    if (!exists) throw new ValidationError("Selected lead source was not found.");
  }
  if (serviceId) {
    const exists = await adminDb.service.findFirst({
      where: { organizationId, id: serviceId },
      select: { id: true },
    });
    if (!exists) throw new ValidationError("Selected service was not found.");
  }

  const membershipIds = specific ? [specific] : group;
  const memberships = await adminDb.membership.findMany({
    where: { organizationId, id: { in: membershipIds } },
    select: { id: true },
  });
  if (memberships.length !== new Set(membershipIds).size) {
    throw new ValidationError("One or more selected members were not found.");
  }

  return {
    name,
    leadSourceId,
    serviceId,
    assigneeMembershipId: specific,
    assigneeMembershipIds: group,
  };
}

export async function listAssignmentRules(ctx: AuthContext): Promise<AssignmentRule[]> {
  requirePermission(ctx, PERMISSION);
  return listRules(ctx.organizationId);
}

export async function createAssignmentRule(
  ctx: AuthContext,
  input: AssignmentRuleInput,
): Promise<AssignmentRule> {
  requirePermission(ctx, PERMISSION);
  const validated = await validateRuleInput(ctx.organizationId, input);
  const rule = await createRule(ctx.organizationId, validated);

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "website_lead_assignment_rule.created",
    entityType: ENTITY_TYPE,
    entityId: rule.id,
    newValue: { name: rule.name } as Prisma.InputJsonValue,
  });

  return rule;
}

async function requireRule(ctx: AuthContext, id: string): Promise<AssignmentRule> {
  const existing = await getRuleById(ctx.organizationId, id);
  if (!existing) throw new NotFoundError(ENTITY_TYPE, id);
  return existing;
}

export async function updateAssignmentRule(
  ctx: AuthContext,
  id: string,
  input: AssignmentRuleInput,
): Promise<AssignmentRule> {
  requirePermission(ctx, PERMISSION);
  await requireRule(ctx, id);
  const validated = await validateRuleInput(ctx.organizationId, input);
  const updated = await updateRule(ctx.organizationId, id, validated);

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "website_lead_assignment_rule.updated",
    entityType: ENTITY_TYPE,
    entityId: id,
    newValue: { name: updated.name } as Prisma.InputJsonValue,
  });

  return updated;
}

/**
 * Disabling never deletes a rule, same soft-disable precedent as the
 * reference catalogs' `isActive` -- a disabled rule is just skipped by
 * `pickOwnerForRule`, so re-enabling it later needs no reconstruction.
 */
export async function setAssignmentRuleActive(
  ctx: AuthContext,
  id: string,
  isActive: boolean,
): Promise<AssignmentRule> {
  requirePermission(ctx, PERMISSION);
  await requireRule(ctx, id);
  const updated = await updateRule(ctx.organizationId, id, { isActive });

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: isActive
      ? "website_lead_assignment_rule.reactivated"
      : "website_lead_assignment_rule.deactivated",
    entityType: ENTITY_TYPE,
    entityId: id,
  });

  return updated;
}

export async function reorderAssignmentRule(
  ctx: AuthContext,
  id: string,
  direction: "up" | "down",
): Promise<void> {
  requirePermission(ctx, PERMISSION);
  await requireRule(ctx, id);
  await moveRule(ctx.organizationId, id, direction);

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "website_lead_assignment_rule.reordered",
    entityType: ENTITY_TYPE,
    entityId: id,
    metadata: { direction },
  });
}
