import type { PipelineStage, Prisma, StageRule } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { deny, hasPermission, requirePermission } from "../auth/context";
import { NotFoundError, ValidationError, type ValidationIssue } from "../auth/errors";
import { canUseResource } from "../auth/permissions";
import { adminDb } from "../db/adminClient";
import {
  DEAL_FIELD_LABELS,
  RULE_LABEL,
  STAGE_RULE_TYPES,
  joinLabels,
  missingFields,
  readFields,
  type StageRuleType,
} from "../lib/stageRules";
import { recordAuditEvent } from "../repositories/auditEvents";
import {
  addStage,
  countOpenDealsInStages,
  createPipelineWithStages,
  getPipeline,
  getStageWithPipeline,
  listPipelinesWithStages,
  listRulesForStage,
  listStageIdsWithRule,
  makeDefault,
  replacePipelineServices,
  replaceStageRules,
  updatePipelineRow,
  updateStageRow,
} from "../repositories/pipelines";
import { requireFeature, isFeatureEnabled } from "./featureService";
import { quoteGateBlocker } from "./quoteService";

/**
 * Multiple pipelines and stage rules (FIG-1147, B6.15, release V1.1).
 *
 *  - Every organisation has one default pipeline holding all its existing stages (the migration, and a trigger for new stages),
 *    so organisations that never use this see no change. More pipelines are added by Management (`configuration.manage`).
 *  - A pipeline has open stages, exactly one won stage and exactly one lost stage. Stages are deactivated, never deleted, and
 *    never while open deals sit in them.
 *  - A stage can carry rules that block a move INTO it and say why: a valid quote, required deal fields, an approval. A rule only
 *    blocks and explains; it never moves a deal or approves anything (hard rule 9). "Closed Lost needs a reason" stays always on
 *    (`checkMove`) and cannot be changed here.
 *  - A move into a stage of another pipeline is refused unless the caller says it is changing the pipeline.
 */

const PIPELINE_FEATURE = "release.v11";

export interface StageRuleBlocker {
  code: "QUOTE_REQUIRED" | "QUOTE_NOT_APPROVED" | "QUOTE_EXPIRED" | "REQUIRED_FIELDS_MISSING";
  message: string;
  fields?: string[];
}

function slug(text: string): string {
  return text.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s-]+/g, "_").toUpperCase().slice(0, 40);
}

function requireRead(ctx: AuthContext): void {
  if (!hasPermission(ctx, "configuration.manage") && !canUseResource(ctx, "deals")) throw deny(ctx, "pipelines (deals access, or configuration.manage)", ["configuration.manage"]);
}

type Snapshot = Awaited<ReturnType<typeof listPipelinesWithStages>>;

function presentRule(r: StageRule) {
  return { id: r.id, type: r.type, label: RULE_LABEL[r.type as StageRuleType] ?? r.type, enabled: r.enabled, fields: r.type === "REQUIRED_FIELDS" ? readFields(r.config) : undefined };
}

function presentStage(s: PipelineStage, rules: StageRule[]) {
  return {
    id: s.id,
    key: s.key,
    name: s.name,
    sequence: s.sequence,
    probability: s.probability,
    stalledAfterDays: s.stalledAfterDays,
    isWon: s.isWon,
    isLost: s.isLost,
    isActive: s.isActive,
    rules: rules.filter((r) => r.stageId === s.id).map(presentRule),
  };
}

function presentAll(snap: Snapshot) {
  return snap.pipelines.map((p) => ({
    id: p.id,
    key: p.key,
    name: p.name,
    isDefault: p.isDefault,
    isActive: p.isActive,
    serviceIds: snap.services.filter((s) => s.pipelineId === p.id).map((s) => s.serviceId),
    stages: snap.stages.filter((s) => s.pipelineId === p.id).map((s) => presentStage(s, snap.rules)),
  }));
}

export async function listPipelines(ctx: AuthContext) {
  await requireFeature(ctx.organizationId, PIPELINE_FEATURE);
  requireRead(ctx);
  return { items: presentAll(await listPipelinesWithStages(ctx.organizationId)), ruleTypes: STAGE_RULE_TYPES.map((t) => ({ type: t, label: RULE_LABEL[t] })), fields: DEAL_FIELD_LABELS };
}

