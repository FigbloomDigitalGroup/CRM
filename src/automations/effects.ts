import type { TaskPriority } from "@prisma/client";
import type { OrgScopedClient } from "../db/orgScopedClient";
import { createTask } from "../repositories/tasks";
import { notifyEvent } from "../services/notificationService";
import type { NotificationTypeKey } from "../notifications/catalogue";
import { type Audience, type RuleKey, assertRuleMay } from "./catalogue";
import { expandAudience } from "./runLog";

/**
 * The only effects an automation rule can have (FIG-1059, B4.02): create a task, notify people.
 * (Assigning an owner and flagging a company happen inside the lead ingestion and lifecycle engines, behind
 * the same `assertRuleMay` gate.) Nothing here touches a deal's stage, outcome, value, discount or an
 * approval, and `tests/automations.test.ts` scans this directory to keep it that way.
 */

export interface RuleTaskInput {
  organizationId: string;
  ruleKey: RuleKey;
  title: string;
  description?: string;
  requirements?: string;
  assigneeMembershipId: string;
  createdByMembershipId: string;
  dueAt: Date;
  priority: TaskPriority;
  leadId?: string;
  dealId?: string;
  companyId?: string;
}

/** Creates a task on behalf of a rule. Pass the open transaction when the task belongs with other writes. */
export async function createRuleTask(input: RuleTaskInput, tx?: OrgScopedClient): Promise<{ id: string }> {
  assertRuleMay(input.ruleKey, "CREATE_TASK");
  const data = {
    organizationId: input.organizationId,
    title: input.title,
    description: input.description,
    requirements: input.requirements,
    assigneeMembershipId: input.assigneeMembershipId,
    createdByMembershipId: input.createdByMembershipId,
    dueAt: input.dueAt,
    priority: input.priority,
    leadId: input.leadId,
    dealId: input.dealId,
    companyId: input.companyId,
  };
  if (tx) return tx.task.create({ data, select: { id: true } });
  return createTask(data);
}

export interface RuleNotificationInput {
  organizationId: string;
  ruleKey: RuleKey;
  /** The record's owner; Management is added when the audience says so. */
  ownerMembershipId: string | null;
  audience: Audience | null;
  type: NotificationTypeKey;
  title: string;
  body: string;
  entityType: string;
  entityId: string;
  path: string;
}

/** Tells the audience about something. Returns how many people were notified. Never throws (notifications are best-effort). */
export async function notifyForRule(input: RuleNotificationInput): Promise<number> {
  assertRuleMay(input.ruleKey, "NOTIFY");
  const recipients = await expandAudience(input.organizationId, input.ownerMembershipId, input.audience);
  for (const membershipId of recipients) {
    await notifyEvent({
      organizationId: input.organizationId,
      membershipId,
      type: input.type,
      title: input.title,
      body: input.body,
      entityType: input.entityType,
      entityId: input.entityId,
      path: input.path,
    });
  }
  return recipients.length;
}
