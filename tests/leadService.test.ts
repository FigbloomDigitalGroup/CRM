import { describe, expect, it } from "vitest";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
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

    // Exists in the same organization but is not visible to the caller ->
    // NotFoundError, the same answer a missing id gets, so existence is never
    // leaked (B1.02). A role that cannot use leads at all still gets the
    // explained ForbiddenError. A genuinely nonexistent/cross-tenant id is
    // covered in tests/tenant-isolation.test.ts.
    await expect(leadService.getLead(otherCtx, lead.id)).rejects.toThrow(
      NotFoundError,
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
    ).rejects.toThrow(NotFoundError);
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
        NotFoundError,
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

    it("creates a new company inline when the lead has none, and backfills the lead itself (FIG-601)", async () => {
      const org = await createTestOrganization();
      const ctx = await createTestContext(org.id, "SALES");
      const leadStatusId = await getLeadStatusId(org.id);
      const { lead } = await leadService.createLead(ctx, { leadStatusId });

      const deal = await leadService.convertLead(ctx, lead.id, {
        newCompany: { name: "Inline Co" },
      });
      expect(deal.company.name).toBe("Inline Co");

      const converted = await leadService.getLead(ctx, lead.id);
      expect(converted.companyId).toBe(deal.companyId);
    });

    it("creates a new contact inline alongside a new company, and backfills the lead", async () => {
      const org = await createTestOrganization();
      const ctx = await createTestContext(org.id, "SALES");
      const leadStatusId = await getLeadStatusId(org.id);
      const { lead } = await leadService.createLead(ctx, { leadStatusId });

      const deal = await leadService.convertLead(ctx, lead.id, {
        newCompany: { name: "Inline Co Two" },
        newContact: { firstName: "Jamie", lastName: "Inline" },
      });
      expect(deal.primaryContact?.firstName).toBe("Jamie");

      const converted = await leadService.getLead(ctx, lead.id);
      expect(converted.contactId).toBe(deal.primaryContactId);
    });

    it("rejects an inline company with a blank name", async () => {
      const org = await createTestOrganization();
      const ctx = await createTestContext(org.id, "SALES");
      const leadStatusId = await getLeadStatusId(org.id);
      const { lead } = await leadService.createLead(ctx, { leadStatusId });

      await expect(
        leadService.convertLead(ctx, lead.id, { newCompany: { name: "   " } }),
      ).rejects.toThrow(ValidationError);
    });

    it("prefers an existing companyId over newCompany when both are given", async () => {
      const org = await createTestOrganization();
      const ctx = await createTestContext(org.id, "SALES");
      const leadStatusId = await getLeadStatusId(org.id);
      const { company } = await createCompany(ctx, { name: "Existing Wins Co" });
      const { lead } = await leadService.createLead(ctx, { leadStatusId });

      const deal = await leadService.convertLead(ctx, lead.id, {
        companyId: company.id,
        newCompany: { name: "Should Not Be Created" },
      });
      expect(deal.companyId).toBe(company.id);
    });
  });
});

