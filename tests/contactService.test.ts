import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { archiveCompany, createCompany } from "../src/services/companyService";
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

describe("contactService: roles, ownership and company links", () => {
  it("makes the creator the owner by default", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");
    const { contact } = await contactService.createContact(ctx, { firstName: "Mine" });
    expect(contact.ownerMembershipId).toBe(ctx.membershipId);
  });

  it("lets Management create a contact for someone else, but not Sales", async () => {
    const org = await createTestOrganization();
    const management = await createTestContext(org.id, "MANAGEMENT");
    const sales = await createTestContext(org.id, "SALES");
    const salesTwo = await createTestContext(org.id, "SALES");

    const { contact } = await contactService.createContact(management, {
      firstName: "Handed",
      ownerMembershipId: sales.membershipId,
    });
    expect(contact.ownerMembershipId).toBe(sales.membershipId);

    await expect(
      contactService.createContact(sales, {
        firstName: "Sneaky",
        ownerMembershipId: salesTwo.membershipId,
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("rejects an owner whose role cannot work contacts", async () => {
    const org = await createTestOrganization();
    const management = await createTestContext(org.id, "MANAGEMENT");
    const finance = await createTestContext(org.id, "FINANCE");
    const { contact } = await contactService.createContact(management, { firstName: "Held" });

    await expect(
      contactService.updateContact(management, contact.id, {
        ownerMembershipId: finance.membershipId,
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("lets Sales edit any contact's details but not reassign it", async () => {
    const org = await createTestOrganization();
    const management = await createTestContext(org.id, "MANAGEMENT");
    const sales = await createTestContext(org.id, "SALES");
    const { contact } = await contactService.createContact(management, { firstName: "Shared" });

    const updated = await contactService.updateContact(sales, contact.id, {
      jobTitle: "Buyer",
    });
    expect(updated.jobTitle).toBe("Buyer");

    await expect(
      contactService.updateContact(sales, contact.id, {
        ownerMembershipId: sales.membershipId,
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("gives view-only roles read access but no write access", async () => {
    const org = await createTestOrganization();
    const management = await createTestContext(org.id, "MANAGEMENT");
    const { contact } = await contactService.createContact(management, { firstName: "Look" });

    for (const role of ["DELIVERY", "FINANCE"] as const) {
      const ctx = await createTestContext(org.id, role);
      expect((await contactService.listContacts(ctx)).length).toBeGreaterThan(0);
      await expect(contactService.createContact(ctx, { firstName: "X" })).rejects.toThrow(ForbiddenError);
      await expect(
        contactService.updateContact(ctx, contact.id, { firstName: "Y" }),
      ).rejects.toThrow(ForbiddenError);
      await expect(contactService.archiveContact(ctx, contact.id)).rejects.toThrow(ForbiddenError);
    }
  });

  it("shuts Restricted Technical out of contacts entirely", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "RESTRICTED_TECHNICAL");
    await expect(contactService.listContacts(ctx)).rejects.toThrow(ForbiddenError);
    await expect(contactService.listAssignableContactOwners(ctx)).rejects.toThrow(ForbiddenError);
  });

  it("makes an archived contact read-only until it is restored", async () => {
    const org = await createTestOrganization();
    const sales = await createTestContext(org.id, "SALES");
    const { contact } = await contactService.createContact(sales, { firstName: "Dormant" });

    await contactService.archiveContact(sales, contact.id);
    await expect(
      contactService.updateContact(sales, contact.id, { firstName: "Changed" }),
    ).rejects.toThrow(ValidationError);

    await contactService.restoreContact(sales, contact.id);
    const edited = await contactService.updateContact(sales, contact.id, { firstName: "Changed" });
    expect(edited.firstName).toBe("Changed");
  });

  it("refuses to file a contact under a company from another organization or an archived one", async () => {
    const orgA = await createTestOrganization();
    const orgB = await createTestOrganization();
    const ctxA = await createTestContext(orgA.id, "SALES");
    const ctxB = await createTestContext(orgB.id, "SALES");
    const { company: foreign } = await createCompany(ctxB, { name: "Foreign Co" });
    const { company: local } = await createCompany(ctxA, { name: "Local Co" });

    await expect(
      contactService.createContact(ctxA, { firstName: "Lost", companyId: foreign.id }),
    ).rejects.toThrow(ValidationError);

    const { contact } = await contactService.createContact(ctxA, {
      firstName: "Filed",
      companyId: local.id,
    });
    await archiveCompany(ctxA, local.id);

    // New filings under the archived company are refused...
    await expect(
      contactService.createContact(ctxA, { firstName: "Late", companyId: local.id }),
    ).rejects.toThrow(ValidationError);
    // ...but the existing contact can still be corrected without touching its company.
    const fixed = await contactService.updateContact(ctxA, contact.id, { jobTitle: "CFO" });
    expect(fixed.jobTitle).toBe("CFO");
  });

  it("validates and normalises what is typed", async () => {
    const org = await createTestOrganization();
    const sales = await createTestContext(org.id, "SALES");

    await expect(
      contactService.createContact(sales, { firstName: "  " }),
    ).rejects.toThrow(ValidationError);
    await expect(
      contactService.createContact(sales, { firstName: "Bad", email: "nope" }),
    ).rejects.toThrow(ValidationError);

    const { contact } = await contactService.createContact(sales, {
      firstName: "  Ada ",
      lastName: " Lovelace ",
    });
    expect(contact.firstName).toBe("Ada");
    expect(contact.lastName).toBe("Lovelace");

    const cleared = await contactService.updateContact(sales, contact.id, { lastName: "" });
    expect(cleared.lastName).toBeNull();
  });
});
