import { describe, expect, it } from "vitest";
import { ForbiddenError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import * as activityService from "../src/services/activityService";
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

describe("mergeCompanies", () => {
  it("reassigns contacts/leads/deals/activities onto the winner, and archives the loser with mergedIntoId set", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const { company: loser } = await companyService.createCompany(ctx, { name: "Loser Co" });
    const { company: winner } = await companyService.createCompany(ctx, { name: "Winner Co" });
    const { contact } = await contactService.createContact(ctx, {
      firstName: "Dup",
      companyId: loser.id,
    });
    const leadStatusId = await getLeadStatusId(org.id);
    const { lead } = await leadService.createLead(ctx, {
      companyId: loser.id,
      leadStatusId,
    });
    const pipelineStageId = await getPipelineStageId(org.id);
    const deal = await dealService.createDeal(ctx, {
      companyId: loser.id,
      pipelineStageId,
    });
    const activity = await activityService.createActivity(ctx, {
      type: "NOTE",
      companyId: loser.id,
      subject: "Pre-merge note",
    });

    const merged = await companyService.mergeCompanies(ctx, loser.id, winner.id);
    expect(merged.archivedAt).not.toBeNull();
    expect(merged.mergedIntoId).toBe(winner.id);

    const movedContact = await adminDb.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(movedContact.companyId).toBe(winner.id);

    const movedLead = await adminDb.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(movedLead.companyId).toBe(winner.id);

    const movedDeal = await adminDb.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(movedDeal.companyId).toBe(winner.id);

    const movedActivity = await adminDb.activity.findUniqueOrThrow({ where: { id: activity.id } });
    expect(movedActivity.companyId).toBe(winner.id);

    // The winner's own timeline now shows the merged-in activity too.
    const winnerTimeline = await activityService.listActivitiesForCompany(ctx, winner.id);
    expect(winnerTimeline.map((a) => a.id)).toContain(activity.id);
  });

  it("rejects merging a company into itself, into an archived company, or merging an already-archived one", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const { company: a } = await companyService.createCompany(ctx, { name: "A Co" });
    const { company: b } = await companyService.createCompany(ctx, { name: "B Co" });

    await expect(companyService.mergeCompanies(ctx, a.id, a.id)).rejects.toThrow(
      ValidationError,
    );

    await companyService.archiveCompany(ctx, b.id);
    await expect(companyService.mergeCompanies(ctx, a.id, b.id)).rejects.toThrow(
      ValidationError,
    );
    await expect(companyService.mergeCompanies(ctx, b.id, a.id)).rejects.toThrow(
      ValidationError,
    );
  });

  it("rejects merging for a role without companies.merge", async () => {
    const org = await createTestOrganization();
    const mgmtCtx = await createTestContext(org.id, "MANAGEMENT");
    const financeCtx = await createTestContext(org.id, "FINANCE", "finance");
    const { company: a } = await companyService.createCompany(mgmtCtx, { name: "A Co" });
    const { company: b } = await companyService.createCompany(mgmtCtx, { name: "B Co" });

    await expect(companyService.mergeCompanies(financeCtx, a.id, b.id)).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe("mergeContacts", () => {
  it("reassigns leads/deals(-as-primary-contact)/activities onto the winner, and archives the loser", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const { contact: loser } = await contactService.createContact(ctx, { firstName: "Loser" });
    const { contact: winner } = await contactService.createContact(ctx, { firstName: "Winner" });
    const leadStatusId = await getLeadStatusId(org.id);
    const { lead } = await leadService.createLead(ctx, {
      contactId: loser.id,
      leadStatusId,
    });
    const { company } = await companyService.createCompany(ctx, { name: "Deal Co" });
    const pipelineStageId = await getPipelineStageId(org.id);
    const deal = await dealService.createDeal(ctx, {
      companyId: company.id,
      primaryContactId: loser.id,
      pipelineStageId,
    });
    const activity = await activityService.createActivity(ctx, {
      type: "CALL",
      contactId: loser.id,
    });

    const merged = await contactService.mergeContacts(ctx, loser.id, winner.id);
    expect(merged.archivedAt).not.toBeNull();
    expect(merged.mergedIntoId).toBe(winner.id);

    const movedLead = await adminDb.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(movedLead.contactId).toBe(winner.id);

    const movedDeal = await adminDb.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(movedDeal.primaryContactId).toBe(winner.id);

    const movedActivity = await adminDb.activity.findUniqueOrThrow({ where: { id: activity.id } });
    expect(movedActivity.contactId).toBe(winner.id);
  });

  it("rejects merging a contact into itself or an archived contact", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const { contact: a } = await contactService.createContact(ctx, { firstName: "A" });
    const { contact: b } = await contactService.createContact(ctx, { firstName: "B" });

    await expect(contactService.mergeContacts(ctx, a.id, a.id)).rejects.toThrow(
      ValidationError,
    );

    await contactService.archiveContact(ctx, b.id);
    await expect(contactService.mergeContacts(ctx, a.id, b.id)).rejects.toThrow(
      ValidationError,
    );
  });
});