describe("leadService: who can change what (roles & lead states)", () => {
  async function setup() {
    const org = await createTestOrganization();
    const management = await createTestContext(org.id, "MANAGEMENT", "mgmt");
    const sales = await createTestContext(org.id, "SALES", "sales");
    const salesTwo = await createTestContext(org.id, "SALES", "sales2");
    const finance = await createTestContext(org.id, "FINANCE", "fin");
    const delivery = await createTestContext(org.id, "DELIVERY", "deliv");
    const tech = await createTestContext(org.id, "RESTRICTED_TECHNICAL", "tech");
    const leadStatusId = await getLeadStatusId(org.id);
    return { org, management, sales, salesTwo, finance, delivery, tech, leadStatusId };
  }

  describe("owner on creation", () => {
    it("Sales cannot create a lead owned by someone else", async () => {
      const { sales, salesTwo, leadStatusId } = await setup();
      await expect(
        leadService.createLead(sales, {
          leadStatusId,
          ownerMembershipId: salesTwo.membershipId,
        }),
      ).rejects.toThrow(ForbiddenError);
    });

    it("Sales may still name themselves as the owner", async () => {
      const { sales, leadStatusId } = await setup();
      const { lead } = await leadService.createLead(sales, {
        leadStatusId,
        ownerMembershipId: sales.membershipId,
      });
      expect(lead.ownerMembershipId).toBe(sales.membershipId);
    });

    it("Management can create a lead for a Sales user", async () => {
      const { management, sales, leadStatusId } = await setup();
      const { lead } = await leadService.createLead(management, {
        leadStatusId,
        ownerMembershipId: sales.membershipId,
      });
      expect(lead.ownerMembershipId).toBe(sales.membershipId);
    });

    it("Management cannot create a lead owned by a role that cannot work leads", async () => {
      const { management, finance, leadStatusId } = await setup();
      await expect(
        leadService.createLead(management, {
          leadStatusId,
          ownerMembershipId: finance.membershipId,
        }),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe("reassigning", () => {
    it("rejects owners whose role cannot view/edit leads (Finance, Delivery, Restricted Technical)", async () => {
      const { management, finance, delivery, tech, leadStatusId } = await setup();
      const { lead } = await leadService.createLead(management, { leadStatusId });
      for (const target of [finance, delivery, tech]) {
        await expect(
          leadService.assignLead(management, lead.id, target.membershipId),
        ).rejects.toThrow(ValidationError);
      }
    });

    it("lists only people who can work leads as assignable owners", async () => {
      const { management, sales, salesTwo, finance, delivery, tech } = await setup();
      const owners = await leadService.listAssignableLeadOwners(management);
      const ids = owners.map((o) => o.membershipId);
      expect(ids).toEqual(
        expect.arrayContaining([
          management.membershipId,
          sales.membershipId,
          salesTwo.membershipId,
        ]),
      );
      for (const excluded of [finance, delivery, tech]) {
        expect(ids).not.toContain(excluded.membershipId);
      }
    });

    it("Sales cannot list assignable owners (no leads.assign)", async () => {
      const { sales } = await setup();
      await expect(leadService.listAssignableLeadOwners(sales)).rejects.toThrow(
        ForbiddenError,
      );
    });

    it("does not reassign an archived or converted lead", async () => {
      const { management, sales, leadStatusId } = await setup();
      const { lead: archived } = await leadService.createLead(management, { leadStatusId });
      await leadService.archiveLead(management, archived.id);
      await expect(
        leadService.assignLead(management, archived.id, sales.membershipId),
      ).rejects.toThrow(ValidationError);

      const { lead: converted } = await leadService.createLead(management, { leadStatusId });
      await leadService.convertLead(management, converted.id, {
        newCompany: { name: "Reassign Guard Co" },
      });
      await expect(
        leadService.assignLead(management, converted.id, sales.membershipId),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe("editing", () => {
    it("Sales can change temperature, notes and follow-up on their own lead", async () => {
      const { sales, leadStatusId } = await setup();
      const { lead } = await leadService.createLead(sales, { leadStatusId });
      const updated = await leadService.updateLead(sales, lead.id, {
        temperature: "HOT",
        notes: "called back",
        nextFollowUpAt: new Date("2030-01-01T09:00:00Z"),
      });
      expect(updated.temperature).toBe("HOT");
      expect(updated.notes).toBe("called back");
    });

    it("an edit can never change the owner, even if the payload tries", async () => {
      const { management, sales, salesTwo, leadStatusId } = await setup();
      const { lead } = await leadService.createLead(sales, { leadStatusId });
      await leadService.updateLead(sales, lead.id, {
        notes: "x",
        ...({ ownerMembershipId: salesTwo.membershipId } as object),
      });
      const after = await leadService.getLead(management, lead.id);
      expect(after.ownerMembershipId).toBe(sales.membershipId);
    });

    it("roles with no lead permissions cannot see or edit leads", async () => {
      const { management, finance, delivery, tech, leadStatusId } = await setup();
      const { lead } = await leadService.createLead(management, { leadStatusId });
      for (const ctx of [finance, delivery, tech]) {
        await expect(leadService.listLeads(ctx)).rejects.toThrow(ForbiddenError);
        await expect(leadService.getLead(ctx, lead.id)).rejects.toThrow(ForbiddenError);
        await expect(
          leadService.updateLead(ctx, lead.id, { notes: "nope" }),
        ).rejects.toThrow(ForbiddenError);
      }
    });

    it("an archived lead is read-only until it is restored", async () => {
      const { sales, leadStatusId } = await setup();
      const { lead } = await leadService.createLead(sales, { leadStatusId });
      await leadService.archiveLead(sales, lead.id);

      await expect(
        leadService.updateLead(sales, lead.id, { notes: "while archived" }),
      ).rejects.toThrow(ValidationError);
      await expect(leadService.convertLead(sales, lead.id)).rejects.toThrow(
        ValidationError,
      );

      await leadService.restoreLead(sales, lead.id);
      const updated = await leadService.updateLead(sales, lead.id, {
        notes: "after restore",
      });
      expect(updated.notes).toBe("after restore");
    });

    it("a converted lead keeps its status locked but its notes stay editable", async () => {
      const { sales, leadStatusId, org } = await setup();
      const { lead } = await leadService.createLead(sales, { leadStatusId });
      await leadService.convertLead(sales, lead.id, { newCompany: { name: "Lock Co" } });

      const qualifiedId = await getLeadStatusId(org.id, "QUALIFIED");
      await expect(
        leadService.updateLead(sales, lead.id, { leadStatusId: qualifiedId }),
      ).rejects.toThrow(ValidationError);

      const updated = await leadService.updateLead(sales, lead.id, {
        notes: "still editable",
      });
      expect(updated.notes).toBe("still editable");
    });
  });

  describe("status rules", () => {
    it("Converted can only be reached by converting, not by picking the status", async () => {
      const { sales, leadStatusId, org } = await setup();
      const { lead } = await leadService.createLead(sales, { leadStatusId });
      const convertedId = await getLeadStatusId(org.id, "CONVERTED");
      await expect(
        leadService.updateLead(sales, lead.id, { leadStatusId: convertedId }),
      ).rejects.toThrow(ValidationError);
    });

    it("Lost requires a lost reason, and moving away from Lost clears it", async () => {
      const { sales, leadStatusId, org } = await setup();
      const { lead } = await leadService.createLead(sales, { leadStatusId });
      const lostId = await getLeadStatusId(org.id, "LOST");
      const reason = await adminDb.lostReason.create({
        data: { organizationId: org.id, key: "TEST_REASON", name: "Test reason", sequence: 1 },
      });

      await expect(
        leadService.updateLead(sales, lead.id, { leadStatusId: lostId }),
      ).rejects.toThrow(ValidationError);

      const lost = await leadService.updateLead(sales, lead.id, {
        leadStatusId: lostId,
        lostReasonId: reason.id,
      });
      expect(lost.lostReasonId).toBe(reason.id);

      const reopened = await leadService.updateLead(sales, lead.id, {
        leadStatusId,
      });
      expect(reopened.lostReasonId).toBeNull();
    });
  });

  describe("converting", () => {
    it("Sales cannot pick a different owner for the new deal", async () => {
      const { sales, salesTwo, leadStatusId } = await setup();
      const { lead } = await leadService.createLead(sales, { leadStatusId });
      await expect(
        leadService.convertLead(sales, lead.id, {
          newCompany: { name: "Owner Guard Co" },
          ownerMembershipId: salesTwo.membershipId,
        }),
      ).rejects.toThrow(ForbiddenError);
    });

    it("Sales may leave the deal owner as themselves", async () => {
      const { sales, leadStatusId } = await setup();
      const { lead } = await leadService.createLead(sales, { leadStatusId });
      const deal = await leadService.convertLead(sales, lead.id, {
        newCompany: { name: "Self Owner Co" },
        ownerMembershipId: sales.membershipId,
      });
      expect(deal.ownerMembershipId).toBe(sales.membershipId);
    });

    it("Management can choose the deal owner, but only among people who can work deals", async () => {
      const { management, sales, tech, leadStatusId } = await setup();
      const { lead } = await leadService.createLead(management, { leadStatusId });
      await expect(
        leadService.convertLead(management, lead.id, {
          newCompany: { name: "Bad Owner Co" },
          ownerMembershipId: tech.membershipId,
        }),
      ).rejects.toThrow(ValidationError);

      const deal = await leadService.convertLead(management, lead.id, {
        newCompany: { name: "Good Owner Co" },
        ownerMembershipId: sales.membershipId,
      });
      expect(deal.ownerMembershipId).toBe(sales.membershipId);
    });
  });
});