async function presentOne(ctx: AuthContext, id: string) {
  const one = presentAll(await listPipelinesWithStages(ctx.organizationId)).find((p) => p.id === id);
  if (!one) throw new NotFoundError("Pipeline", id);
  return one;
}

export async function getPipelineDetail(ctx: AuthContext, id: string) {
  await requireFeature(ctx.organizationId, PIPELINE_FEATURE);
  requireRead(ctx);
  return presentOne(ctx, id);
}

export interface StageInput {
  name: string;
  probability?: number | null;
  kind?: "OPEN" | "WON" | "LOST";
}

function cleanStage(input: StageInput, path: string, issues: ValidationIssue[]) {
  const name = (input.name ?? "").trim().replace(/\s+/g, " ");
  if (!name || name.length > 60) issues.push({ path: `${path}.name`, message: "A stage name of 1 to 60 characters is required." });
  const p = input.probability ?? null;
  if (p !== null && (!Number.isInteger(p) || p < 0 || p > 100)) issues.push({ path: `${path}.probability`, message: "A whole percentage from 0 to 100." });
  return { name, probability: p, kind: input.kind ?? "OPEN" };
}

async function validateServices(organizationId: string, serviceIds: string[], issues: ValidationIssue[]) {
  if (serviceIds.length === 0) return;
  const found = await adminDb.service.findMany({ where: { organizationId, id: { in: serviceIds } }, select: { id: true } });
  const known = new Set(found.map((s) => s.id));
  for (const id of serviceIds) if (!known.has(id)) issues.push({ path: "serviceIds", message: `Unknown service ${id}.`, code: "UNKNOWN_SERVICE" });
}

export async function createPipeline(ctx: AuthContext, input: { name: string; stages: StageInput[]; serviceIds?: string[] }) {
  await requireFeature(ctx.organizationId, PIPELINE_FEATURE);
  requirePermission(ctx, "configuration.manage");
  const issues: ValidationIssue[] = [];
  const name = (input.name ?? "").trim().replace(/\s+/g, " ");
  if (!name || name.length > 80) issues.push({ path: "name", message: "A pipeline name of 1 to 80 characters is required." });
  const stages = (input.stages ?? []).map((s, i) => cleanStage(s, `stages.${i}`, issues));
  const open = stages.filter((s) => s.kind === "OPEN").length;
  const won = stages.filter((s) => s.kind === "WON").length;
  const lost = stages.filter((s) => s.kind === "LOST").length;
  if (open < 1) issues.push({ path: "stages", message: "A pipeline needs at least one open stage.", code: "STAGES_INVALID" });
  if (won !== 1) issues.push({ path: "stages", message: "A pipeline needs exactly one won stage.", code: "STAGES_INVALID" });
  if (lost !== 1) issues.push({ path: "stages", message: "A pipeline needs exactly one lost stage.", code: "STAGES_INVALID" });
  const serviceIds = [...new Set(input.serviceIds ?? [])];
  await validateServices(ctx.organizationId, serviceIds, issues);
  const key = slug(name);
  if (!key) issues.push({ path: "name", message: "Use letters or numbers in the name." });
  if (issues.length > 0) throw new ValidationError("This pipeline is not valid.", issues);

  const existing = await listPipelinesWithStages(ctx.organizationId);
  if (existing.pipelines.some((p) => p.key === key || p.name.toLowerCase() === name.toLowerCase())) {
    throw new ValidationError("A pipeline with this name already exists.", [{ path: "name", message: "Pick a different name.", code: "DUPLICATE_PIPELINE" }]);
  }
  // Stage keys are unique across the organisation, so each carries the pipeline key.
  const ordered = [...stages.filter((s) => s.kind === "OPEN"), ...stages.filter((s) => s.kind === "WON"), ...stages.filter((s) => s.kind === "LOST")];
  const usedKeys = new Set(existing.stages.map((s) => s.key));
  const stageRows = ordered.map((s) => {
    let k = `${key}_${slug(s.name) || "STAGE"}`;
    let n = 2;
    while (usedKeys.has(k)) k = `${key}_${slug(s.name) || "STAGE"}_${n++}`;
    usedKeys.add(k);
    return { key: k, name: s.name, probability: s.kind === "WON" ? 100 : s.kind === "LOST" ? 0 : s.probability, isWon: s.kind === "WON", isLost: s.kind === "LOST" };
  });
  const pipeline = await createPipelineWithStages({ organizationId: ctx.organizationId, key, name, sequence: existing.pipelines.length, stages: stageRows, serviceIds });
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "pipeline.created", entityType: "Pipeline", entityId: pipeline.id, newValue: { name, stages: stageRows.map((s) => s.name) } });
  return presentOne(ctx, pipeline.id);
}

