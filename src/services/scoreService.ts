import type { AuthContext } from "../auth/context";
import { hasPermission } from "../auth/context";
import { NotFoundError } from "../auth/errors";
import { healthBandFor, leadBandFor, scoreForViewer, type ScoreFactor } from "../lib/scoring";
import { getCompany } from "./companyService";
import { getLead } from "./leadService";
import { recomputeCompanyHealth, recomputeLeadScore } from "./scoreEngine";

/**
 * Reading lead scores and customer health as a given caller may see them
 * (FIG-1032, B2.03). Computing and the weights live in `scoreEngine.ts`.
 */

export {
  getScoringWeights,
  recomputeAllScores,
  recomputeCompanyHealth,
  recomputeLeadScore,
  rescoreCompanyQuietly,
  rescoreLeadQuietly,
  updateScoringWeights,
} from "./scoreEngine";

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface ScoreView {
  score: number;
  band: string;
  factors: { key: string; label: string; points: number }[];
  computedAt: Date | null;
}

function viewOf(
  stored: { value: number | null; factors: unknown; at: Date | null },
  ctx: AuthContext,
  bandFor: (s: number) => string,
): ScoreView | null {
  if (stored.value === null || !Array.isArray(stored.factors)) return null;
  const shown = scoreForViewer({ factors: stored.factors as ScoreFactor[] }, (p) => hasPermission(ctx, p), bandFor);
  return {
    score: shown.score,
    band: shown.band,
    factors: shown.factors.map(({ key, label, points }) => ({ key, label, points })),
    computedAt: stored.at,
  };
}

/** The lead score as this caller may see it. Computed on the spot if it has never been computed. */
export async function getLeadScore(ctx: AuthContext, leadId: string): Promise<ScoreView> {
  const lead = await getLead(ctx, leadId);
  let stored: { value: number | null; factors: unknown; at: Date | null } = { value: lead.scoreValue, factors: lead.scoreFactors, at: lead.scoredAt };
  if (stored.value === null) {
    const fresh = await recomputeLeadScore(ctx.organizationId, leadId);
    if (!fresh) throw new NotFoundError("Lead", leadId);
    stored = { value: fresh.score, factors: fresh.factors, at: new Date() };
  }
  return viewOf(stored, ctx, leadBandFor)!;
}

export async function getCustomerHealth(ctx: AuthContext, companyId: string): Promise<ScoreView> {
  const company = await getCompany(ctx, companyId);
  let stored: { value: number | null; factors: unknown; at: Date | null } = { value: company.healthValue, factors: company.healthFactors, at: company.healthScoredAt };
  if (stored.value === null) {
    const fresh = await recomputeCompanyHealth(ctx.organizationId, companyId);
    if (!fresh) throw new NotFoundError("Company", companyId);
    stored = { value: fresh.score, factors: fresh.factors, at: new Date() };
  }
  return viewOf(stored, ctx, healthBandFor)!;
}

/** For list rows and DTOs: a stored score shown the way this caller may see it. */
export function leadScoreForRow(ctx: AuthContext, row: { scoreValue: number | null; scoreFactors: unknown; scoredAt: Date | null }) {
  return viewOf({ value: row.scoreValue, factors: row.scoreFactors, at: row.scoredAt }, ctx, leadBandFor);
}
