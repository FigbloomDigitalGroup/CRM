import type { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { ValidationError } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import { logger } from "../lib/logger";
import {
  DEFAULT_HEALTH_WEIGHTS,
  DEFAULT_LEAD_WEIGHTS,
  HEALTH_WEIGHT_GROUPS,
  LEAD_WEIGHT_GROUPS,
  MAX_WEIGHT,
  MIN_WEIGHT,
  sanitiseWeights,
  scoreHealth,
  scoreLead,
  type Weights,
} from "../lib/scoring";
import { recordAuditEvent } from "../repositories/auditEvents";
import {
  companyHealthFacts,
  customerCompanyIdsToScore,
  leadIdsToScore,
  leadScoringFacts,
  storeCompanyHealth,
  storeLeadScore,
} from "../repositories/scoring";
import { loadQuestions, questionApplies } from "./qualificationRules";

/**
 * Lead score and customer health (FIG-1032, B2.03). The rules are in
 * `src/lib/scoring.ts`; this service gathers the facts, stores the result with
 * its factors, shows it to a viewer, and lets Management scale each factor
 * group. A score informs. It never moves, assigns or approves anything.
 */

export const LEAD_WEIGHTS_KEY = "scoring.lead_weights";
export const HEALTH_WEIGHTS_KEY = "scoring.health_weights";

async function loadWeights(organizationId: string, key: string, groups: readonly string[], defaults: Weights): Promise<Weights> {
  const row = await adminDb.organizationSetting.findUnique({ where: { organizationId_key: { organizationId, key } } });
  return sanitiseWeights(row?.value, groups, defaults);
}

export async function getScoringWeights(ctx: AuthContext) {
  requirePermission(ctx, "configuration.manage");
  return {
    lead: await loadWeights(ctx.organizationId, LEAD_WEIGHTS_KEY, LEAD_WEIGHT_GROUPS, DEFAULT_LEAD_WEIGHTS),
    health: await loadWeights(ctx.organizationId, HEALTH_WEIGHTS_KEY, HEALTH_WEIGHT_GROUPS, DEFAULT_HEALTH_WEIGHTS),
    min: MIN_WEIGHT,
    max: MAX_WEIGHT,
  };
}

/** Management scales a factor group (0 turns it off, 1 is the default, up to 3). Scores pick the change up at the next recompute. */
export async function updateScoringWeights(ctx: AuthContext, input: { lead?: Record<string, number>; health?: Record<string, number> }) {
  requirePermission(ctx, "configuration.manage");
  const issues: { path: string; message: string }[] = [];
  const check = (kind: "lead" | "health", values: Record<string, number> | undefined, groups: readonly string[]) => {
    for (const [group, v] of Object.entries(values ?? {})) {
      if (!groups.includes(group)) issues.push({ path: `${kind}.${group}`, message: `Unknown factor group "${group}".` });
      else if (typeof v !== "number" || !Number.isFinite(v) || v < MIN_WEIGHT || v > MAX_WEIGHT) {
        issues.push({ path: `${kind}.${group}`, message: `Use a number from ${MIN_WEIGHT} to ${MAX_WEIGHT}.` });
      }
    }
  };
  check("lead", input.lead, LEAD_WEIGHT_GROUPS);
  check("health", input.health, HEALTH_WEIGHT_GROUPS);
  if (issues.length > 0) throw new ValidationError("These weights are not valid.", issues);

  const before = await getScoringWeights(ctx);
  const save = async (key: string, groups: readonly string[], defaults: Weights, current: Weights, patch: Record<string, number> | undefined) => {
    if (!patch) return;
    const value = sanitiseWeights({ ...current, ...patch }, groups, defaults);
    await adminDb.organizationSetting.upsert({
      where: { organizationId_key: { organizationId: ctx.organizationId, key } },
      update: { value: value as unknown as Prisma.InputJsonValue },
      create: { organizationId: ctx.organizationId, key, value: value as unknown as Prisma.InputJsonValue },
    });
  };
  await save(LEAD_WEIGHTS_KEY, LEAD_WEIGHT_GROUPS, DEFAULT_LEAD_WEIGHTS, before.lead, input.lead);
  await save(HEALTH_WEIGHTS_KEY, HEALTH_WEIGHT_GROUPS, DEFAULT_HEALTH_WEIGHTS, before.health, input.health);
  const after = await getScoringWeights(ctx);
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "scoring.weights_changed",
    entityType: "Organization",
    entityId: ctx.organizationId,
    previousValue: { lead: before.lead, health: before.health },
    newValue: { lead: after.lead, health: after.health },
  });
  return after;
}