export async function updatePipeline(ctx: AuthContext, id: string, patch: { name?: string; isActive?: boolean; isDefault?: boolean; serviceIds?: string[] }) {
  await requireFeature(ctx.organizationId, PIPELINE_FEATURE);
  requirePermission(ctx, "configuration.manage");
  const pipeline = await getPipeline(ctx.organizationId, id);
  if (!pipeline) throw new NotFoundError("Pipeline", id);
  const snap = await listPipelinesWithStages(ctx.organizationId);
  const issues: ValidationIssue[] = [];
  const data: Prisma.PipelineUncheckedUpdateInput = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim().replace(/\s+/g, " ");
    if (!name || name.length > 80) issues.push({ path: "name", message: "A pipeline name of 1 to 80 characters is required." });
    else if (snap.pipelines.some((p) => p.id !== id && p.name.toLowerCase() === name.toLowerCase())) issues.push({ path: "name", message: "A pipeline with this name already exists.", code: "DUPLICATE_PIPELINE" });
    else data.name = name;
  }
  if (patch.isActive === false) {
    if (pipeline.isDefault) issues.push({ path: "isActive", message: "The default pipeline cannot be switched off. Make another pipeline the default first.", code: "DEFAULT_PIPELINE" });
    else {
      const open = await countOpenDealsInStages(ctx.organizationId, snap.stages.filter((s) => s.pipelineId === id).map((s) => s.id));
      if (open > 0) issues.push({ path: "isActive", message: `${open} open deal${open === 1 ? " is" : "s are"} still in this pipeline. Move them first.`, code: "PIPELINE_HAS_DEALS" });
      else data.isActive = false;
    }
  }
  if (patch.isActive === true) data.isActive = true;
  const serviceIds = patch.serviceIds ? [...new Set(patch.serviceIds)] : undefined;
  if (serviceIds) await validateServices(ctx.organizationId, serviceIds, issues);
  if (patch.isDefault === false) issues.push({ path: "isDefault", message: "Make another pipeline the default instead.", code: "DEFAULT_PIPELINE" });
  if (patch.isDefault === true && !pipeline.isActive && patch.isActive !== true) issues.push({ path: "isDefault", message: "Switch the pipeline on before making it the default.", code: "PIPELINE_INACTIVE" });
  if (issues.length > 0) throw new ValidationError("This pipeline change is not valid.", issues);

  if (Object.keys(data).length > 0) await updatePipelineRow(ctx.organizationId, id, data);
  if (patch.isDefault === true && !pipeline.isDefault) await makeDefault(ctx.organizationId, id);
  if (serviceIds) await replacePipelineServices(ctx.organizationId, id, serviceIds);
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "pipeline.updated", entityType: "Pipeline", entityId: id, previousValue: { name: pipeline.name, isActive: pipeline.isActive, isDefault: pipeline.isDefault }, newValue: { ...(data.name ? { name: data.name as string } : {}), ...(data.isActive !== undefined ? { isActive: data.isActive as boolean } : {}), ...(patch.isDefault ? { isDefault: true } : {}) } });
  return presentOne(ctx, id);
}

async function loadPipelineStage(ctx: AuthContext, pipelineId: string, stageId: string) {
  const stage = await getStageWithPipeline(ctx.organizationId, stageId);
  if (!stage || stage.pipelineId !== pipelineId) throw new NotFoundError("PipelineStage", stageId);
  return stage;
}

