import { notifyForRule } from "../automations/effects";
import { RULE_KEYS } from "../automations/catalogue";
import { loadOwnRule, runRuleOnce } from "../automations/runLog";
import { adminDb } from "../db/adminClient";
import { inactiveStageCutoffs, loadStageRules } from "./dealRuleService";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Stalled deal alert (FIG-1059, B4.02): an open deal that has had no activity for longer than its stage allows tells its
 * owner (and Management, when the rule's audience says so). "Stalled" is the deal rules' definition, the same one the
 * dashboard counts. The alert only notifies: it never moves the deal, changes its stage or touches anything on it.
 *
 * One alert per stall: the trigger is the deal plus the date of its last activity, so a deal that stalls, wakes up and
 * stalls again alerts again, and a repeat run in between alerts nobody twice. The notice carries no value (deal values
 * are masked by role, and a notification text cannot be masked per reader).
 */
export async function raiseStalledDealAlerts(organizationId: string, now = new Date()): Promise<{ deals: number; notified: number }> {
  const rule = await loadOwnRule(organizationId, RULE_KEYS.STALLED_DEAL_ALERT);
  if (!rule.enabled) return { deals: 0, notified: 0 };

  const rules = await loadStageRules(organizationId);
  const openStages = await adminDb.pipelineStage.findMany({ where: { organizationId, isWon: false, isLost: false }, select: { id: true } });
  const cutoffs = inactiveStageCutoffs(openStages.map((s) => s.id), rules, now);
  if (cutoffs.length === 0) return { deals: 0, notified: 0 };

  const stalled = await adminDb.deal.findMany({
    where: {
      organizationId,
      archivedAt: null,
      outcome: "OPEN",
      OR: cutoffs.map((c) => ({ pipelineStageId: c.stageId, lastActivityAt: { lt: c.before } })),
    },
    select: { id: true, ownerMembershipId: true, lastActivityAt: true, company: { select: { name: true } } },
    orderBy: { lastActivityAt: "asc" },
    take: 2000,
  });
  if (stalled.length === 0) return { deals: 0, notified: 0 };

  const org = await adminDb.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { slug: true } });
  let deals = 0;
  let notified = 0;
  for (const deal of stalled) {
    const quietDays = Math.floor((now.getTime() - deal.lastActivityAt.getTime()) / DAY_MS);
    const outcome = await runRuleOnce(
      {
        organizationId,
        ruleKey: RULE_KEYS.STALLED_DEAL_ALERT,
        triggerKey: `deal:${deal.id}:${deal.lastActivityAt.toISOString().slice(0, 10)}`,
        entityType: "Deal",
        entityId: deal.id,
      },
      async () => {
        const people = await notifyForRule({
          organizationId,
          ruleKey: RULE_KEYS.STALLED_DEAL_ALERT,
          ownerMembershipId: deal.ownerMembershipId,
          audience: rule.audience,
          type: "STALLED_DEAL",
          title: `Deal with ${deal.company.name} has stalled`,
          body: `No activity for ${quietDays} day${quietDays === 1 ? "" : "s"}. A call or an update may get it moving again.`,
          entityType: "Deal",
          entityId: `${deal.id}:${deal.lastActivityAt.toISOString().slice(0, 10)}`,
          path: `/o/${org.slug}/deals/${deal.id}`,
        });
        notified += people;
        return { result: `Told ${people} ${people === 1 ? "person" : "people"} the deal had no activity for ${quietDays} days.`, detail: { quietDays } };
      },
    );
    if (outcome === "APPLIED") deals += 1;
  }
  return { deals, notified };
}
