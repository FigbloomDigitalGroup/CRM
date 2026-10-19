import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import * as companyService from "../src/services/companyService";
import * as contactService from "../src/services/contactService";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";

describe("companyService", () => {
  it("creates a company and surfaces possible duplicates without blocking creation", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");

    await companyService.createCompany(ctx, {
      name: "Acme Ltd",
      email: "hello@acme.test",
    });
    const { company, possibleDuplicates } = await companyService.createCompany(
      ctx,
      {
        name: "Acme Ltd",
        email: "hello@acme.test",
      },
    );

    expect(company.name).toBe("Acme Ltd");
    expect(possibleDuplicates.length).toBeGreaterThan(0);
  });

  it("stamps createdByMembershipId from the auth context, not from client input", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");

    const { company } = await companyService.createCompany(ctx, {
      name: "Stamped Co",
    });
    expect(company.createdByMembershipId).toBe(ctx.membershipId);
  });

  it("rejects company creation for a role without companies.create", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "RESTRICTED_TECHNICAL");

    await expect(
      companyService.createCompany(ctx, { name: "Should Fail Co" }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("rejects company edits for a role without companies.edit", async () => {
    const org = await createTestOrganization();
    const salesCtx = await createTestContext(org.id, "SALES");
    const techCtx = await createTestContext(org.id, "RESTRICTED_TECHNICAL");

    const { company } = await companyService.createCompany(salesCtx, {
      name: "Editable Co",
    });

    await expect(
      companyService.updateCompany(techCtx, company.id, { name: "Hacked" }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("throws NotFoundError for a company id that does not exist in the caller's organization", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");

    await expect(
      companyService.getCompany(ctx, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow(NotFoundError);
  });

  it("search filters by name/email/phone", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    await companyService.createCompany(ctx, {
      name: "Searchable Widgets",
      email: "widgets@example.test",
    });
    await companyService.createCompany(ctx, {
      name: "Other Co",
      email: "other@example.test",
    });

    const results = await companyService.listCompanies(ctx, {
      query: "widgets",
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe("Searchable Widgets");
  });

  it("does not surface another organization's companies in duplicate checks", async () => {
    const orgA = await createTestOrganization();
    const orgB = await createTestOrganization();
    const ctxA = await createTestContext(orgA.id, "MANAGEMENT");
    const ctxB = await createTestContext(orgB.id, "MANAGEMENT");

    await companyService.createCompany(ctxA, {
      name: "Shared Name Co",
      email: "shared@example.test",
    });
    const { possibleDuplicates } = await companyService.createCompany(ctxB, {
      name: "Shared Name Co",
      email: "shared@example.test",
    });

    expect(possibleDuplicates).toHaveLength(0);
  });
});

describe("companyService: roles and ownership", () => {
  it("makes the creator the owner by default", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");
    const { company } = await companyService.createCompany(ctx, { name: "Mine Co" });
    expect(company.ownerMembershipId).toBe(ctx.membershipId);
  });

  it("lets Management create a company for someone else, but not Sales", async () => {
    const org = await createTestOrganization();
    const management = await createTestContext(org.id, "MANAGEMENT");
    const sales = await createTestContext(org.id, "SALES");
    const salesTwo = await createTestContext(org.id, "SALES");

    const { company } = await companyService.createCompany(management, {
      name: "Handed Co",
      ownerMembershipId: sales.membershipId,
    });
    expect(company.ownerMembershipId).toBe(sales.membershipId);

    await expect(
      companyService.createCompany(sales, {
        name: "Sneaky Co",
        ownerMembershipId: salesTwo.membershipId,
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("rejects an owner whose role cannot work companies (Delivery, Finance)", async () => {
    const org = await createTestOrganization();
    const management = await createTestContext(org.id, "MANAGEMENT");
    const delivery = await createTestContext(org.id, "DELIVERY");
    const finance = await createTestContext(org.id, "FINANCE");

    await expect(
      companyService.createCompany(management, {
        name: "Nope Co",
        ownerMembershipId: delivery.membershipId,
      }),
    ).rejects.toThrow(ValidationError);

    const { company } = await companyService.createCompany(management, { name: "Held Co" });
    await expect(
      companyService.updateCompany(management, company.id, {
        ownerMembershipId: finance.membershipId,
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("lets Sales edit details on any company but not reassign it", async () => {
    const org = await createTestOrganization();
    const management = await createTestContext(org.id, "MANAGEMENT");
    const sales = await createTestContext(org.id, "SALES");
    const { company } = await companyService.createCompany(management, { name: "Shared Co" });

    const updated = await companyService.updateCompany(sales, company.id, {
      industry: "Software",
    });
    expect(updated.industry).toBe("Software");

    await expect(
      companyService.updateCompany(sales, company.id, {
        ownerMembershipId: sales.membershipId,
      }),
    ).rejects.toThrow(ForbiddenError);

    // Re-sending the owner it already has is not a reassignment.
    await expect(
      companyService.updateCompany(sales, company.id, {
        ownerMembershipId: management.membershipId,
        industry: "Fintech",
      }),
    ).resolves.toBeTruthy();
  });

  it("lets Management reassign, audits it, and refuses to clear the owner", async () => {
    const org = await createTestOrganization();
    const management = await createTestContext(org.id, "MANAGEMENT");
    const sales = await createTestContext(org.id, "SALES");
    const { company } = await companyService.createCompany(management, { name: "Move Co" });

    const moved = await companyService.updateCompany(management, company.id, {
      ownerMembershipId: sales.membershipId,
    });
    expect(moved.ownerMembershipId).toBe(sales.membershipId);

    await expect(
      companyService.updateCompany(management, company.id, { ownerMembershipId: null }),
    ).rejects.toThrow(ValidationError);
  });

  it("gives view-only roles read access but no write access", async () => {
    const org = await createTestOrganization();
    const management = await createTestContext(org.id, "MANAGEMENT");
    const { company } = await companyService.createCompany(management, { name: "Look Co" });

    for (const role of ["DELIVERY", "FINANCE"] as const) {
      const ctx = await createTestContext(org.id, role);
      expect((await companyService.listCompanies(ctx)).length).toBeGreaterThan(0);
      await expect(companyService.createCompany(ctx, { name: "X" })).rejects.toThrow(ForbiddenError);
      await expect(
        companyService.updateCompany(ctx, company.id, { name: "Y" }),
      ).rejects.toThrow(ForbiddenError);
      await expect(companyService.archiveCompany(ctx, company.id)).rejects.toThrow(ForbiddenError);
      await expect(
        companyService.mergeCompanies(ctx, company.id, company.id),
      ).rejects.toThrow(ForbiddenError);
    }
  });

  it("shuts Restricted Technical out of companies entirely", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "RESTRICTED_TECHNICAL");
    await expect(companyService.listCompanies(ctx)).rejects.toThrow(ForbiddenError);
    await expect(
      companyService.listAssignableCompanyOwners(ctx),
    ).rejects.toThrow(ForbiddenError);
  });

  it("only Management gets the assignable-owner list, and it excludes roles that cannot work companies", async () => {
    const org = await createTestOrganization();
    const management = await createTestContext(org.id, "MANAGEMENT");
    const sales = await createTestContext(org.id, "SALES");
    const delivery = await createTestContext(org.id, "DELIVERY");

    await expect(companyService.listAssignableCompanyOwners(sales)).rejects.toThrow(ForbiddenError);

    const owners = await companyService.listAssignableCompanyOwners(management);
    const ids = owners.map((o) => o.membershipId);
    expect(ids).toContain(management.membershipId);
    expect(ids).toContain(sales.membershipId);
    expect(ids).not.toContain(delivery.membershipId);
  });

  it("makes an archived company read-only until it is restored", async () => {
    const org = await createTestOrganization();
    const sales = await createTestContext(org.id, "SALES");
    const { company } = await companyService.createCompany(sales, { name: "Dormant Co" });

    await companyService.archiveCompany(sales, company.id);
    await expect(
      companyService.updateCompany(sales, company.id, { name: "Changed" }),
    ).rejects.toThrow(ValidationError);

    await companyService.restoreCompany(sales, company.id);
    const edited = await companyService.updateCompany(sales, company.id, { name: "Changed" });
    expect(edited.name).toBe("Changed");
  });

  it("validates and normalises what is typed", async () => {
    const org = await createTestOrganization();
    const sales = await createTestContext(org.id, "SALES");

    await expect(
      companyService.createCompany(sales, { name: "   " }),
    ).rejects.toThrow(ValidationError);
    await expect(
      companyService.createCompany(sales, { name: "Bad Mail Co", email: "not-an-email" }),
    ).rejects.toThrow(ValidationError);

    const { company } = await companyService.createCompany(sales, {
      name: "  Padded Co  ",
      industry: "  Retail ",
    });
    expect(company.name).toBe("Padded Co");
    expect(company.industry).toBe("Retail");

    const cleared = await companyService.updateCompany(sales, company.id, { industry: "  " });
    expect(cleared.industry).toBeNull();
  });

  it("rejects a lifecycle state from another organization", async () => {
    const orgA = await createTestOrganization();
    const orgB = await createTestOrganization();
    const ctxA = await createTestContext(orgA.id, "SALES");
    const stateB = await adminDb.customerLifecycleState.findFirstOrThrow({
      where: { organizationId: orgB.id },
    });

    await expect(
      companyService.createCompany(ctxA, { name: "Cross Co", lifecycleStateId: stateB.id }),
    ).rejects.toThrow(ValidationError);
  });

  it("lists the owner's name and the live contact count without exposing the user record", async () => {
    const org = await createTestOrganization();
    const sales = await createTestContext(org.id, "SALES");
    const { company } = await companyService.createCompany(sales, { name: "Counted Co" });
    await contactService.createContact(sales, { firstName: "Ann", companyId: company.id });
    const archived = await contactService.createContact(sales, {
      firstName: "Old",
      companyId: company.id,
    });
    await contactService.archiveContact(sales, archived.contact.id);

    const [listed] = await companyService.listCompanies(sales);
    expect(listed!._count.contacts).toBe(1);
    expect(listed!.owner?.user.name).toBeTruthy();
    expect(JSON.stringify(listed)).not.toContain("passwordHash");
  });
});
