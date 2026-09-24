import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError } from "../src/auth/errors";
import { createCompany } from "../src/services/companyService";
import * as contactService from "../src/services/contactService";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";

describe("contactService", () => {
  it("creates a standalone contact (no company)", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");

    const { contact } = await contactService.createContact(ctx, {
      firstName: "Standalone",
      lastName: "Person",
    });
    expect(contact.companyId).toBeNull();
  });

  it("supports multiple contacts per company", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");
    const { company } = await createCompany(ctx, { name: "Multi-Contact Co" });

    await contactService.createContact(ctx, {
      firstName: "Jane",
      companyId: company.id,
    });
    await contactService.createContact(ctx, {
      firstName: "John",
      companyId: company.id,
    });

    const contacts = await contactService.listContacts(ctx, {
      companyId: company.id,
    });
    expect(contacts).toHaveLength(2);
  });

  it("surfaces duplicate contacts by email without blocking creation", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");

    await contactService.createContact(ctx, {
      firstName: "First",
      email: "dup@example.test",
    });
    const { possibleDuplicates } = await contactService.createContact(ctx, {
      firstName: "Second",
      email: "dup@example.test",
    });

    expect(possibleDuplicates.length).toBeGreaterThan(0);
  });

  it("rejects contact creation for a role without contacts.create", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "RESTRICTED_TECHNICAL");
    await expect(
      contactService.createContact(ctx, { firstName: "Nope" }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("throws NotFoundError for a contact outside the caller's organization", async () => {
    const orgA = await createTestOrganization();
    const orgB = await createTestOrganization();
    const ctxA = await createTestContext(orgA.id, "MANAGEMENT");
    const ctxB = await createTestContext(orgB.id, "MANAGEMENT");

    const { contact } = await contactService.createContact(ctxA, {
      firstName: "Org A Person",
    });

    await expect(contactService.getContact(ctxB, contact.id)).rejects.toThrow(
      NotFoundError,
    );
  });
});