/** Puts the pipeline stages in order: open stages (as given), then won, then lost. Sequences stay inside the pipeline's own range. */
async function renumber(organizationId: string, pipelineId: string, openOrder: string[]) {
  const snap = await listPipelinesWithStages(organizationId);
  const stages = snap.stages.filter((s) => s.pipelineId === pipelineId);
  const base = Math.min(...stages.map((s) => s.sequence));
  const byId = new Map(stages.map((s) => [s.id, s]));
  const ordered = [...openOrder.map((id) => byId.get(id)!), ...stages.filter((s) => s.isWon), ...stages.filter((s) => s.isLost)];
  for (const [i, s] of ordered.entries()) if (s.sequence !== base + i) await updateStageRow(organizationId, s.id, { sequence: base + i });
}

export async function addPipelineStage(ctx: AuthContext, pipelineId: string, input: StageInput & { position?: number }) {
  await requireFeature(ctx.organizationId, PIPELINE_FEATURE);
  requirePermission(ctx, "configuration.manage");
  const pipeline = await getPipeline(ctx.organizationId, pipelineId);
  if (!pipeline) throw new NotFoundError("Pipeline", pipelineId);
  const issues: ValidationIssue[] = [];
  const s = cleanStage({ ...input, kind: "OPEN" }, "stage", issues);
  if (input.kind && input.kind !== "OPEN") issues.push({ path: "kind", message: "A pipeline keeps exactly one won and one lost stage; add open stages only.", code: "STAGES_INVALID" });
  const snap = await listPipelinesWithStages(ctx.organizationId);
  const stages = snap.stages.filter((x) => x.pipelineId === pipelineId);
  if (stages.some((x) => x.name.toLowerCase() === s.name.toLowerCase())) issues.push({ path: "name", message: "This pipeline already has a stage with that name.", code: "DUPLICATE_STAGE" });
  if (issues.length > 0) throw new ValidationError("This stage is not valid.", issues);
  const usedKeys = new Set(snap.stages.map((x) => x.key));
  let key = `${pipeline.key}_${slug(s.name) || "STAGE"}`;
  let n = 2;
  while (usedKeys.has(key)) key = `${pipeline.key}_${slug(s.name) || "STAGE"}_${n++}`;
  const created = await addStage(ctx.organizationId, { pipelineId, key, name: s.name, probability: s.probability, isWon: false, isLost: false, sequence: Math.max(...stages.map((x) => x.sequence)) + 1 });
  const openIds = stages.filter((x) => !x.isWon && !x.isLost).map((x) => x.id);
  const at = input.position === undefined ? openIds.length : Math.max(0, Math.min(openIds.length, input.position));
  openIds.splice(at, 0, created.id);
  await renumber(ctx.organizationId, pipelineId, openIds);
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "pipeline_stage.created", entityType: "Pipeline", entityId: pipelineId, newValue: { stage: s.name } });
  return presentOne(ctx, pipelineId);
}

