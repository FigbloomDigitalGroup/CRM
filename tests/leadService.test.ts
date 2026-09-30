import { describe, expect, it } from "vitest";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../src/auth/errors";
import { createCompany } from "../src/services/companyService";
import * as leadService from "../src/services/leadService";
import {
  createTestContext,
  createTestOrganization,
  getLeadStatusId,
} from "./helpers/fixtures";

describe("leadService", () => {
  it("defaults a newly created lead's owner to its creator", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");
    const leadStatusId = await getLeadStatusId(org.id);

    const { lead } = await leadService.createLead(ctx, { leadStatusId });
    expect(lead.ownerMembershipId).toBe(ctx.membershipId);
  });

  it("surfaces possible duplicate leads for the same company without blocking creation", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");
    const leadStatusId = await getLeadStatusId(org.id);
    const { company } = await createCompany(ctx, {
      name: "Repeat Prospect Co",
    });

    await leadService.createLead(ctx, { leadStatusId, companyId: company.id });
    const { possibleDuplicates } = await leadService.createLead(ctx, {
      leadStatusId,
      companyId: company.id,
    });

    expect(possibleDuplicates.length).toBeGreaterThan(0);
  });

  it("Sales (leads.view.own only) cannot see a lead owned by a different Sales user", async () => {
    const org = await createTestOrganization();
    const ownerCtx = await createTestContext(org.id, "SALES", "owner");
    const otherCtx = await createTestContext(org.id, "SALES", "other");
    const leadStatusId = await getLeadStatusId(org.id);

    const { lead } = await leadService.createLead(ownerCtx, { leadStatusId });

    // Exists in the same organization but not owned by the caller ->
    // ForbiddenError, not NotFoundError (see leadService.ts's comment on
    // the NotFoundError/ForbiddenError convention). A genuinely
    // nonexistent/cross-tenant id is covered in tests/tenant-isolation.test.ts.
    await expect(leadService.getLead(otherCtx, lead.id)).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("Sales (leads.view.own only) does not see other people's leads in listLeads, even via a forged filter", async () => {
    const org = await createTestOrganization();
    const ownerCtx = await createTestContext(org.id, "SALES", "owner");
    const otherCtx = await createTestContext(org.id, "SALES", "other");
    const leadStatusId = await getLeadStatusId(org.id);
    await leadService.createLead(ownerCtx, { leadStatusId });

    // otherCtx explicitly asks to filter by ownerCtx's membershipId -- the
    // service must ignore/override this and force the caller's own scope.
    const results = await leadService.listLeads(otherCtx, {
      ownerMembershipId: ownerCtx.membershipId,
    });
    expect(results).toHaveLength(0);
  });

  it("Management (leads.view.all) sees every lead in the organization", async () => {
    const org = await createTestOrganization();
    const salesCtx = await createTestContext(org.id, "SALES");
    const managementCtx = await createTestContext(org.id, "MANAGEMENT");
    const leadStatusId = await getLeadStatusId(org.id);
    await leadService.createLead(salesCtx, { leadStatusId });
    await leadService.createLead(managementCtx, { leadStatusId });

    const results = await leadService.listLeads(managementCtx);
    expect(results).toHaveLength(2);
  });

  it("Sales cannot edit a lead they do not own (leads.edit.own respects ownership)", async () => {
    const org = await createTestOrganization();
    const ownerCtx = await createTestContext(org.id, "SALES", "owner");
    const otherCtx = await createTestContext(org.id, "SALES", "other");
    const leadStatusId = await getLeadStatusId(org.id);
    const { lead } = await leadService.createLead(ownerCtx, { leadStatusId });

    await expect(
      leadService.updateLead(otherCtx, lead.id, { notes: "sneaky edit" }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("throws NotFoundError (not ForbiddenError) for a lead id that does not exist at all", async () => {
    const org = await createTestOrganization();
    const managementCtx = await createTestContext(org.id, "MANAGEMENT");

    await expect(
      leadService.getLead(
        managementCtx,
        "00000000-0000-0000-0000-000000000000",
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it("Sales can edit a lead they own", async () => {
    const org = await createTestOrganization();
    const ownerCtx = await createTestContext(org.id, "SALES");
    const leadStatusId = await getLeadStatusId(org.id);
    const { lead } = await leadService.createLead(ownerCtx, { leadStatusId });

    const updated = await leadService.updateLead(ownerCtx, lead.id, {
      notes: "updated by owner",
    });
    expect(updated.notes).toBe("updated by owner");
  });

  it("Sales cannot reassign lead ownership (leads.assign is Management-only)", async () => {
    const org = await createTestOrganization();
    const ownerCtx = await createTestContext(org.id, "SALES", "owner");
    const otherCtx = await createTestContext(org.id, "SALES", "other");
    const leadStatusId = await getLeadStatusId(org.id);
    const { lead } = await leadService.createLead(ownerCtx, { leadStatusId });

    await expect(
      leadService.assignLead(ownerCtx, lead.id, otherCtx.membershipId),
    ).rejects.toThrow(ForbiddenError);
  });

  it("Management can reassign a lead to another active member", async () => {
    const org = await createTestOrganization();
    const managementCtx = await createTestContext(org.id, "MANAGEMENT");
    const salesCtx = await createTestContext(org.id, "SALES");
    const leadStatusId = await getLeadStatusId(org.id);
    const { lead } = await leadService.createLead(managementCtx, {
      leadStatusId,
    });

    const reassigned = await leadService.assignLead(
      managementCtx,
      lead.id,
      salesCtx.membershipId,
    );
    expect(reassigned.ownerMembershipId).toBe(salesCtx.membershipId);
  });

  it("rejects reassigning a lead to a membership from a different organization", async () => {
    const orgA = await createTestOrganization();
    const orgB = await createTestOrganization();
    const managementCtx = await createTestContext(orgA.id, "MANAGEMENT");
    const foreignCtx = await createTestContext(orgB.id, "SALES");
    const leadStatusId = await getLeadStatusId(orgA.id);
    const { lead } = await leadService.createLead(managementCtx, {
      leadStatusId,
    });

    await expect(
      leadService.assignLead(managementCtx, lead.id, foreignCtx.membershipId),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects assigning a lead with a missing ownerMembershipId instead of silently leaving ownership unchanged", async () => {
    // Regression test: Prisma treats `id: undefined` in a `where` filter as
    // "no filter" and `undefined` in a `data` update as "leave unchanged" --
    // an earlier version of assignLead let a missing id slip through both,
    // so a malformed request silently no-op'd instead of failing.
    const org = await createTestOrganization();
    const managementCtx = await createTestContext(org.id, "MANAGEMENT");
    const leadStatusId = await getLeadStatusId(org.id);
    const { lead } = await leadService.createLead(managementCtx, {
      leadStatusId,
    });
    const originalOwner = lead.ownerMembershipId;

    await expect(
      leadService.assignLead(
        managementCtx,
        lead.id,
        undefined as unknown as string,
      ),
    ).rejects.toThrow(ValidationError);
    await expect(
      leadService.assignLead(managementCtx, lead.id, ""),
    ).rejects.toThrow(ValidationError);

    const stillOriginal = await leadService.getLead(managementCtx, lead.id);
    expect(stillOriginal.ownerMembershipId).toBe(originalOwner);
  });

  describe("convertLead", () => {
    it("converts an owned, company-attached lead into a deal and stamps convertedAt", async () => {
      const org = await createTestOrganization();
      const ctx = await createTestContext(org.id, "SALES");
      const leadStatusId = await getLeadStatusId(org.id);
      const { company } = await createCompany(ctx, { name: "Convert Co" });
      const { lead } = await leadService.createLead(ctx, {
        leadStatusId,
        companyId: company.id,
      });

      const deal = await leadService.convertLead(ctx, lead.id);
      expect(deal.leadId).toBe(lead.id);
      expect(deal.companyId).toBe(company.id);
      expect(deal.ownerMembershipId).toBe(ctx.membershipId);

      const converted = await leadService.getLead(ctx, lead.id);
      expect(converted.convertedAt).not.toBeNull();
    });

    it("requires a company to convert a lead that has none", async () => {
      const org = await createTestOrganization();
      const ctx = await createTestContext(org.id, "SALES");
      const leadStatusId = await getLeadStatusId(org.id);
      const { lead } = await leadService.createLead(ctx, { leadStatusId });

      await expect(leadService.convertLead(ctx, lead.id)).rejects.toThrow(
        ValidationError,
      );
    });

    it("accepts a companyId override for a lead with no company attached", async () => {
      const org = await createTestOrganization();
      const ctx = await createTestContext(org.id, "SALES");
      const leadStatusId = await getLeadStatusId(org.id);
      const { company } = await createCompany(ctx, { name: "Override Co" });
      const { lead } = await leadService.createLead(ctx, { leadStatusId });

      const deal = await leadService.convertLead(ctx, lead.id, {
        companyId: company.id,
      });
      expect(deal.companyId).toBe(company.id);
    });

    it("rejects converting the same lead twice", async () => {
      const org = await createTestOrganization();
      const ctx = await createTestContext(org.id, "MANAGEMENT");
      const leadStatusId = await getLeadStatusId(org.id);
      const { company } = await createCompany(ctx, { name: "Twice Co" });
      const { lead } = await leadService.createLead(ctx, {
        leadStatusId,
        companyId: company.id,
      });

      await leadService.convertLead(ctx, lead.id);
      await expect(leadService.convertLead(ctx, lead.id)).rejects.toThrow(
        ValidationError,
      );
    });

    it("Sales cannot convert a lead they do not own", async () => {
      const org = await createTestOrganization();
      const ownerCtx = await createTestContext(org.id, "SALES", "owner");
      const otherCtx = await createTestContext(org.id, "SALES", "other");
      const leadStatusId = await getLeadStatusId(org.id);
      const { company } = await createCompany(ownerCtx, { name: "Owned Co" });
      const { lead } = await leadService.createLead(ownerCtx, {
        leadStatusId,
        companyId: company.id,
      });

      await expect(leadService.convertLead(otherCtx, lead.id)).rejects.toThrow(
        ForbiddenError,
      );
    });

    it("Delivery (no leads.convert or leads.edit.*) cannot convert a lead", async () => {
      const org = await createTestOrganization();
      const salesCtx = await createTestContext(org.id, "SALES", "owner");
      const deliveryCtx = await createTestContext(org.id, "DELIVERY", "viewer");
      const leadStatusId = await getLeadStatusId(org.id);
      const { company } = await createCompany(salesCtx, { name: "Delivery Co" });
      const { lead } = await leadService.createLead(salesCtx, {
        leadStatusId,
        companyId: company.id,
      });

      await expect(
        leadService.convertLead(deliveryCtx, lead.id),
      ).rejects.toThrow(ForbiddenError);
    });
  });
});
