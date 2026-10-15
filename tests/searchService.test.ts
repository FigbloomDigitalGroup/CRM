import { describe, expect, it } from "vitest";
import { archiveCompany, createCompany } from "../src/services/companyService";
import { createContact } from "../src/services/contactService";
import { createDeal } from "../src/services/dealService";
import { createLead } from "../src/services/leadService";
import { globalSearch } from "../src/services/searchService";
import { createTask } from "../src/services/taskService";
import {
  createTestContext,
  createTestOrganization,
  getLeadStatusId,
  getPipelineStageId,
} from "./helpers/fixtures";

describe("searchService.globalSearch", () => {
  it("returns nothing for a query shorter than the minimum length, without throwing", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");

    const results = await globalSearch(ctx, "a");
    expect(results).toEqual({
      companies: [],
      contacts: [],
      leads: [],
      deals: [],
      tasks: [],
    });
  });

  it("never surfaces another organization's rows, even for an identical, matching name across all five entities", async () => {
    const orgA = await createTestOrganization();
    const orgB = await createTestOrganization();
    const ctxA = await createTestContext(orgA.id, "MANAGEMENT", "mgmt.a");
    const ctxB = await createTestContext(orgB.id, "MANAGEMENT", "mgmt.b");
    const leadStatusIdB = await getLeadStatusId(orgB.id);
    const pipelineStageIdB = await getPipelineStageId(orgB.id);

    // Org A: nothing shares the "Crosstenant" needle.
    await createCompany(ctxA, { name: "Unrelated Co" });

    // Org B: every entity type carries the same needle in its searchable fields.
    const { company: companyB } = await createCompany(ctxB, {
      name: "Crosstenant Co",
    });
    await createContact(ctxB, {
      firstName: "Crosstenant",
      lastName: "Person",
      companyId: companyB.id,
    });
    await createLead(ctxB, { leadStatusId: leadStatusIdB, companyId: companyB.id });
    await createDeal(ctxB, {
      companyId: companyB.id,
      pipelineStageId: pipelineStageIdB,
    });
    await createTask(ctxB, { title: "Crosstenant task", companyId: companyB.id });

    const resultsFromA = await globalSearch(ctxA, "Crosstenant");
    expect(resultsFromA).toEqual({
      companies: [],
      contacts: [],
      leads: [],
      deals: [],
      tasks: [],
    });

    const resultsFromB = await globalSearch(ctxB, "Crosstenant");
    expect(resultsFromB.companies).toHaveLength(1);
    expect(resultsFromB.contacts).toHaveLength(1);
    expect(resultsFromB.leads).toHaveLength(1);
    expect(resultsFromB.deals).toHaveLength(1);
    expect(resultsFromB.tasks).toHaveLength(1);
  });

  it("a Sales user only sees their own leads and deals in results, never a colleague's", async () => {
    const org = await createTestOrganization();
    const ownerCtx = await createTestContext(org.id, "SALES", "owner");
    const otherCtx = await createTestContext(org.id, "SALES", "other");
    const leadStatusId = await getLeadStatusId(org.id);
    const pipelineStageId = await getPipelineStageId(org.id);

    const { company } = await createCompany(ownerCtx, { name: "Owned Search Co" });
    await createLead(ownerCtx, { leadStatusId, companyId: company.id });
    await createDeal(ownerCtx, { companyId: company.id, pipelineStageId });

    const ownerResults = await globalSearch(ownerCtx, "Owned Search Co");
    expect(ownerResults.leads).toHaveLength(1);
    expect(ownerResults.deals).toHaveLength(1);

    const otherResults = await globalSearch(otherCtx, "Owned Search Co");
    expect(otherResults.leads).toHaveLength(0);
    expect(otherResults.deals).toHaveLength(0);
    // Companies are a flat `companies.view` permission, not own/all, so both
    // Sales users can still find the company record itself.
    expect(otherResults.companies).toHaveLength(1);
  });

  it("a role with no view permission for an entity gets an empty array for that group instead of an error", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "RESTRICTED_TECHNICAL");
    const managementCtx = await createTestContext(org.id, "MANAGEMENT", "mgmt");
    const leadStatusId = await getLeadStatusId(org.id);
    const pipelineStageId = await getPipelineStageId(org.id);

    const { company } = await createCompany(managementCtx, {
      name: "Restricted View Co",
    });
    await createLead(managementCtx, { leadStatusId, companyId: company.id });
    await createDeal(managementCtx, { companyId: company.id, pipelineStageId });

    const results = await globalSearch(ctx, "Restricted View Co");
    expect(results).toEqual({
      companies: [],
      contacts: [],
      leads: [],
      deals: [],
      tasks: [],
    });
  });

  it("a Restricted Technical user (tasks.view.own only) only sees their own tasks, not a colleague's", async () => {
    const org = await createTestOrganization();
    const ownerCtx = await createTestContext(org.id, "RESTRICTED_TECHNICAL", "owner");
    const otherCtx = await createTestContext(org.id, "RESTRICTED_TECHNICAL", "other");

    await createTask(ownerCtx, { title: "My Own Search Task" });

    const ownerResults = await globalSearch(ownerCtx, "My Own Search Task");
    expect(ownerResults.tasks).toHaveLength(1);

    const otherResults = await globalSearch(otherCtx, "My Own Search Task");
    expect(otherResults.tasks).toHaveLength(0);
  });

  it("excludes archived companies by default", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const { company } = await createCompany(ctx, { name: "Archived Search Co" });
    await archiveCompany(ctx, company.id);

    const results = await globalSearch(ctx, "Archived Search Co");
    expect(results.companies).toHaveLength(0);
  });

  it("matches companies by email/phone and contacts by company name, not just by their own name", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    await createCompany(ctx, {
      name: "Unrelated Name Co",
      email: "unique-reachme@example.test",
    });
    const { company } = await createCompany(ctx, { name: "Parent Co Searchable" });
    await createContact(ctx, { firstName: "Jamie", companyId: company.id });

    const byEmail = await globalSearch(ctx, "unique-reachme");
    expect(byEmail.companies).toHaveLength(1);

    const byCompanyName = await globalSearch(ctx, "Parent Co Searchable");
    expect(byCompanyName.contacts).toHaveLength(1);
    expect(byCompanyName.contacts[0]?.label).toBe("Jamie");
  });

  it("matches tasks by title", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    await createTask(ctx, { title: "Follow up on searchable quote" });

    const results = await globalSearch(ctx, "searchable quote");
    expect(results.tasks).toHaveLength(1);
    expect(results.tasks[0]?.label).toBe("Follow up on searchable quote");
  });
});
