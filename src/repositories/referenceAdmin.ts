import { withOrgContext } from "../db/orgScopedClient";
import type { CatalogKey } from "./referenceCatalogs";

/**
 * Usage, delete and merge for the controlled-value catalogs (FIG-1063, B4.06). Every table that can hold a
 * reference to a value is listed here once, so "in use" means the same thing for the count, the delete guard
 * and the merge. All calls run inside the organisation's RLS context.
 */

export interface UsageLine {
  /** What holds the reference, in words for the screen: "leads", "website assignment rules". */
  holder: string;
  count: number;
}

export async function catalogUsage(organizationId: string, catalogKey: CatalogKey, id: string): Promise<UsageLine[]> {
  return withOrgContext(organizationId, async (tx) => {
    const org = { organizationId };
    switch (catalogKey) {
      case "leadSources":
        return [
          { holder: "leads", count: await tx.lead.count({ where: { ...org, leadSourceId: id } }) },
          { holder: "website assignment rules", count: await tx.websiteLeadAssignmentRule.count({ where: { ...org, leadSourceId: id } }) },
        ];
      case "leadStatuses":
        return [{ holder: "leads", count: await tx.lead.count({ where: { ...org, leadStatusId: id } }) }];
      case "pipelineStages":
        return [{ holder: "deals", count: await tx.deal.count({ where: { ...org, pipelineStageId: id } }) }];
      case "lostReasons":
        return [
          { holder: "leads", count: await tx.lead.count({ where: { ...org, lostReasonId: id } }) },
          { holder: "deals", count: await tx.deal.count({ where: { ...org, lostReasonId: id } }) },
        ];
      case "services":
        return [
          { holder: "leads", count: await tx.lead.count({ where: { ...org, serviceInterestId: id } }) },
          { holder: "deals", count: await tx.deal.count({ where: { ...org, serviceId: id } }) },
          { holder: "customer services", count: await tx.companyService.count({ where: { ...org, serviceId: id } }) },
          { holder: "recurring services", count: await tx.recurringService.count({ where: { ...org, serviceId: id } }) },
          { holder: "website assignment rules", count: await tx.websiteLeadAssignmentRule.count({ where: { ...org, serviceId: id } }) },
          { holder: "qualification questions", count: await tx.customFieldDefinition.count({ where: { ...org, serviceId: id } }) },
        ];
      case "customerLifecycleStates":
        return [
          { holder: "companies", count: await tx.company.count({ where: { ...org, lifecycleStateId: id } }) },
          { holder: "lifecycle history rows", count: await tx.lifecycleEvent.count({ where: { ...org, OR: [{ toStateId: id }, { fromStateId: id }] } }) },
        ];
    }
  });
}

export async function deleteCatalogEntry(organizationId: string, catalogKey: CatalogKey, id: string): Promise<void> {
  await withOrgContext(organizationId, async (tx) => {
    switch (catalogKey) {
      case "leadSources":
        await tx.leadSource.delete({ where: { id, organizationId } });
        return;
      case "leadStatuses":
        await tx.leadStatus.delete({ where: { id, organizationId } });
        return;
      case "pipelineStages":
        await tx.pipelineStage.delete({ where: { id, organizationId } });
        return;
      case "lostReasons":
        await tx.lostReason.delete({ where: { id, organizationId } });
        return;
      case "services":
        await tx.service.delete({ where: { id, organizationId } });
        return;
      case "customerLifecycleStates":
        await tx.customerLifecycleState.delete({ where: { id, organizationId } });
        return;
    }
  });
}

/**
 * Re-points everything that refers to `fromId` at `intoId`, then removes `fromId`, in one transaction.
 * Returns how many rows moved per holder. Pipeline stages are fixed in V1 and are never merged.
 */
