import type { Prisma } from "@prisma/client";
import { adminDb } from "../db/adminClient";
import { APPROVAL_RULES_KEY, parseApprovalRules, type ApprovalRuleSettings } from "../lib/approvalRules";

/**
 * Where an organisation keeps its approval rules (FIG-1145, B6.13): one JSON value in `organization_settings`. Reading is
 * for the services that must know whether an action waits for an approver; the settings API is in `approvalService.ts`.
 */
export async function loadApprovalRules(organizationId: string): Promise<ApprovalRuleSettings> {
  const row = await adminDb.organizationSetting.findUnique({ where: { organizationId_key: { organizationId, key: APPROVAL_RULES_KEY } } });
  return parseApprovalRules(row?.value);
}

export async function saveApprovalRules(organizationId: string, rules: ApprovalRuleSettings): Promise<void> {
  await adminDb.organizationSetting.upsert({
    where: { organizationId_key: { organizationId, key: APPROVAL_RULES_KEY } },
    update: { value: rules as unknown as Prisma.InputJsonValue },
    create: { organizationId, key: APPROVAL_RULES_KEY, value: rules as unknown as Prisma.InputJsonValue },
  });
}
