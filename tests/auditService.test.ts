import { describe, expect, it } from "vitest";
import { ForbiddenError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
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
  getServiceId,
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

  it("records a lead.updated event for a status change, bundling the other changed fields it also audits (FIG-600)", async () => {
    const org = await createTestOrganization();
    const managementCtx = await createTestContext(org.id, "MANAGEMENT");
    const leadStatusId = await getLeadStatusId(org.id, "NEW");
    const nextStatusId = await getLeadStatusId(org.id, "QUALIFIED");
    const { lead } = await leadService.createLead(managementCtx, { leadStatusId });

    await leadService.updateLead(managementCtx, lead.id, { leadStatusId: nextStatusId });

    const history = await auditService.listAuditHistory(managementCtx, "Lead", lead.id);
    const event = history.find((e) => e.action === "lead.updated");
    expect(event).toBeDefined();
    expect((event!.previousValue as { leadStatusId?: string }).leadStatusId).toBe(leadStatusId);
    expect((event!.newValue as { leadStatusId?: string }).leadStatusId).toBe(nextStatusId);
  });

  it("does not record a lead.updated event for an edit that only touches an untracked field", async () => {
    const org = await createTestOrganization();
    const managementCtx = await createTestContext(org.id, "MANAGEMENT");
    const leadStatusId = await getLeadStatusId(org.id);
    const { lead } = await leadService.createLead(managementCtx, { leadStatusId });

    await leadService.updateLead(managementCtx, lead.id, { notes: "just a note" });

    const history = await auditService.listAuditHistory(managementCtx, "Lead", lead.id);
    expect(history).toHaveLength(0);
  });

  it("records a deal.updated event for a value/service change that doesn't flip the outcome", async () => {
    const org = await createTestOrganization();
    const managementCtx = await createTestContext(org.id, "MANAGEMENT");
    const { company } = await createCompany(managementCtx, { name: "Value Co" });
    const pipelineStageId = await getPipelineStageId(org.id);
    const serviceId = await getServiceId(org.id);
    const deal = await dealService.createDeal(managementCtx, {
      companyId: company.id,
      pipelineStageId,
      value: 1000,
    });

    await dealService.updateDeal(managementCtx, deal.id, { value: 2500, serviceId });

    const history = await auditService.listAuditHistory(managementCtx, "Deal", deal.id);
    const event = history.find((e) => e.action === "deal.updated");
    expect(event).toBeDefined();
    expect((event!.newValue as { value?: number }).value).toBe(2500);
    expect((event!.newValue as { serviceId?: string }).serviceId).toBe(serviceId);
  });

  it("records a deal.updated event (not outcome_changed) for a stage move between two open stages", async () => {
    const org = await createTestOrganization();
    const managementCtx = await createTestContext(org.id, "MANAGEMENT");
    const { company } = await createCompany(managementCtx, { name: "Stage Co" });
    const firstStageId = await getPipelineStageId(org.id, "SOLUTION_PRESENTED");
    const secondStageId = await getPipelineStageId(org.id, "PROPOSAL_SENT");
    const deal = await dealService.createDeal(managementCtx, {
      companyId: company.id,
      pipelineStageId: firstStageId,
    });

    await dealService.updateDeal(managementCtx, deal.id, { pipelineStageId: secondStageId });

    const history = await auditService.listAuditHistory(managementCtx, "Deal", deal.id);
    expect(history.map((e) => e.action)).not.toContain("deal.outcome_changed");
    const event = history.find((e) => e.action === "deal.updated");
    expect(event).toBeDefined();
    expect((event!.newValue as { pipelineStageId?: string }).pipelineStageId).toBe(secondStageId);
  });

  it("does not double-log the pipeline stage in deal.updated when the same move already produced deal.outcome_changed", async () => {
    const org = await createTestOrganization();
    const managementCtx = await createTestContext(org.id, "MANAGEMENT");
    const { company } = await createCompany(managementCtx, { name: "Won Co" });
    const pipelineStageId = await getPipelineStageId(org.id);
    const wonStageId = await getPipelineStageId(org.id, "CLOSED_WON");
    const deal = await dealService.createDeal(managementCtx, {
      companyId: company.id,
      pipelineStageId,
    });

    await dealService.updateDeal(managementCtx, deal.id, { pipelineStageId: wonStageId });

    const history = await auditService.listAuditHistory(managementCtx, "Deal", deal.id);
    expect(history.map((e) => e.action)).toContain("deal.outcome_changed");
    expect(history.map((e) => e.action)).not.toContain("deal.updated");
  });

  it("records a company.updated event for a name/lifecycle-state change", async () => {
    const org = await createTestOrganization();
    const managementCtx = await createTestContext(org.id, "MANAGEMENT");
    const { company } = await createCompany(managementCtx, { name: "Old Name Ltd" });
    const lifecycleState = await adminDb.customerLifecycleState.findFirstOrThrow({
      where: { organizationId: org.id, key: "CUSTOMER" },
    });

    await updateCompany(managementCtx, company.id, {
      name: "New Name Ltd",
      lifecycleStateId: lifecycleState.id,
    });

    const history = await auditService.listAuditHistory(managementCtx, "Company", company.id);
    const event = history.find((e) => e.action === "company.updated");
    expect(event).toBeDefined();
    expect((event!.newValue as { name?: string }).name).toBe("New Name Ltd");
    expect((event!.newValue as { lifecycleStateId?: string }).lifecycleStateId).toBe(
      lifecycleState.id,
    );
  });

  it("records a contact.updated event for a re-parenting to a different company", async () => {
    const org = await createTestOrganization();
    const managementCtx = await createTestContext(org.id, "MANAGEMENT");
    const { contact } = await createContact(managementCtx, { firstName: "Ada", lastName: "Lovelace" });
    const { company } = await createCompany(managementCtx, { name: "New Employer Ltd" });

    await updateContact(managementCtx, contact.id, { companyId: company.id });

    const history = await auditService.listAuditHistory(managementCtx, "Contact", contact.id);
    const event = history.find((e) => e.action === "contact.updated");
    expect(event).toBeDefined();
    expect((event!.newValue as { companyId?: string }).companyId).toBe(company.id);
  });
});