export async function updatePipelineStage(ctx: AuthContext, pipelineId: string, stageId: string, patch: { name?: string; probability?: number | null; stalledAfterDays?: number | null; isActive?: boolean }) {
  await requireFeature(ctx.organizationId, PIPELINE_FEATURE);
  requirePermission(ctx, "configuration.manage");
  const stage = await loadPipelineStage(ctx, pipelineId, stageId);
  const issues: ValidationIssue[] = [];
  const data: Prisma.PipelineStageUncheckedUpdateInput = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim().replace(/\s+/g, " ");
    if (!name || name.length > 60) issues.push({ path: "name", message: "A stage name of 1 to 60 characters is required." });
    else data.name = name;
  }
  if (patch.probability !== undefined) {
    const p = patch.probability;
    if (p !== null && (!Number.isInteger(p) || p < 0 || p > 100)) issues.push({ path: "probability", message: "A whole percentage from 0 to 100." });
    else if (stage.isWon || stage.isLost) issues.push({ path: "probability", message: "A won or lost stage keeps its probability.", code: "STAGE_LOCKED" });
    else data.probability = p;
  }
  if (patch.stalledAfterDays !== undefined) {
    const d = patch.stalledAfterDays;
    if (d !== null && (!Number.isInteger(d) || d < 1 || d > 365)) issues.push({ path: "stalledAfterDays", message: "Whole days from 1 to 365, or null for the default." });
    else data.stalledAfterDays = d;
  }
  if (patch.isActive === false) {
    if (stage.isWon || stage.isLost) issues.push({ path: "isActive", message: "A pipeline needs its won and lost stages.", code: "STAGE_LOCKED" });
    else {
      const open = await countOpenDealsInStages(ctx.organizationId, [stageId]);
      if (open > 0) issues.push({ path: "isActive", message: `${open} open deal${open === 1 ? " is" : "s are"} in this stage. Move them first.`, code: "STAGE_HAS_DEALS" });
      else data.isActive = false;
    }
  }
  if (patch.isActive === true) data.isActive = true;
  if (issues.length > 0) throw new ValidationError("This stage change is not valid.", issues);
  if (Object.keys(data).length > 0) await updateStageRow(ctx.organizationId, stageId, data);
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "pipeline_stage.updated", entityType: "Pipeline", entityId: pipelineId, metadata: { stage: stage.name, fields: Object.keys(data) } });
  return presentOne(ctx, pipelineId);
}

export async function reorderPipelineStages(ctx: AuthContext, pipelineId: string, openStageIds: string[]) {
  await requireFeature(ctx.organizationId, PIPELINE_FEATURE);
  requirePermission(ctx, "configuration.manage");
  if (!(await getPipeline(ctx.organizationId, pipelineId))) throw new NotFoundError("Pipeline", pipelineId);
  const snap = await listPipelinesWithStages(ctx.organizationId);
  const open = snap.stages.filter((s) => s.pipelineId === pipelineId && !s.isWon && !s.isLost).map((s) => s.id);
  if (openStageIds.length !== open.length || new Set(openStageIds).size !== open.length || !openStageIds.every((id) => open.includes(id))) {
    throw new ValidationError("List every open stage of this pipeline once.", [{ path: "stageIds", message: "Won and lost stages stay last and are not listed.", code: "STAGES_INVALID" }]);
  }
  await renumber(ctx.organizationId, pipelineId, openStageIds);
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "pipeline_stage.reordered", entityType: "Pipeline", entityId: pipelineId });
  return presentOne(ctx, pipelineId);
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export interface StageRuleInput {
  type: string;
  enabled?: boolean;
  fields?: string[];
}

