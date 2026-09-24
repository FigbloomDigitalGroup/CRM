import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { createCompany } from "../src/services/companyService";
import * as dealService from "../src/services/dealService";
import {
  createTestContext,
  createTestOrganization,
  getLostReasonId,
  getPipelineStageId,
} from "./helpers/fixtures";

async function createTestDeal(
  ctx: Awaited<ReturnType<typeof createTestContext>>,
  overrides: Partial<Parameters<typeof dealService.createDeal>[1]> = {},
) {
  const { company } = await createCompany(ctx, { name: "Acme Co" });
  const pipelineStageId = await getPipelineStageId(ctx.organizationId);
  return dealService.createDeal(ctx, {
    companyId: company.id,
    pipelineStageId,
    ...overrides,
  });
}

describe("dealService", () => {
  it("defaults a newly created deal's owner to its creator", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");

    const deal = await createTestDeal(ctx);
    expect(deal.ownerMembershipId).toBe(ctx.membershipId);
  });

  it("does not mask value for the deal's own owner even without deals.view.value", async () => {
    const org = await createTestOrganization();
    const salesCtx = await createTestContext(org.id, "SALES");

    const deal = await createTestDeal(salesCtx, { value: "5000" });
    expect(deal.valueMasked).toBe(false);
    expect(Number(deal.value)).toBe(5000);
  });

  it("masks value for a viewer with deals.view.all but not deals.view.value (Delivery)", async () => {
    const org = await createTestOrganization();
    const salesCtx = await createTestContext(org.id, "SALES", "owner");
    const deliveryCtx = await createTestContext(org.id, "DELIVERY", "viewer");

    const deal = await createTestDeal(salesCtx, { value: "5000" });
    const seen = await dealService.getDeal(deliveryCtx, deal.id);

    expect(seen.valueMasked).toBe(true);
    expect(seen.value).toBeNull();
  });

  it("does not mask value for a viewer with deals.view.value (Finance)", async () => {
    const org = await createTestOrganization();
    const salesCtx = await createTestContext(org.id, "SALES", "owner");
    const financeCtx = await createTestContext(org.id, "FINANCE", "viewer");

    const deal = await createTestDeal(salesCtx, { value: "5000" });
    const seen = await dealService.getDeal(financeCtx, deal.id);

    expect(seen.valueMasked).toBe(false);
    expect(Number(seen.value)).toBe(5000);
  });

  it("Sales (deals.view.own only) cannot see a deal owned by a different Sales user", async () => {
    const org = await createTestOrganization();
    const ownerCtx = await createTestContext(org.id, "SALES", "owner");
    const otherCtx = await createTestContext(org.id, "SALES", "other");

    const deal = await createTestDeal(ownerCtx);
    await expect(dealService.getDeal(otherCtx, deal.id)).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("Sales does not see other people's deals in listDeals, even via a forged filter", async () => {
    const org = await createTestOrganization();
    const ownerCtx = await createTestContext(org.id, "SALES", "owner");
    const otherCtx = await createTestContext(org.id, "SALES", "other");
    await createTestDeal(ownerCtx);

    const results = await dealService.listDeals(otherCtx, {
      ownerMembershipId: ownerCtx.membershipId,
    });
    expect(results).toHaveLength(0);
  });

  it("throws NotFoundError for a deal id that does not exist at all", async () => {
    const org = await createTestOrganization();
    const managementCtx = await createTestContext(org.id, "MANAGEMENT");

    await expect(
      dealService.getDeal(managementCtx, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow(NotFoundError);
  });

  it("Sales cannot edit a deal they do not own", async () => {
    const org = await createTestOrganization();
    const ownerCtx = await createTestContext(org.id, "SALES", "owner");
    const otherCtx = await createTestContext(org.id, "SALES", "other");
    const deal = await createTestDeal(ownerCtx);

    await expect(
      dealService.updateDeal(otherCtx, deal.id, { notes: "sneaky edit" }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("moving a deal onto a won-flagged stage records the WON outcome", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const deal = await createTestDeal(ctx);
    const wonStageId = await getPipelineStageId(org.id, "CLOSED_WON");

    const updated = await dealService.updateDeal(ctx, deal.id, {
      pipelineStageId: wonStageId,
    });

    expect(updated.outcome).toBe("WON");
    expect(updated.wonAt).not.toBeNull();
    expect(updated.lostAt).toBeNull();
    expect(updated.lostReasonId).toBeNull();
  });

  it("moving a deal onto a lost-flagged stage without a lost reason is rejected", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const deal = await createTestDeal(ctx);
    const lostStageId = await getPipelineStageId(org.id, "CLOSED_LOST");

    await expect(
      dealService.updateDeal(ctx, deal.id, { pipelineStageId: lostStageId }),
    ).rejects.toThrow(ValidationError);
  });

  it("moving a deal onto a lost-flagged stage with a lost reason records the LOST outcome", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const deal = await createTestDeal(ctx);
    const lostStageId = await getPipelineStageId(org.id, "CLOSED_LOST");
    const lostReasonId = await getLostReasonId(org.id);

    const updated = await dealService.updateDeal(ctx, deal.id, {
      pipelineStageId: lostStageId,
      lostReasonId,
    });

    expect(updated.outcome).toBe("LOST");
    expect(updated.lostAt).not.toBeNull();
    expect(updated.lostReasonId).toBe(lostReasonId);
  });

  it("moving a deal from a closed stage back to an open stage reopens it", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const deal = await createTestDeal(ctx);
    const wonStageId = await getPipelineStageId(org.id, "CLOSED_WON");
    const openStageId = await getPipelineStageId(org.id, "NEGOTIATION");

    await dealService.updateDeal(ctx, deal.id, { pipelineStageId: wonStageId });
    const reopened = await dealService.updateDeal(ctx, deal.id, {
      pipelineStageId: openStageId,
    });

    expect(reopened.outcome).toBe("OPEN");
    expect(reopened.wonAt).toBeNull();
    expect(reopened.lostAt).toBeNull();
    expect(reopened.lostReasonId).toBeNull();
  });

  it("rejects a pipeline stage id that does not belong to the caller's organization", async () => {
    const orgA = await createTestOrganization();
    const orgB = await createTestOrganization();
    const ctx = await createTestContext(orgA.id, "MANAGEMENT");
    const deal = await createTestDeal(ctx);
    const foreignStageId = await getPipelineStageId(orgB.id);

    await expect(
      dealService.updateDeal(ctx, deal.id, { pipelineStageId: foreignStageId }),
    ).rejects.toThrow(ValidationError);
  });
});
