import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError } from "../src/auth/errors";
import * as companyService from "../src/services/companyService";
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
