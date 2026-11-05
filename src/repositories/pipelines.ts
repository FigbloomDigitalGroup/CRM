import type { Prisma } from "@prisma/client";
import { withOrgContext } from "../db/orgScopedClient";

/** Data access for `pipelines`, `pipeline_services` and `stage_rules` (FIG-1147). Every call runs inside the organisation's RLS context. */

export function listPipelinesWithStages(organizationId: string) {
  return withOrgContext(organizationId, async (tx) => {
    const [pipelines, stages, services, rules] = await Promise.all([
      tx.pipeline.findMany({ where: { organizationId }, orderBy: [{ sequence: "asc" }, { createdAt: "asc" }] }),
      tx.pipelineStage.findMany({ where: { organizationId }, orderBy: [{ sequence: "asc" }, { id: "asc" }] }),
      tx.pipelineService.findMany({ where: { organizationId } }),
      tx.stageRule.findMany({ where: { organizationId } }),
    ]);
    return { pipelines, stages, services, rules };
  });
}

export function getPipeline(organizationId: string, id: string) {
  return withOrgContext(organizationId, (tx) => tx.pipeline.findFirst({ where: { organizationId, id } }));
}

export function getDefaultPipeline(organizationId: string) {
  return withOrgContext(organizationId, (tx) => tx.pipeline.findFirst({ where: { organizationId, isDefault: true } }));
}

export function getStageWithPipeline(organizationId: string, stageId: string) {
  return withOrgContext(organizationId, (tx) => tx.pipelineStage.findFirst({ where: { organizationId, id: stageId } }));
}

export function listRulesForStage(organizationId: string, stageId: string) {
  return withOrgContext(organizationId, (tx) => tx.stageRule.findMany({ where: { organizationId, stageId } }));
}

export function listStageIdsWithRule(organizationId: string, type: string) {
  return withOrgContext(organizationId, async (tx) => (await tx.stageRule.findMany({ where: { organizationId, type, enabled: true }, select: { stageId: true } })).map((r) => r.stageId));
}

export function createPipelineWithStages(input: {
  organizationId: string;
  key: string;
  name: string;
  sequence: number;
  stages: { key: string; name: string; probability: number | null; isWon: boolean; isLost: boolean }[];
  serviceIds: string[];
}) {
  return withOrgContext(input.organizationId, async (tx) => {
    const pipeline = await tx.pipeline.create({ data: { organizationId: input.organizationId, key: input.key, name: input.name, sequence: input.sequence } });
    const base = (await tx.pipelineStage.aggregate({ where: { organizationId: input.organizationId }, _max: { sequence: true } }))._max.sequence ?? 0;
    for (const [i, s] of input.stages.entries()) {
      await tx.pipelineStage.create({ data: { organizationId: input.organizationId, pipelineId: pipeline.id, key: s.key, name: s.name, probability: s.probability, isWon: s.isWon, isLost: s.isLost, sequence: base + i + 1 } });
    }
    if (input.serviceIds.length > 0) {
      await tx.pipelineService.createMany({ data: input.serviceIds.map((serviceId) => ({ organizationId: input.organizationId, pipelineId: pipeline.id, serviceId })) });
    }
    return pipeline;
  });
}

export function updatePipelineRow(organizationId: string, id: string, data: Prisma.PipelineUncheckedUpdateInput) {
  return withOrgContext(organizationId, (tx) => tx.pipeline.update({ where: { id, organizationId }, data }));
}

export function makeDefault(organizationId: string, id: string) {
  return withOrgContext(organizationId, async (tx) => {
    await tx.pipeline.updateMany({ where: { organizationId, isDefault: true }, data: { isDefault: false } });
    return tx.pipeline.update({ where: { id, organizationId }, data: { isDefault: true } });
  });
}

export function replacePipelineServices(organizationId: string, pipelineId: string, serviceIds: string[]) {
  return withOrgContext(organizationId, async (tx) => {
    await tx.pipelineService.deleteMany({ where: { organizationId, pipelineId } });
    if (serviceIds.length > 0) {
      // A service belongs to one pipeline: taking it moves it.
      await tx.pipelineService.deleteMany({ where: { organizationId, serviceId: { in: serviceIds } } });
      await tx.pipelineService.createMany({ data: serviceIds.map((serviceId) => ({ organizationId, pipelineId, serviceId })) });
    }
  });
}

export function addStage(organizationId: string, data: { pipelineId: string; key: string; name: string; probability: number | null; isWon: boolean; isLost: boolean; sequence: number }) {
  return withOrgContext(organizationId, (tx) => tx.pipelineStage.create({ data: { organizationId, ...data } }));
}

export function updateStageRow(organizationId: string, id: string, data: Prisma.PipelineStageUncheckedUpdateInput) {
  return withOrgContext(organizationId, (tx) => tx.pipelineStage.update({ where: { id, organizationId }, data }));
}

export function countOpenDealsInStages(organizationId: string, stageIds: string[]) {
  return withOrgContext(organizationId, (tx) => tx.deal.count({ where: { organizationId, pipelineStageId: { in: stageIds }, outcome: "OPEN", archivedAt: null } }));
}

export function countDealsInStages(organizationId: string, stageIds: string[]) {
  return withOrgContext(organizationId, (tx) => tx.deal.count({ where: { organizationId, pipelineStageId: { in: stageIds }, archivedAt: null } }));
}

export function replaceStageRules(organizationId: string, stageId: string, rules: { type: string; enabled: boolean; config: Prisma.InputJsonValue }[], membershipId: string) {
  return withOrgContext(organizationId, async (tx) => {
    await tx.stageRule.deleteMany({ where: { organizationId, stageId } });
    if (rules.length > 0) {
      await tx.stageRule.createMany({ data: rules.map((r) => ({ organizationId, stageId, type: r.type, enabled: r.enabled, config: r.config, createdByMembershipId: membershipId })) });
    }
    return tx.stageRule.findMany({ where: { organizationId, stageId } });
  });
}
