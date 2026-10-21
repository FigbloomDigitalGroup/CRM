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

  it("accepts a plain 'YYYY-MM-DD' expectedCloseDate string without throwing", async () => {
    // Regression: createDeal used to pass the client's raw date string
    // straight through to Prisma, which throws (rather than coercing) for
    // a DateTime field given a date-only string -- CreateDealForm sends
    // exactly that from an <input type="date">.
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");

    const deal = await createTestDeal(ctx, { expectedCloseDate: "2026-09-19" });
    expect(deal.expectedCloseDate?.toISOString().slice(0, 10)).toBe("2026-09-19");
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

describe("dealService: who can change what (roles & deal states)", () => {
  async function setup() {
    const org = await createTestOrganization();
    const management = await createTestContext(org.id, "MANAGEMENT", "mgmt");
    const sales = await createTestContext(org.id, "SALES", "sales");
    const salesTwo = await createTestContext(org.id, "SALES", "sales2");
    const finance = await createTestContext(org.id, "FINANCE", "fin");
    const delivery = await createTestContext(org.id, "DELIVERY", "deliv");
    const tech = await createTestContext(org.id, "RESTRICTED_TECHNICAL", "tech");
    return { org, management, sales, salesTwo, finance, delivery, tech };
  }

  describe("owner on creation", () => {
    it("Sales cannot create a deal owned by someone else", async () => {
      const { sales, salesTwo } = await setup();
      await expect(
        createTestDeal(sales, { ownerMembershipId: salesTwo.membershipId }),
      ).rejects.toThrow(ForbiddenError);
    });

    it("Sales may still name themselves as the owner", async () => {
      const { sales } = await setup();
      const deal = await createTestDeal(sales, {
        ownerMembershipId: sales.membershipId,
      });
      expect(deal.ownerMembershipId).toBe(sales.membershipId);
    });

    it("Management can create a deal for a Sales user, but not for a role that cannot work deals", async () => {
      const { management, sales, finance, delivery } = await setup();
      const deal = await createTestDeal(management, {
        ownerMembershipId: sales.membershipId,
      });
      expect(deal.ownerMembershipId).toBe(sales.membershipId);

      for (const target of [finance, delivery]) {
        await expect(
          createTestDeal(management, { ownerMembershipId: target.membershipId }),
        ).rejects.toThrow(ValidationError);
      }
    });

    it("a new deal must start in an open stage", async () => {
      const { management, org } = await setup();
      const wonStageId = await getPipelineStageId(org.id, "CLOSED_WON");
      await expect(
        createTestDeal(management, { pipelineStageId: wonStageId }),
      ).rejects.toThrow(ValidationError);
    });

    it("Finance, Delivery and Restricted Technical cannot create deals", async () => {
      const { finance, delivery, tech } = await setup();
      for (const ctx of [finance, delivery, tech]) {
        await expect(createTestDeal(ctx)).rejects.toThrow(ForbiddenError);
      }
    });
  });

  describe("reassigning", () => {
    it("Management can reassign a deal and the change is audited", async () => {
      const { management, sales, salesTwo } = await setup();
      const deal = await createTestDeal(sales);
      const reassigned = await dealService.assignDeal(
        management,
        deal.id,
        salesTwo.membershipId,
      );
      expect(reassigned.ownerMembershipId).toBe(salesTwo.membershipId);
    });

    it("Sales cannot reassign a deal, even their own", async () => {
      const { sales, salesTwo } = await setup();
      const deal = await createTestDeal(sales);
      await expect(
        dealService.assignDeal(sales, deal.id, salesTwo.membershipId),
      ).rejects.toThrow(ForbiddenError);
    });

    it("rejects owners whose role cannot work deals, and archived deals", async () => {
      const { management, sales, finance, delivery, tech } = await setup();
      const deal = await createTestDeal(sales);
      for (const target of [finance, delivery, tech]) {
        await expect(
          dealService.assignDeal(management, deal.id, target.membershipId),
        ).rejects.toThrow(ValidationError);
      }

      await dealService.archiveDeal(management, deal.id);
      await expect(
        dealService.assignDeal(management, deal.id, sales.membershipId),
      ).rejects.toThrow(ValidationError);
    });

    it("lists only people who can work deals as assignable owners", async () => {
      const { management, sales, finance, delivery, tech } = await setup();
      const owners = await dealService.listAssignableDealOwners(management);
      const ids = owners.map((o) => o.membershipId);
      expect(ids).toEqual(
        expect.arrayContaining([management.membershipId, sales.membershipId]),
      );
      for (const excluded of [finance, delivery, tech]) {
        expect(ids).not.toContain(excluded.membershipId);
      }
      await expect(dealService.listAssignableDealOwners(sales)).rejects.toThrow(
        ForbiddenError,
      );
    });
  });

  describe("editing", () => {
    it("Sales can edit their own deal but not someone else's", async () => {
      const { sales, salesTwo } = await setup();
      const deal = await createTestDeal(sales);
      const updated = await dealService.updateDeal(sales, deal.id, {
        notes: "follow up Friday",
      });
      expect(updated.notes).toBe("follow up Friday");
      await expect(
        dealService.updateDeal(salesTwo, deal.id, { notes: "nope" }),
      ).rejects.toThrow(ForbiddenError);
    });

    it("an edit can never change the owner", async () => {
      const { management, sales, salesTwo } = await setup();
      const deal = await createTestDeal(sales);
      await dealService.updateDeal(sales, deal.id, {
        notes: "x",
        ...({ ownerMembershipId: salesTwo.membershipId } as object),
      });
      const after = await dealService.getDeal(management, deal.id);
      expect(after.ownerMembershipId).toBe(sales.membershipId);
    });

    it("Delivery and Finance can view deals but not edit or archive them", async () => {
      const { sales, finance, delivery } = await setup();
      const deal = await createTestDeal(sales);
      for (const ctx of [finance, delivery]) {
        await expect(dealService.getDeal(ctx, deal.id)).resolves.toBeTruthy();
        await expect(
          dealService.updateDeal(ctx, deal.id, { notes: "nope" }),
        ).rejects.toThrow(ForbiddenError);
        await expect(dealService.archiveDeal(ctx, deal.id)).rejects.toThrow(
          ForbiddenError,
        );
      }
    });

    it("Restricted Technical cannot see deals at all", async () => {
      const { sales, tech } = await setup();
      const deal = await createTestDeal(sales);
      await expect(dealService.listDeals(tech)).rejects.toThrow(ForbiddenError);
      await expect(dealService.getDeal(tech, deal.id)).rejects.toThrow(
        ForbiddenError,
      );
    });

    it("an archived deal is read-only until it is restored", async () => {
      const { sales } = await setup();
      const deal = await createTestDeal(sales);
      await dealService.archiveDeal(sales, deal.id);
      await expect(
        dealService.updateDeal(sales, deal.id, { notes: "while archived" }),
      ).rejects.toThrow(ValidationError);

      await dealService.restoreDeal(sales, deal.id);
      const updated = await dealService.updateDeal(sales, deal.id, {
        notes: "after restore",
      });
      expect(updated.notes).toBe("after restore");
    });
  });

  describe("owner names", () => {
    it("every role that can view deals can resolve the owners of what it sees", async () => {
      const { sales, finance, delivery } = await setup();
      const deal = await createTestDeal(sales);
      for (const ctx of [sales, finance, delivery]) {
        const names = await dealService.getDealOwnerNames(ctx, [
          deal.ownerMembershipId,
        ]);
        expect(names[deal.ownerMembershipId]).toBeTruthy();
      }
    });

    it("Restricted Technical cannot look up owner names", async () => {
      const { sales, tech } = await setup();
      const deal = await createTestDeal(sales);
      await expect(
        dealService.getDealOwnerNames(tech, [deal.ownerMembershipId]),
      ).rejects.toThrow(ForbiddenError);
    });
  });
});
