import { ValidationError } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import { listRulesForStage } from "../repositories/pipelines";
import { isFeatureEnabled } from "./featureService";

/**
 * A new deal (created directly or converted from a lead) cannot start in a stage that is gated (review finding 1). A gate (a valid
 * quote, required fields, approval) is checked when a deal MOVES, and a deal that does not exist yet cannot satisfy one, so landing in
 * a gated stage on creation would skip the rule. Won and lost stages are never a starting point. Only for organisations on release
 * V1.1 or later; V1 organisations have no gates and behave as before.
 */
export async function assertNewDealStageAllowed(organizationId: string, stage: { id: string; name: string; isWon: boolean; isLost: boolean }): Promise<void> {
  if (!(await isFeatureEnabled(organizationId, "release.v11"))) return;
  const fail = (message: string, code: string) => new ValidationError(message, [{ path: "pipelineStageId", message, code }]);
  if (stage.isWon || stage.isLost) throw fail("A new deal must start in an open pipeline stage.", "STAGE_NOT_OPEN");
  if ((await listRulesForStage(organizationId, stage.id)).some((r) => r.enabled)) {
    throw fail(`${stage.name} has rules a deal has to meet first. Start the deal in an earlier stage and move it here.`, "STAGE_GATED");
  }
}

/** The stage a converted lead's deal will start in (the one asked for, else the first open one), checked like a new deal. */
export async function assertConvertStageAllowed(organizationId: string, pipelineStageId: string | undefined): Promise<void> {
  if (!(await isFeatureEnabled(organizationId, "release.v11"))) return;
  const stage = pipelineStageId
    ? await adminDb.pipelineStage.findFirst({ where: { id: pipelineStageId, organizationId } })
    : await adminDb.pipelineStage.findFirst({ where: { organizationId, isActive: true, isWon: false, isLost: false }, orderBy: { sequence: "asc" } });
  if (!stage) throw new ValidationError("The selected pipeline stage was not found in this organization.");
  await assertNewDealStageAllowed(organizationId, stage);
}
