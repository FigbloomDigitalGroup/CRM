import { describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import {
  createTestMembership,
  createTestOrganization,
  getLeadStatusId,
  getLostReasonId,
  getPipelineStageId,
} from "./helpers/fixtures";

/**
 * Uses `adminDb` (bypassing RLS) on purpose, so what's being verified is
 * specifically the composite tenant-integrity foreign keys and CHECK
 * constraints from prisma/migrations/*_tenant_integrity_and_rls -- these
 * apply to every role, not just the RLS-restricted application role. RLS
 * itself is covered separately in tests/tenant-isolation.test.ts.
 */
describe("core relationships", () => {
  it("creates a full Company -> Contact -> Lead -> Deal chain within one organization", async () => {
    const org = await createTestOrganization();
    const { membership } = await createTestMembership(org.id, "SALES");
    const leadStatusId = await getLeadStatusId(org.id);
    const pipelineStageId = await getPipelineStageId(org.id);

    const company = await adminDb.company.create({
      data: {
        organizationId: org.id,
        name: "Acme Ltd",
        ownerMembershipId: membership.id,
      },
    });
    const contact = await adminDb.contact.create({
      data: {
        organizationId: org.id,
        companyId: company.id,
        firstName: "Jane",
        lastName: "Doe",
      },
    });
    const lead = await adminDb.lead.create({
      data: {
        organizationId: org.id,
        companyId: company.id,
        contactId: contact.id,
        leadStatusId,
        ownerMembershipId: membership.id,
      },
    });
    const deal = await adminDb.deal.create({
      data: {
        organizationId: org.id,
        companyId: company.id,
        primaryContactId: contact.id,
        leadId: lead.id,
        ownerMembershipId: membership.id,
        pipelineStageId,
      },
    });

    expect(deal.leadId).toBe(lead.id);
    expect(deal.companyId).toBe(company.id);
    expect(deal.primaryContactId).toBe(contact.id);
  });

  it("supports a contact with no company (standalone contact)", async () => {
    const org = await createTestOrganization();
    const contact = await adminDb.contact.create({
      data: {
        organizationId: org.id,
        firstName: "Standalone",
        lastName: "Contact",
      },
    });
    expect(contact.companyId).toBeNull();
  });

  it("rejects a lead referencing a company that belongs to a different organization", async () => {
    const orgA = await createTestOrganization();
    const orgB = await createTestOrganization();
    const { membership: membershipA } = await createTestMembership(
      orgA.id,
      "SALES",
    );
    const leadStatusIdA = await getLeadStatusId(orgA.id);

    const companyInOrgB = await adminDb.company.create({
      data: { organizationId: orgB.id, name: "Cross-tenant Co" },
    });

    await expect(
      adminDb.lead.create({
        data: {
          organizationId: orgA.id,
          companyId: companyInOrgB.id,
          leadStatusId: leadStatusIdA,
          ownerMembershipId: membershipA.id,
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects a deal whose owner membership belongs to a different organization", async () => {
    const orgA = await createTestOrganization();
    const orgB = await createTestOrganization();
    const { membership: membershipB } = await createTestMembership(
      orgB.id,
      "SALES",
    );
    const pipelineStageIdA = await getPipelineStageId(orgA.id);
    const companyA = await adminDb.company.create({
      data: { organizationId: orgA.id, name: "Org A Co" },
    });

    await expect(
      adminDb.deal.create({
        data: {
          organizationId: orgA.id,
          companyId: companyA.id,
          ownerMembershipId: membershipB.id,
          pipelineStageId: pipelineStageIdA,
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects a deal referencing a pipeline stage from a different organization", async () => {
    const orgA = await createTestOrganization();
    const orgB = await createTestOrganization();
    const { membership } = await createTestMembership(orgA.id, "SALES");
    const pipelineStageIdB = await getPipelineStageId(orgB.id);
    const companyA = await adminDb.company.create({
      data: { organizationId: orgA.id, name: "Org A Co" },
    });

    await expect(
      adminDb.deal.create({
        data: {
          organizationId: orgA.id,
          companyId: companyA.id,
          ownerMembershipId: membership.id,
          pipelineStageId: pipelineStageIdB,
        },
      }),
    ).rejects.toThrow();
  });

  it("requires a lead status on a lead -- a required relationship cannot be omitted", async () => {
    const org = await createTestOrganization();
    await expect(
      adminDb.lead.create({
        data: {
          organizationId: org.id,
        } as never,
      }),
    ).rejects.toThrow();
  });

  it("requires a company on a deal -- a required relationship cannot be omitted", async () => {
    const org = await createTestOrganization();
    const { membership } = await createTestMembership(org.id, "SALES");
    const pipelineStageId = await getPipelineStageId(org.id);
    await expect(
      adminDb.deal.create({
        data: {
          organizationId: org.id,
          ownerMembershipId: membership.id,
          pipelineStageId,
        } as never,
      }),
    ).rejects.toThrow();
  });

  it("prevents converting the same lead into more than one deal", async () => {
    const org = await createTestOrganization();
    const { membership } = await createTestMembership(org.id, "SALES");
    const leadStatusId = await getLeadStatusId(org.id);
    const pipelineStageId = await getPipelineStageId(org.id);
    const company = await adminDb.company.create({
      data: { organizationId: org.id, name: "Dup Co" },
    });
    const lead = await adminDb.lead.create({
      data: {
        organizationId: org.id,
        companyId: company.id,
        leadStatusId,
        ownerMembershipId: membership.id,
      },
    });

    await adminDb.deal.create({
      data: {
        organizationId: org.id,
        companyId: company.id,
        leadId: lead.id,
        ownerMembershipId: membership.id,
        pipelineStageId,
      },
    });

    await expect(
      adminDb.deal.create({
        data: {
          organizationId: org.id,
          companyId: company.id,
          leadId: lead.id,
          ownerMembershipId: membership.id,
          pipelineStageId,
        },
      }),
    ).rejects.toThrow();
  });

  it("allows multiple deals with no originating lead (e.g. existing-customer upsell)", async () => {
    const org = await createTestOrganization();
    const { membership } = await createTestMembership(org.id, "SALES");
    const pipelineStageId = await getPipelineStageId(org.id);
    const company = await adminDb.company.create({
      data: { organizationId: org.id, name: "Upsell Co" },
    });

    const dealOne = await adminDb.deal.create({
      data: {
        organizationId: org.id,
        companyId: company.id,
        ownerMembershipId: membership.id,
        pipelineStageId,
      },
    });
    const dealTwo = await adminDb.deal.create({
      data: {
        organizationId: org.id,
        companyId: company.id,
        ownerMembershipId: membership.id,
        pipelineStageId,
      },
    });

    expect(dealOne.leadId).toBeNull();
    expect(dealTwo.leadId).toBeNull();
  });

  it("requires an activity to relate to at least one CRM record", async () => {
    const org = await createTestOrganization();
    const { membership } = await createTestMembership(org.id, "SALES");
    await expect(
      adminDb.activity.create({
        data: {
          organizationId: org.id,
          type: "NOTE",
          authorMembershipId: membership.id,
        },
      }),
    ).rejects.toThrow();
  });

  it("allows a task with no linked CRM record (standalone reminder)", async () => {
    const org = await createTestOrganization();
    const { membership } = await createTestMembership(org.id, "SALES");
    const task = await adminDb.task.create({
      data: {
        organizationId: org.id,
        title: "Personal reminder",
        assigneeMembershipId: membership.id,
        createdByMembershipId: membership.id,
      },
    });
    expect(task.companyId).toBeNull();
  });

  it("enforces deal-outcome consistency: WON requires wonAt", async () => {
    const org = await createTestOrganization();
    const { membership } = await createTestMembership(org.id, "SALES");
    const pipelineStageId = await getPipelineStageId(org.id);
    const company = await adminDb.company.create({
      data: { organizationId: org.id, name: "Won Co" },
    });

    await expect(
      adminDb.deal.create({
        data: {
          organizationId: org.id,
          companyId: company.id,
          ownerMembershipId: membership.id,
          pipelineStageId,
          outcome: "WON",
        },
      }),
    ).rejects.toThrow();
  });

  it("enforces deal-outcome consistency: LOST requires lostAt and a lost reason", async () => {
    const org = await createTestOrganization();
    const { membership } = await createTestMembership(org.id, "SALES");
    const pipelineStageId = await getPipelineStageId(org.id);
    const company = await adminDb.company.create({
      data: { organizationId: org.id, name: "Lost Co" },
    });

    await expect(
      adminDb.deal.create({
        data: {
          organizationId: org.id,
          companyId: company.id,
          ownerMembershipId: membership.id,
          pipelineStageId,
          outcome: "LOST",
          lostAt: new Date(),
          // lostReasonId omitted
        },
      }),
    ).rejects.toThrow();

    const lostReasonId = await getLostReasonId(org.id);
    const deal = await adminDb.deal.create({
      data: {
        organizationId: org.id,
        companyId: company.id,
        ownerMembershipId: membership.id,
        pipelineStageId,
        outcome: "LOST",
        lostAt: new Date(),
        lostReasonId,
      },
    });
    expect(deal.outcome).toBe("LOST");
  });
});
