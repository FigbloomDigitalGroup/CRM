import { adminDb } from "../src/db/adminClient";
import type { AuthContext } from "../src/auth/context";
import * as companyService from "../src/services/companyService";
import * as dealService from "../src/services/dealService";
import { createCatalogueEntry } from "../src/services/catalogueService";
import { createTestContext, getPipelineStageId } from "./helpers/fixtures";
import { createV11Organization } from "./helpers/commercial";

/** A V1.1 organisation with Management, two Sales people, a Finance member, a small catalogue and one deal owned by the first Sales person. */
export async function commercialWorld() {
  const org = await createV11Organization();
  const management = await createTestContext(org.id, "MANAGEMENT");
  const sales = await createTestContext(org.id, "SALES");
  const salesTwo = await createTestContext(org.id, "SALES");
  const finance = await createTestContext(org.id, "FINANCE");
  const camera = await createCatalogueEntry(management, { name: "CCTV camera", price: 18500, cost: 11000, unit: "camera" });
  const recorder = await createCatalogueEntry(management, { name: "NVR recorder", price: 65000, cost: 42000 });
  const { company } = await companyService.createCompany(sales, { name: `Mwangaza Schools ${org.id.slice(0, 6)}` });
  const stageId = await getPipelineStageId(org.id, "SOLUTION_PRESENTED");
  const deal = await dealService.createDeal(sales, { companyId: company.id, pipelineStageId: stageId, value: 540000 });
  return { org, management, sales, salesTwo, finance, camera, recorder, company, deal, stageId };
}

export async function dealOwnedBy(ctx: AuthContext, companyId: string, stageKey = "SOLUTION_PRESENTED", value = 100000) {
  const stageId = await getPipelineStageId(ctx.organizationId, stageKey);
  return dealService.createDeal(ctx, { companyId, pipelineStageId: stageId, value });
}

export async function stageIdFor(organizationId: string, key: string) {
  return (await adminDb.pipelineStage.findFirstOrThrow({ where: { organizationId, key } })).id;
}
