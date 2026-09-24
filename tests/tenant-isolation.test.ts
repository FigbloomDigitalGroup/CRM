import { describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import {
  getUnscopedAppClientForTests,
  withOrgContext,
} from "../src/db/orgScopedClient";
import { recordAuditEvent } from "../src/repositories/auditEvents";
import { createCompany, listCompanies } from "../src/repositories/companies";
import { createLead } from "../src/repositories/leads";
import { convertLeadToDeal } from "../src/repositories/deals";
import {
  createTestMembership,
  createTestOrganization,
  getLeadStatusId,
} from "./helpers/fixtures";

/**
 * Exercises the RLS layer added in
 * prisma/migrations/*_tenant_integrity_and_rls, connecting as the
 * least-privilege `figbloom_app` role via withOrgContext/getUnscopedAppClientForTests
 * (see src/db/orgScopedClient.ts) -- never as the schema-owning admin role,
 * since RLS does not restrict the owner.
 */
describe("tenant isolation (row-level security)", () => {
  it("fails closed: no rows are visible with no organization context set", async () => {
    const org = await createTestOrganization();
    await createCompany({ organizationId: org.id, name: "Visible Co" });

    const rawAppClient = getUnscopedAppClientForTests();
    const rows = await rawAppClient.company.findMany({
      where: { organizationId: org.id },
    });
    expect(rows).toHaveLength(0);
  });

  it("organization B's context cannot read organization A's companies, even when explicitly filtering by A's id", async () => {
    const orgA = await createTestOrganization();
    const orgB = await createTestOrganization();
    await createCompany({ organizationId: orgA.id, name: "Org A Co" });

    const rowsSeenFromB = await withOrgContext(orgB.id, (tx) =>
      tx.company.findMany({ where: { organizationId: orgA.id } }),
    );
    expect(rowsSeenFromB).toHaveLength(0);
  });

  it("listCompanies only ever returns the caller's own organization's companies", async () => {
    const orgA = await createTestOrganization();
    const orgB = await createTestOrganization();
    await createCompany({ organizationId: orgA.id, name: "A Co 1" });
    await createCompany({ organizationId: orgA.id, name: "A Co 2" });
    await createCompany({ organizationId: orgB.id, name: "B Co 1" });

    const seenByA = await listCompanies(orgA.id);
    expect(seenByA).toHaveLength(2);
    expect(seenByA.every((c) => c.organizationId === orgA.id)).toBe(true);
  });

  it("cannot update another organization's record even when addressed directly by primary key", async () => {
    const orgA = await createTestOrganization();
    const orgB = await createTestOrganization();
    const company = await createCompany({
      organizationId: orgA.id,
      name: "Org A Co",
    });

    await expect(
      withOrgContext(orgB.id, (tx) =>
        tx.company.update({
          where: { id: company.id },
          data: { name: "hacked" },
        }),
      ),
    ).rejects.toThrow();

    const stillIntact = await adminDb.company.findUniqueOrThrow({
      where: { id: company.id },
    });
    expect(stillIntact.name).toBe("Org A Co");
  });

  it("cannot delete another organization's record even when addressed directly by primary key", async () => {
    const orgA = await createTestOrganization();
    const orgB = await createTestOrganization();
    const company = await createCompany({
      organizationId: orgA.id,
      name: "Org A Co",
    });

    await expect(
      withOrgContext(orgB.id, (tx) =>
        tx.company.delete({ where: { id: company.id } }),
      ),
    ).rejects.toThrow();

    const stillExists = await adminDb.company.findUnique({
      where: { id: company.id },
    });
    expect(stillExists).not.toBeNull();
  });

  it("cannot create a relationship linking to another organization's record, even while acting inside its own context", async () => {
    const orgA = await createTestOrganization();
    const orgB = await createTestOrganization();
    const { membership: membershipA } = await createTestMembership(
      orgA.id,
      "SALES",
    );
    const leadStatusIdA = await getLeadStatusId(orgA.id);

    const contactB = await adminDb.contact.create({
      data: { organizationId: orgB.id, firstName: "Cross", lastName: "Tenant" },
    });

    await expect(
      withOrgContext(orgA.id, (tx) =>
        tx.lead.create({
          data: {
            organizationId: orgA.id,
            contactId: contactB.id,
            leadStatusId: leadStatusIdA,
            ownerMembershipId: membershipA.id,
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("organization-scoped search never surfaces another organization's rows", async () => {
    const orgA = await createTestOrganization();
    const orgB = await createTestOrganization();
    await createCompany({ organizationId: orgA.id, name: "Searchable Co" });
    await createCompany({ organizationId: orgB.id, name: "Searchable Co" }); // same name, different org

    const resultsFromA = await withOrgContext(orgA.id, (tx) =>
      tx.company.findMany({ where: { name: { contains: "Searchable" } } }),
    );
    expect(resultsFromA).toHaveLength(1);
    expect(resultsFromA[0]!.organizationId).toBe(orgA.id);
  });

  it("audit events are append-only for the application role: UPDATE and DELETE are rejected", async () => {
    const org = await createTestOrganization();
    const { membership } = await createTestMembership(org.id, "MANAGEMENT");
    const event = await recordAuditEvent({
      organizationId: org.id,
      actorMembershipId: membership.id,
      action: "test.performed",
      entityType: "TestEntity",
    });

    await expect(
      withOrgContext(org.id, (tx) =>
        tx.auditEvent.update({
          where: { id: event.id },
          data: { action: "tampered" },
        }),
      ),
    ).rejects.toThrow();

    await expect(
      withOrgContext(org.id, (tx) =>
        tx.auditEvent.delete({ where: { id: event.id } }),
      ),
    ).rejects.toThrow();

    const stillIntact = await adminDb.auditEvent.findUniqueOrThrow({
      where: { id: event.id },
    });
    expect(stillIntact.action).toBe("test.performed");
  });

  it("prevents duplicate lead-to-deal conversion end-to-end through the repository layer", async () => {
    const org = await createTestOrganization();
    const { membership } = await createTestMembership(org.id, "SALES");
    const leadStatusId = await getLeadStatusId(org.id);
    const company = await createCompany({
      organizationId: org.id,
      name: "Convert Co",
      ownerMembershipId: membership.id,
    });
    const lead = await createLead({
      organizationId: org.id,
      leadStatusId,
      companyId: company.id,
      ownerMembershipId: membership.id,
    });

    const deal = await convertLeadToDeal({
      organizationId: org.id,
      leadId: lead.id,
    });
    expect(deal.leadId).toBe(lead.id);

    await expect(
      convertLeadToDeal({ organizationId: org.id, leadId: lead.id }),
    ).rejects.toThrow();
  });
});
