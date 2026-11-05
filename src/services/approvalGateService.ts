import { adminDb } from "../db/adminClient";
import { largeDealNeedsApproval } from "../lib/approvalRules";
import { consumeGrant, findUsableMoveGrant, type GrantSnapshot } from "../repositories/approvalRequests";
import { listRulesForStage } from "../repositories/pipelines";
import { loadApprovalRules } from "./approvalRuleService";
import { isFeatureEnabled } from "./featureService";

/**
 * The part of the approvals engine the deal move rules need (FIG-1145, B6.13; FIG-1147, B6.15): does this move have to wait for
 * an approver, and is there an approved, unspent grant for it. Kept apart from `approvalService.ts` (which moves deals when a
 * request is approved) so the two do not import each other. A rule only decides that a move WAITS; a person approves it (hard rule 9).
 *
 * A move waits when (a) the organisation's large-deal rule is on and the deal is worth more than its limit and the move is to a won
 * stage, or (b) the target stage carries an APPROVAL_REQUIRED rule.
 */

/** How long an approved move stays usable. */
export const GRANT_DAYS = 7;

export function moveSubjectId(dealId: string, toStageId: string): string {
  return `${dealId}:${toStageId}`;
}

export interface GateBlocker {
  code: "APPROVAL_REQUIRED";
  message: string;
}

export type MoveApprovalReason = { why: "THRESHOLD"; currency: string; amount: number } | { why: "STAGE_RULE"; stageName: string };

/** Why a move needs approval, or null when it does not. Only for organisations on release V1.1 or later. */
export async function moveApprovalReason(
  organizationId: string,
  deal: { id: string; outcome: string; value: unknown; currency: string },
  to: { id: string; name: string; isWon: boolean },
): Promise<MoveApprovalReason | null> {
  if (!(await isFeatureEnabled(organizationId, "release.v11"))) return null;
  const rules = await loadApprovalRules(organizationId);
  const value = deal.value === null || deal.value === undefined ? null : Number(deal.value);
  if (to.isWon && deal.outcome !== "WON" && largeDealNeedsApproval(value, deal.currency, rules)) {
    return { why: "THRESHOLD", currency: rules.largeDeal.currency, amount: rules.largeDeal.thresholdAmount };
  }
  if ((await listRulesForStage(organizationId, to.id)).some((r) => r.type === "APPROVAL_REQUIRED" && r.enabled) && deal.outcome !== "WON") {
    return { why: "STAGE_RULE", stageName: to.name };
  }
  return null;
}

/** The reason a move is blocked until it is approved, or null when it may go ahead. */
export async function approvalGateBlocker(
  organizationId: string,
  dealId: string,
  to: { id: string; name: string; isWon: boolean },
  now = new Date(),
  actor?: GrantActor,
): Promise<GateBlocker | null> {
  const deal = await adminDb.deal.findFirst({ where: { id: dealId, organizationId }, select: { id: true, value: true, currency: true, outcome: true } });
  if (!deal) return null;
  const reason = await moveApprovalReason(organizationId, deal, to);
  if (!reason) return null;
  if (await findUsableMoveGrant(organizationId, dealId, to.id, now, snapshotOf(deal), actor)) return null;
  return {
    code: "APPROVAL_REQUIRED",
    message:
      reason.why === "THRESHOLD"
        ? `A deal worth more than ${reason.currency} ${reason.amount.toLocaleString("en-KE")} needs approval before it is marked won. Ask for approval from the deal.`
        : `${reason.stageName} needs approval before a deal can move there. Ask for approval from the deal.`,
  };
}

/** Spends the approval a move used. Called after the move succeeded; a move that needed none does nothing. */
export async function consumeMoveGrant(organizationId: string, dealId: string, toStageId: string, now = new Date(), actor?: GrantActor): Promise<void> {
  // The deal has just moved, but its value and currency are the ones the grant was checked against.
  const deal = await adminDb.deal.findFirst({ where: { id: dealId, organizationId }, select: { value: true, currency: true } });
  const grant = await findUsableMoveGrant(organizationId, dealId, toStageId, now, deal ? snapshotOf(deal) : undefined, actor);
  if (grant) await consumeGrant(organizationId, grant.id, now);
}

/** Who is using a grant: its requester, or anyone who may edit every deal (Management), may spend it. */
export interface GrantActor {
  membershipId: string;
  canEditAll: boolean;
}

function snapshotOf(deal: { value: unknown; currency: string }): GrantSnapshot {
  return { value: deal.value === null || deal.value === undefined ? null : Number(deal.value), currency: deal.currency };
}
