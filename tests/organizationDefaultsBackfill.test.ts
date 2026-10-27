import { describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { seedOrganizationDefaults } from "../src/services/organizationDefaults";
import { createTestOrganization } from "./helpers/fixtures";

/** G1.07: bringing an existing organization up to the current catalogue adds what is missing and never changes what it edited. */
describe("organization defaults backfill (fillOnly)", () => {
  async function edited() {
    const org = await createTestOrganization("Backfill");
    const where = { organizationId: org.id };
    await adminDb.pipelineStage.update({ where: { organizationId_key: { organizationId: org.id, key: "NEGOTIATION" } }, data: { name: "Haggling", sequence: 30 } });
    await adminDb.service.update({ where: { organizationId_key: { organizationId: org.id, key: "CCTV" } }, data: { name: "Security cameras" } });
    await adminDb.lostReason.deleteMany({ where: { ...where, key: (await adminDb.lostReason.findFirstOrThrow({ where })).key } });
    return { org, where };
  }

  it("keeps a renamed stage and service as the organization left them, and puts back a row that is missing", async () => {
    const { org, where } = await edited();
    const lostBefore = await adminDb.lostReason.count({ where });

    await seedOrganizationDefaults(org.id, { fillOnly: true });

    const stage = await adminDb.pipelineStage.findUniqueOrThrow({ where: { organizationId_key: { organizationId: org.id, key: "NEGOTIATION" } } });
    expect([stage.name, stage.sequence]).toEqual(["Haggling", 30]);
    const service = await adminDb.service.findUniqueOrThrow({ where: { organizationId_key: { organizationId: org.id, key: "CCTV" } } });
    expect(service.name).toBe("Security cameras");
    expect(await adminDb.lostReason.count({ where })).toBe(lostBefore + 1);
  });

  it("is safe to run twice (the second run adds nothing)", async () => {
    const { org, where } = await edited();
    await seedOrganizationDefaults(org.id, { fillOnly: true });
    const counts = async () => [await adminDb.leadSource.count({ where }), await adminDb.leadStatus.count({ where }), await adminDb.pipelineStage.count({ where }), await adminDb.lostReason.count({ where }), await adminDb.service.count({ where }), await adminDb.customFieldDefinition.count({ where })];
    const first = await counts();
    await seedOrganizationDefaults(org.id, { fillOnly: true });
    expect(await counts()).toEqual(first);
  });

  it("provisioning (the default) still brings a row back to the catalogue", async () => {
    const { org } = await edited();
    await seedOrganizationDefaults(org.id);
    const stage = await adminDb.pipelineStage.findUniqueOrThrow({ where: { organizationId_key: { organizationId: org.id, key: "NEGOTIATION" } } });
    expect([stage.name, stage.sequence]).toEqual(["Negotiation", 3]);
  });
});