export async function setStageRules(ctx: AuthContext, pipelineId: string, stageId: string, rules: StageRuleInput[]) {
  await requireFeature(ctx.organizationId, PIPELINE_FEATURE);
  requirePermission(ctx, "configuration.manage");
  const stage = await loadPipelineStage(ctx, pipelineId, stageId);
  const issues: ValidationIssue[] = [];
  if (stage.isLost) issues.push({ path: "rules", message: "Closed Lost always needs a reason; no other rule applies to it.", code: "STAGE_LOCKED" });
  const types = rules.map((r) => r.type);
  if (new Set(types).size !== types.length) issues.push({ path: "rules", message: "Each rule type can be used once on a stage.", code: "DUPLICATE_RULE" });
  const customKeys = new Set((await adminDb.customFieldDefinition.findMany({ where: { organizationId: ctx.organizationId, entityType: "DEAL", isActive: true }, select: { key: true } })).map((d) => d.key));
  const clean = rules.map((r, i) => {
    if (!(STAGE_RULE_TYPES as readonly string[]).includes(r.type)) {
      issues.push({ path: `rules.${i}.type`, message: `Use ${STAGE_RULE_TYPES.join(", ")}.`, code: "UNKNOWN_RULE" });
      return null;
    }
    let config: Prisma.InputJsonValue = {};
    if (r.type === "REQUIRED_FIELDS") {
      const fields = [...new Set(r.fields ?? [])];
      if (fields.length === 0) issues.push({ path: `rules.${i}.fields`, message: "Choose at least one field.", code: "FIELDS_REQUIRED" });
      for (const f of fields) {
        const known = f in DEAL_FIELD_LABELS || (f.startsWith("custom:") && customKeys.has(f.slice(7)));
        if (!known) issues.push({ path: `rules.${i}.fields`, message: `${f} is not a deal field.`, code: "UNKNOWN_FIELD" });
      }
      config = { fields };
    } else if (r.fields !== undefined) {
      issues.push({ path: `rules.${i}.fields`, message: "This rule takes no fields." });
    }
    return { type: r.type, enabled: r.enabled ?? true, config };
  });
  if (issues.length > 0) throw new ValidationError("These stage rules are not valid.", issues);
  const before = (await listRulesForStage(ctx.organizationId, stageId)).map(presentRule);
  const saved = await replaceStageRules(ctx.organizationId, stageId, clean.filter((c): c is NonNullable<typeof c> => c !== null), ctx.membershipId);
  // The effect, in words, before anyone relies on it: deals already past the stage are not touched.
  const openInPipeline = await countOpenDealsInStages(ctx.organizationId, (await listPipelinesWithStages(ctx.organizationId)).stages.filter((s) => s.pipelineId === pipelineId).map((s) => s.id));
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "stage_rules.updated", entityType: "Pipeline", entityId: pipelineId, previousValue: before as unknown as Prisma.InputJsonValue, newValue: saved.map(presentRule) as unknown as Prisma.InputJsonValue, metadata: { stage: stage.name } });
  return {
    stageId,
    rules: saved.map(presentRule),
    impact: `From now on, a deal moving into ${stage.name} is checked against ${saved.filter((r) => r.enabled).length} rule${saved.filter((r) => r.enabled).length === 1 ? "" : "s"}. ${openInPipeline} open deal${openInPipeline === 1 ? "" : "s"} in this pipeline are not moved or changed; the rules apply when a person moves them.`,
  };
}

/** Whether any stage in the organisation carries QUOTE_REQUIRED (the old Proposal Sent setting of B6.11 is that rule on the Proposal Sent stage). */
export async function quoteRuleStageIds(organizationId: string): Promise<string[]> {
  return listStageIdsWithRule(organizationId, "QUOTE_REQUIRED");
}

/**
 * What the rules on a stage say about moving this deal into it: every reason at once, so the person can fix them together.
 * Approval rules are checked by the approval gate. Only for organisations on release V1.1 or later.
 */
export async function stageRuleBlockers(organizationId: string, dealId: string, stageId: string, now = new Date()): Promise<StageRuleBlocker[]> {
  if (!(await isFeatureEnabled(organizationId, PIPELINE_FEATURE))) return [];
  const rules = (await listRulesForStage(organizationId, stageId)).filter((r) => r.enabled);
  if (rules.length === 0) return [];
  const stage = await getStageWithPipeline(organizationId, stageId);
  const out: StageRuleBlocker[] = [];
  for (const rule of rules) {
    if (rule.type === "QUOTE_REQUIRED") {
      const gate = await quoteGateBlocker(organizationId, dealId, now);
      if (gate) out.push({ code: gate.code, message: gate.message.replace(/^Proposal Sent needs/, `${stage?.name ?? "This stage"} needs`) });
    } else if (rule.type === "REQUIRED_FIELDS") {
      const deal = await adminDb.deal.findFirst({ where: { id: dealId, organizationId }, select: { value: true, expectedCloseDate: true, primaryContactId: true, serviceId: true, notes: true, customFields: true } });
      if (!deal) continue;
      const missing = missingFields(readFields(rule.config), { ...deal, customFields: (deal.customFields ?? {}) as Record<string, unknown> });
      if (missing.length > 0) {
        const defs = await adminDb.customFieldDefinition.findMany({ where: { organizationId, entityType: "DEAL" }, select: { key: true, label: true } });
        const label = (f: string) => DEAL_FIELD_LABELS[f] ?? defs.find((d) => `custom:${d.key}` === f)?.label ?? f;
        out.push({ code: "REQUIRED_FIELDS_MISSING", message: `${stage?.name ?? "This stage"} needs ${joinLabels(missing.map(label))} filled in first.`, fields: missing });
      }
    }
  }
  return out;
}
