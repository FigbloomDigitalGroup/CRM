import { describe, expect, it } from "vitest";
import { ForbiddenError, ValidationError } from "../src/auth/errors";
import * as companyService from "../src/services/companyService";
import * as contactService from "../src/services/contactService";
import * as dealService from "../src/services/dealService";
import * as leadService from "../src/services/leadService";
import {
  createTestContext,
  createTestOrganization,
  getLeadStatusId,
  getPipelineStageId,
} from "./helpers/fixtures";

describe("archive/restore: companies", () => {
  it("archives and restores, hiding/showing it in the default list", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const { company } = await companyService.createCompany(ctx, { name: "Archive Co" });

    const archived = await companyService.archiveCompany(ctx, company.id);
    expect(archived.archivedAt).not.toBeNull();

    const defaultList = await companyService.listCompanies(ctx);
    expect(defaultList.map((c) => c.id)).not.toContain(company.id);

    const withArchived = await companyService.listCompanies(ctx, { includeArchived: true });
    expect(withArchived.map((c) => c.id)).toContain(company.id);

    const restored = await companyService.restoreCompany(ctx, company.id);
    expect(restored.archivedAt).toBeNull();

    const listAfterRestore = await companyService.listCompanies(ctx);
    expect(listAfterRestore.map((c) => c.id)).toContain(company.id);
  });

  it("rejects archiving an already-archived company, and restoring a non-archived one", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const { company } = await companyService.createCompany(ctx, { name: "Double Co" });

    await companyService.archiveCompany(ctx, company.id);
    await expect(companyService.archiveCompany(ctx, company.id)).rejects.toThrow(
      ValidationError,
    );

    const { company: other } = await companyService.createCompany(ctx, { name: "Other Co" });
    await expect(companyService.restoreCompany(ctx, other.id)).rejects.toThrow(
      ValidationError,
    );
  });

  it("rejects archive/restore for a role without companies.archive", async () => {
    const org = await createTestOrganization();
    const mgmtCtx = await createTestContext(org.id, "MANAGEMENT");
    const financeCtx = await createTestContext(org.id, "FINANCE", "finance");
    const { company } = await companyService.createCompany(mgmtCtx, { name: "Guarded Co" });

    await expect(companyService.archiveCompany(financeCtx, company.id)).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe("archive/restore: contacts", () => {
  it("archives and restores, hiding/showing it in the default list", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const { contact } = await contactService.createContact(ctx, { firstName: "Archie" });

    const archived = await contactService.archiveContact(ctx, contact.id);
    expect(archived.archivedAt).not.toBeNull();

    const defaultList = await contactService.listContacts(ctx);
    expect(defaultList.map((c) => c.id)).not.toContain(contact.id);

    const withArchived = await contactService.listContacts(ctx, { includeArchived: true });
    expect(withArchived.map((c) => c.id)).toContain(contact.id);

    const restored = await contactService.restoreContact(ctx, contact.id);
    expect(restored.archivedAt).toBeNull();
  });
});

describe("archive/restore: leads (own/all split)", () => {
  it("lets the owner archive their own lead, but not a colleague's", async () => {
    const org = await createTestOrganization();
    const ownerCtx = await createTestContext(org.id, "SALES", "owner");
    const otherCtx = await createTestContext(org.id, "SALES", "other");
    const leadStatusId = await getLeadStatusId(org.id);
    const { lead } = await leadService.createLead(ownerCtx, { leadStatusId });

    await expect(leadService.archiveLead(otherCtx, lead.id)).rejects.toThrow(ForbiddenError);

    const archived = await leadService.archiveLead(ownerCtx, lead.id);
    expect(archived.archivedAt).not.toBeNull();

    const restored = await leadService.restoreLead(ownerCtx, lead.id);
    expect(restored.archivedAt).toBeNull();
  });

  it("lets Management archive any lead via leads.archive.all", async () => {
    const org = await createTestOrganization();
    const salesCtx = await createTestContext(org.id, "SALES");
    const managementCtx = await createTestContext(org.id, "MANAGEMENT", "mgmt");
    const leadStatusId = await getLeadStatusId(org.id);
    const { lead } = await leadService.createLead(salesCtx, { leadStatusId });

    const archived = await leadService.archiveLead(managementCtx, lead.id);
    expect(archived.archivedAt).not.toBeNull();
  });

  it("excludes archived leads from the default list but includes them with includeArchived", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const leadStatusId = await getLeadStatusId(org.id);
    const { lead } = await leadService.createLead(ctx, { leadStatusId });
    await leadService.archiveLead(ctx, lead.id);

    const defaultList = await leadService.listLeads(ctx);
    expect(defaultList.map((l) => l.id)).not.toContain(lead.id);

    const withArchived = await leadService.listLeads(ctx, { includeArchived: true });
    expect(withArchived.map((l) => l.id)).toContain(lead.id);
  });
});

describe("archive/restore: deals (own/all split)", () => {
  it("lets the owner archive their own deal, but not a colleague's", async () => {
    const org = await createTestOrganization();
    const ownerCtx = await createTestContext(org.id, "SALES", "owner");
    const otherCtx = await createTestContext(org.id, "SALES", "other");
    const { company } = await companyService.createCompany(ownerCtx, { name: "Deal Archive Co" });
    const pipelineStageId = await getPipelineStageId(org.id);
    const deal = await dealService.createDeal(ownerCtx, {
      companyId: company.id,
      pipelineStageId,
    });

    await expect(dealService.archiveDeal(otherCtx, deal.id)).rejects.toThrow(ForbiddenError);

    const archived = await dealService.archiveDeal(ownerCtx, deal.id);
    expect(archived.archivedAt).not.toBeNull();

    const restored = await dealService.restoreDeal(ownerCtx, deal.id);
    expect(restored.archivedAt).toBeNull();
  });

  it("excludes archived deals from the default list but includes them with includeArchived", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const { company } = await companyService.createCompany(ctx, { name: "List Deal Co" });
    const pipelineStageId = await getPipelineStageId(org.id);
    const deal = await dealService.createDeal(ctx, { companyId: company.id, pipelineStageId });
    await dealService.archiveDeal(ctx, deal.id);

    const defaultList = await dealService.listDeals(ctx);
    expect(defaultList.map((d) => d.id)).not.toContain(deal.id);

    const withArchived = await dealService.listDeals(ctx, { includeArchived: true });
    expect(withArchived.map((d) => d.id)).toContain(deal.id);
  });
});
