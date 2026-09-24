import { describe, expect, it } from "vitest";
import { ForbiddenError } from "../src/auth/errors";
import * as auditService from "../src/services/auditService";
import { createCompany, updateCompany } from "../src/services/companyService";
import { createContact, updateContact } from "../src/services/contactService";
import * as dealService from "../src/services/dealService";
import * as leadService from "../src/services/leadService";
import {
  createTestContext,
  createTestOrganization,
  getLeadStatusId,
  getPipelineStageId,
} from "./helpers/fixtures";

describe("auditService", () => {
  it("Management (audit.view) can read a lead's audit history", async () => {
    const org = await createTestOrganization();
    const managementCtx = await createTestContext(org.id, "MANAGEMENT");
    const salesCtx = await createTestContext(org.id, "SALES");
    const leadStatusId = await getLeadStatusId(org.id);
    const { lead } = await leadService.createLead(managementCtx, {
      leadStatusId,
    });

    await leadService.assignLead(managementCtx, lead.id, salesCtx.membershipId);

    const history = await auditService.listAuditHistory(
      managementCtx,
      "Lead",
      lead.id,
    );
    expect(history.length).toBeGreaterThan(0);
    expect(history[0].action).toBe("lead.owner_reassigned");
  });

  it("Sales (no audit.view) cannot read audit history", async () => {
    const org = await createTestOrganization();
    const salesCtx = await createTestContext(org.id, "SALES");

    await expect(
      auditService.listAuditHistory(salesCtx, "Lead", "irrelevant-id"),
    ).rejects.toThrow(ForbiddenError);
  });

  it("records a deal.outcome_changed event when a deal moves to a won stage", async () => {
    const org = await createTestOrganization();
    const managementCtx = await createTestContext(org.id, "MANAGEMENT");
    const { company } = await createCompany(managementCtx, { name: "Audit Co" });
    const pipelineStageId = await getPipelineStageId(org.id);
    const deal = await dealService.createDeal(managementCtx, {
      companyId: company.id,
      pipelineStageId,
    });
    const wonStageId = await getPipelineStageId(org.id, "CLOSED_WON");

    await dealService.updateDeal(managementCtx, deal.id, {
      pipelineStageId: wonStageId,
    });

    const history = await auditService.listAuditHistory(
      managementCtx,
      "Deal",
      deal.id,
    );
    expect(history.map((e) => e.action)).toContain("deal.outcome_changed");
  });

  it("does not record an outcome audit event for an edit that leaves the outcome unchanged", async () => {
    const org = await createTestOrganization();
    const managementCtx = await createTestContext(org.id, "MANAGEMENT");
    const { company } = await createCompany(managementCtx, { name: "Quiet Co" });
    const pipelineStageId = await getPipelineStageId(org.id);
    const deal = await dealService.createDeal(managementCtx, {
      companyId: company.id,
      pipelineStageId,
    });

    await dealService.updateDeal(managementCtx, deal.id, { notes: "just a note" });

    const history = await auditService.listAuditHistory(
      managementCtx,
      "Deal",
      deal.id,
    );
    expect(history).toHaveLength(0);
  });

  it("records a company.owner_reassigned event when ownerMembershipId changes", async () => {
    const org = await createTestOrganization();
    const managementCtx = await createTestContext(org.id, "MANAGEMENT");
    const salesCtx = await createTestContext(org.id, "SALES");
    const { company } = await createCompany(managementCtx, { name: "Reassign Co" });

    await updateCompany(managementCtx, company.id, {
      ownerMembershipId: salesCtx.membershipId,
    });

    const history = await auditService.listAuditHistory(
      managementCtx,
      "Company",
      company.id,
    );
    expect(history.map((e) => e.action)).toContain("company.owner_reassigned");
  });

  it("records a contact.owner_reassigned event when ownerMembershipId changes", async () => {
    const org = await createTestOrganization();
    const managementCtx = await createTestContext(org.id, "MANAGEMENT");
    const salesCtx = await createTestContext(org.id, "SALES");
    const { contact } = await createContact(managementCtx, { firstName: "Ada" });

    await updateContact(managementCtx, contact.id, {
      ownerMembershipId: salesCtx.membershipId,
    });

    const history = await auditService.listAuditHistory(
      managementCtx,
      "Contact",
      contact.id,
    );
    expect(history.map((e) => e.action)).toContain("contact.owner_reassigned");
  });
});