export async function mergeCatalogEntries(
  organizationId: string,
  catalogKey: CatalogKey,
  fromId: string,
  intoId: string,
): Promise<UsageLine[]> {
  return withOrgContext(organizationId, async (tx) => {
    const org = { organizationId };
    const moved: UsageLine[] = [];
    switch (catalogKey) {
      case "leadSources":
        moved.push({ holder: "leads", count: (await tx.lead.updateMany({ where: { ...org, leadSourceId: fromId }, data: { leadSourceId: intoId } })).count });
        moved.push({ holder: "website assignment rules", count: (await tx.websiteLeadAssignmentRule.updateMany({ where: { ...org, leadSourceId: fromId }, data: { leadSourceId: intoId } })).count });
        await tx.leadSource.delete({ where: { id: fromId, organizationId } });
        break;
      case "leadStatuses":
        moved.push({ holder: "leads", count: (await tx.lead.updateMany({ where: { ...org, leadStatusId: fromId }, data: { leadStatusId: intoId } })).count });
        await tx.leadStatus.delete({ where: { id: fromId, organizationId } });
        break;
      case "lostReasons":
        moved.push({ holder: "leads", count: (await tx.lead.updateMany({ where: { ...org, lostReasonId: fromId }, data: { lostReasonId: intoId } })).count });
        moved.push({ holder: "deals", count: (await tx.deal.updateMany({ where: { ...org, lostReasonId: fromId }, data: { lostReasonId: intoId } })).count });
        await tx.lostReason.delete({ where: { id: fromId, organizationId } });
        break;
      case "services":
        moved.push({ holder: "leads", count: (await tx.lead.updateMany({ where: { ...org, serviceInterestId: fromId }, data: { serviceInterestId: intoId } })).count });
        moved.push({ holder: "deals", count: (await tx.deal.updateMany({ where: { ...org, serviceId: fromId }, data: { serviceId: intoId } })).count });
        moved.push({ holder: "customer services", count: (await tx.companyService.updateMany({ where: { ...org, serviceId: fromId }, data: { serviceId: intoId } })).count });
        moved.push({ holder: "recurring services", count: (await tx.recurringService.updateMany({ where: { ...org, serviceId: fromId }, data: { serviceId: intoId } })).count });
        moved.push({ holder: "website assignment rules", count: (await tx.websiteLeadAssignmentRule.updateMany({ where: { ...org, serviceId: fromId }, data: { serviceId: intoId } })).count });
        moved.push({ holder: "qualification questions", count: (await tx.customFieldDefinition.updateMany({ where: { ...org, serviceId: fromId }, data: { serviceId: intoId } })).count });
        await tx.service.delete({ where: { id: fromId, organizationId } });
        break;
      case "customerLifecycleStates":
        moved.push({ holder: "companies", count: (await tx.company.updateMany({ where: { ...org, lifecycleStateId: fromId }, data: { lifecycleStateId: intoId } })).count });
        moved.push({ holder: "lifecycle history rows", count: (await tx.lifecycleEvent.updateMany({ where: { ...org, toStateId: fromId }, data: { toStateId: intoId } })).count + (await tx.lifecycleEvent.updateMany({ where: { ...org, fromStateId: fromId }, data: { fromStateId: intoId } })).count });
        await tx.customerLifecycleState.delete({ where: { id: fromId, organizationId } });
        break;
      case "pipelineStages":
        throw new Error("Pipeline stages are fixed in V1 and cannot be merged.");
    }
    return moved;
  });
}

export async function templateUsage(organizationId: string, id: string): Promise<UsageLine[]> {
  return withOrgContext(organizationId, async (tx) => [
    { holder: "logged emails", count: await tx.communication.count({ where: { organizationId, emailTemplateId: id } }) },
  ]);
}

export async function setTagActive(organizationId: string, id: string, isActive: boolean) {
  return withOrgContext(organizationId, (tx) => tx.tag.update({ where: { id, organizationId }, data: { isActive } }));
}

export async function deleteCustomFieldDefinitionRow(organizationId: string, id: string) {
  return withOrgContext(organizationId, (tx) => tx.customFieldDefinition.delete({ where: { id, organizationId } }));
}

export async function deleteTagRow(organizationId: string, id: string) {
  return withOrgContext(organizationId, (tx) => tx.tag.delete({ where: { id, organizationId } }));
}

export async function deleteTemplateRow(organizationId: string, id: string) {
  return withOrgContext(organizationId, (tx) => tx.emailTemplate.delete({ where: { id, organizationId } }));
}