// ---------------------------------------------------------------------------
// Computing and storing
// ---------------------------------------------------------------------------

/** Computes and stores one lead's score. Returns null for a lead that does not exist. */
export async function recomputeLeadScore(organizationId: string, leadId: string, now = new Date()) {
  const facts = await leadScoringFacts(organizationId, leadId);
  if (!facts) return null;
  const { lead } = facts;
  const questions = await loadQuestions(organizationId);
  const applicable = questions.filter((q) => questionApplies(q, lead.serviceInterestId));
  const answers = (lead.qualificationData && typeof lead.qualificationData === "object" && !Array.isArray(lead.qualificationData)
    ? lead.qualificationData
    : {}) as Record<string, unknown>;
  const answered = applicable.filter((q) => {
    const a = answers[q.key];
    return !(a === undefined || a === null || a === "" || (Array.isArray(a) && a.length === 0));
  }).length;

  const weights = await loadWeights(organizationId, LEAD_WEIGHTS_KEY, LEAD_WEIGHT_GROUPS, DEFAULT_LEAD_WEIGHTS);
  const result = scoreLead(
    {
      now,
      createdAt: lead.createdAt,
      temperature: lead.temperature,
      sourceKey: lead.leadSource?.key ?? null,
      sourceName: lead.leadSource?.name ?? null,
      firstContactAt: facts.firstContactAt,
      lastContactAt: facts.lastContactAt,
      qualificationQuestions: applicable.length,
      qualificationAnswered: answered,
      similarWins: facts.similarWins,
      nextFollowUpAt: lead.nextFollowUpAt,
    },
    weights,
  );
  await storeLeadScore(organizationId, leadId, { ...result, at: now });
  return result;
}

export async function recomputeCompanyHealth(organizationId: string, companyId: string, now = new Date()) {
  const facts = await companyHealthFacts(organizationId, companyId, now);
  if (!facts) return null;
  const weights = await loadWeights(organizationId, HEALTH_WEIGHTS_KEY, HEALTH_WEIGHT_GROUPS, DEFAULT_HEALTH_WEIGHTS);
  const result = scoreHealth(
    {
      now,
      companyCreatedAt: facts.company.createdAt,
      recentTouches: facts.recentTouches,
      overdueTasks: facts.overdueTasks,
      renewalsDueSoon: facts.renewalsDueSoon,
      lapsedServices: facts.lapsedServices,
      openDeals: facts.openDeals,
      wonDealsLast12Months: facts.wonDealsLast12Months,
      // The payments tracker arrives with B3.03; until then there is no payment fact to weigh.
      overduePayments: null,
    },
    weights,
  );
  await storeCompanyHealth(organizationId, companyId, { ...result, at: now });
  return result;
}

/**
 * For the places a relevant event happens (a lead edited, a contact logged):
 * recompute without ever failing the action that triggered it.
 */
export async function rescoreLeadQuietly(organizationId: string, leadId: string | null | undefined) {
  if (!leadId) return;
  try {
    await recomputeLeadScore(organizationId, leadId);
  } catch (err) {
    logger.warn({ err, organizationId, leadId }, "Could not recompute a lead score");
  }
}

export async function rescoreCompanyQuietly(organizationId: string, companyId: string | null | undefined) {
  if (!companyId) return;
  try {
    await recomputeCompanyHealth(organizationId, companyId);
  } catch (err) {
    logger.warn({ err, organizationId, companyId }, "Could not recompute customer health");
  }
}

/** The nightly pass for one organisation: every open lead and every active company, in batches. */
export async function recomputeAllScores(organizationId: string, now = new Date(), batchSize = 200) {
  let leads = 0;
  let companies = 0;
  let after: string | null = null;
  for (;;) {
    const ids = await leadIdsToScore(organizationId, after, batchSize);
    if (ids.length === 0) break;
    for (const id of ids) {
      await recomputeLeadScore(organizationId, id, now);
      leads += 1;
    }
    after = ids[ids.length - 1]!;
  }
  after = null;
  for (;;) {
    const ids = await customerCompanyIdsToScore(organizationId, after, batchSize);
    if (ids.length === 0) break;
    for (const id of ids) {
      await recomputeCompanyHealth(organizationId, id, now);
      companies += 1;
    }
    after = ids[ids.length - 1]!;
  }
  return { leads, companies };
}

