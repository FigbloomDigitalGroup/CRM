import { describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { ForbiddenError, ValidationError } from "../src/auth/errors";
import {
  combineReasons,
  companyNameTokens,
  corporateEmailDomain,
  nameSimilarity,
  normalizeEmail,
  normalizePhone,
  phoneTail,
  registrableDomain,
} from "../src/lib/matching";
import * as activityService from "../src/services/activityService";
import * as companyService from "../src/services/companyService";
import * as contactService from "../src/services/contactService";
import * as dealService from "../src/services/dealService";
import { checkDuplicates, findDuplicates } from "../src/services/duplicateService";
import * as leadService from "../src/services/leadService";
import { listMergesFor, undoMerge } from "../src/services/mergeService";
import * as taskService from "../src/services/taskService";
import { createTestContext, createTestOrganization, getLeadStatusId, getPipelineStageId } from "./helpers/fixtures";

describe("matching: normal forms (FIG-1033, B2.04)", () => {
  it("compares Kenyan phone numbers in every common format as one number", () => {
    const forms = [
      "0712 345 678",
      "0712345678",
      "+254 712 345 678",
      "+254712345678",
      "254712345678",
      "712345678",
      "(0712) 345-678",
      "00254712345678",
      "0712.345.678",
    ];
    for (const form of forms) expect(normalizePhone(form), form).toBe("254712345678");
    expect(new Set(forms.map(phoneTail))).toEqual(new Set(["712345678"]));
    // 01xx numbers too (Safaricom and Airtel 01 ranges).
    expect(normalizePhone("0112 345 678")).toBe("254112345678");
    // A different number, a landline, a foreign number and junk.
    expect(normalizePhone("0722 345 678")).not.toBe(normalizePhone("0712 345 678"));
    expect(normalizePhone("020 2345678")).toBe("254202345678");
    expect(normalizePhone("+44 20 7946 0958")).toBe("442079460958");
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });

  it("ignores case and plus-addressing in email", () => {
    expect(normalizeEmail("Jane.Doe+Sales@Acme.CO.KE ")).toBe("jane.doe@acme.co.ke");
    expect(normalizeEmail("jane.doe@acme.co.ke")).toBe("jane.doe@acme.co.ke");
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail("+only@x.com")).toBeNull();
  });

  it("finds the registrable domain, including Kenyan second-level domains, and skips free mail", () => {
    expect(registrableDomain("https://www.shop.sarova.co.ke/about?x=1")).toBe("sarova.co.ke");
    expect(registrableDomain("sarova.co.ke")).toBe("sarova.co.ke");
    expect(registrableDomain("HTTP://Example.com:8080/a")).toBe("example.com");
    expect(registrableDomain("localhost")).toBeNull();
    expect(corporateEmailDomain("a@mail.sarova.co.ke")).toBe("sarova.co.ke");
    expect(corporateEmailDomain("someone@gmail.com")).toBeNull();
  });

  it("compares company names without legal suffixes, punctuation or word order, and tolerates typos", () => {
    expect(companyNameTokens("Sarova Hotels Ltd.")).toEqual(["sarova", "hotels"]);
    expect(nameSimilarity("Sarova Hotels Ltd", "SAROVA HOTELS LIMITED")).toBe(1);
    expect(nameSimilarity("Hotels Sarova", "Sarova Hotels")).toBeGreaterThan(0.95);
    expect(nameSimilarity("Sarova Hotels", "Sarova Hotles")).toBeGreaterThan(0.7);
    expect(nameSimilarity("Sarova Hotels", "Kenya Power")).toBeLessThan(0.3);
    expect(nameSimilarity("", "Anything")).toBe(0);
  });

  it("combines reasons so several weak signals strengthen each other, and bands the result", () => {
    expect(combineReasons([{ type: "EMAIL", detail: "", weight: 0.95 }]).confidence).toBe("high");
    expect(combineReasons([{ type: "DOMAIN", detail: "", weight: 0.55 }]).confidence).toBe("low");
    expect(combineReasons([{ type: "DOMAIN", detail: "", weight: 0.55 }, { type: "SIMILAR_NAME", detail: "", weight: 0.6 }]).confidence).toBe("medium");
  });
});

describe("duplicate detection service (FIG-1033, B2.04)", () => {
  it("warns about a company with the same phone in a different format, and never blocks the create", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const { company: existing } = await companyService.createCompany(ctx, { name: "Sarova Hotels Ltd", phone: "+254 712 345 678", website: "https://www.sarova.co.ke" });

    const created = await companyService.createCompany(ctx, { name: "Sarova Hotels", phone: "0712-345-678", email: "info@sarova.co.ke" });
    expect(created.company.id).not.toBe(existing.id); // created anyway
    const hit = created.duplicates.find((d) => d.id === existing.id);
    expect(hit).toBeDefined();
    expect(hit!.reasons.map((r) => r.type).sort()).toEqual(["DOMAIN", "NAME", "PHONE"]);
    expect(hit!.confidence).toBe("high");
    expect(created.hiddenDuplicates).toBe(0);
  });

  it("matches contacts by email with case and plus-addressing ignored, and by phone formats", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const { contact: first } = await contactService.createContact(ctx, { firstName: "Wanjiru", lastName: "Kamau", email: "wanjiru@acme.co.ke", phone: "0722 111 222" });

    const second = await contactService.createContact(ctx, { firstName: "W", email: "Wanjiru+crm@ACME.co.ke" });
    expect(second.duplicates.map((d) => d.id)).toContain(first.id);
    expect(second.duplicates.find((d) => d.id === first.id)!.reasons[0]!.type).toBe("EMAIL");

    const third = await contactService.createContact(ctx, { firstName: "Someone", phone: "+254722111222" });
    expect(third.duplicates.map((d) => d.id)).toContain(first.id);

    const unrelated = await contactService.createContact(ctx, { firstName: "Other", email: "other@else.com", phone: "0733 000 111" });
    expect(unrelated.duplicates).toEqual([]);
  });

  it("flags the same person name at the same company, with lower confidence than a shared email", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const { company } = await companyService.createCompany(ctx, { name: "Name Match Co" });
    const { contact } = await contactService.createContact(ctx, { firstName: "Juma", lastName: "Otieno", companyId: company.id });
    const res = await findDuplicates(ctx, { entity: "contact", firstName: "JUMA", lastName: "otieno", companyId: company.id });
    const hit = res.candidates.find((c) => c.id === contact.id);
    expect(hit?.reasons[0]?.type).toBe("NAME");
    expect(hit?.confidence).not.toBe("high");
  });

  it("offers an open lead for the same company as a duplicate of a new lead", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const { company } = await companyService.createCompany(ctx, { name: "Lead Dup Co" });
    const leadStatusId = await getLeadStatusId(org.id);
    const { lead: first } = await leadService.createLead(ctx, { leadStatusId, companyId: company.id });
    const second = await leadService.createLead(ctx, { leadStatusId, companyId: company.id });
    expect(second.duplicates.map((d) => d.id)).toContain(first.id);
    expect(second.duplicates.find((d) => d.id === first.id)!.entityType).toBe("lead");
    expect(second.lead.id).not.toBe(first.id);
  });

  it("shows only candidates the caller may open and counts the rest", async () => {
    const org = await createTestOrganization();
    const management = await createTestContext(org.id, "MANAGEMENT");
    const salesA = await createTestContext(org.id, "SALES", "sales.a");
    const salesB = await createTestContext(org.id, "SALES", "sales.b");
    const { company } = await companyService.createCompany(management, { name: "Shared Account Co" });
    const leadStatusId = await getLeadStatusId(org.id);
    const { lead: mine } = await leadService.createLead(salesA, { leadStatusId, companyId: company.id });
    const { lead: theirs } = await leadService.createLead(salesB, { leadStatusId, companyId: company.id });

    const asA = await findDuplicates(salesA, { entity: "lead", companyId: company.id });
    const leadIds = asA.candidates.filter((c) => c.entityType === "lead").map((c) => c.id);
    expect(leadIds).toContain(mine.id);
    expect(leadIds).not.toContain(theirs.id);
    expect(asA.hiddenCount).toBe(1);
    // A hidden candidate is counted, never described.
    expect(JSON.stringify(asA)).not.toContain(theirs.id);

    const asManagement = await findDuplicates(management, { entity: "lead", companyId: company.id });
    expect(asManagement.hiddenCount).toBe(0);
    expect(asManagement.candidates.filter((c) => c.entityType === "lead")).toHaveLength(2);
  });

  it("never reports records from another organisation, and excludes the record being edited", async () => {
    const orgA = await createTestOrganization();
    const orgB = await createTestOrganization();
    const a = await createTestContext(orgA.id, "MANAGEMENT");
    const b = await createTestContext(orgB.id, "MANAGEMENT");
    await companyService.createCompany(b, { name: "Cross Tenant Co", phone: "0700 123 456", email: "x@cross.co.ke" });
    const { company: own } = await companyService.createCompany(a, { name: "Cross Tenant Co", phone: "0700 123 456" });

    const res = await findDuplicates(a, { entity: "company", companyName: "Cross Tenant Co", phone: "0700123456", email: "x@cross.co.ke", excludeId: own.id });
    expect(res.candidates).toEqual([]);
    expect(res.hiddenCount).toBe(0);
  });

  it("the check endpoint needs the permission to create that kind of record", async () => {
    const org = await createTestOrganization();
    const delivery = await createTestContext(org.id, "DELIVERY");
    await expect(checkDuplicates(delivery, { entity: "company", companyName: "Anything" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("merge with field choices and undo (FIG-1033, B2.04)", () => {
  async function companiesWithWork() {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const { company: loser } = await companyService.createCompany(ctx, {
      name: "Acme Ltd",
      phone: "0711 000 111",
      industry: "Hospitality",
      location: "Nairobi",
    });
    const { company: winner } = await companyService.createCompany(ctx, { name: "Acme Limited", website: "https://acme.co.ke" });
    const { contact } = await contactService.createContact(ctx, { firstName: "Moved", companyId: loser.id });
    const leadStatusId = await getLeadStatusId(org.id);
    const { lead } = await leadService.createLead(ctx, { leadStatusId, companyId: loser.id });
    const deal = await dealService.createDeal(ctx, { companyId: loser.id, pipelineStageId: await getPipelineStageId(org.id) });
    const activity = await activityService.createActivity(ctx, { type: "NOTE", subject: "note", companyId: loser.id });
    const task = await taskService.createTask(ctx, { title: "follow up", companyId: loser.id });
    return { org, ctx, loser, winner, contact, lead, deal, activity, task };
  }

  it("keeps the winner's data and fills only the blanks when no choices are given", async () => {
    const { ctx, loser, winner } = await companiesWithWork();
    const merged = await companyService.mergeCompanies(ctx, loser.id, winner.id);
    expect(merged.mergedIntoId).toBe(winner.id);
    expect(merged.archivedAt).not.toBeNull();
    expect(merged.archiveReason).toMatch(/merged/i);
    expect(merged.undoExpiresAt.getTime()).toBeGreaterThan(Date.now());

    const after = await adminDb.company.findUniqueOrThrow({ where: { id: winner.id } });
    expect(after.name).toBe("Acme Limited"); // winner kept
    expect(after.phone).toBe("0711 000 111"); // blank filled from the loser
    expect(after.industry).toBe("Hospitality");
    expect(after.website).toBe("https://acme.co.ke");
  });

  it("applies field-by-field choices and rejects fields that cannot be chosen", async () => {
    const { ctx, loser, winner } = await companiesWithWork();
    await expect(companyService.mergeCompanies(ctx, loser.id, winner.id, { fields: { bogus: "loser" } })).rejects.toBeInstanceOf(ValidationError);

    await companyService.mergeCompanies(ctx, loser.id, winner.id, { fields: { name: "loser" } });
    const after = await adminDb.company.findUniqueOrThrow({ where: { id: winner.id } });
    expect(after.name).toBe("Acme Ltd"); // chosen from the loser
    expect(after.phone).toBeNull(); // explicit choices change only what was chosen: no blank-fill
  });

  it("moves everything, leaves nothing behind, and undo puts it all back", async () => {
    const { org, ctx, loser, winner, contact, lead, deal, activity, task } = await companiesWithWork();
    const merged = await companyService.mergeCompanies(ctx, loser.id, winner.id, { fields: { phone: "loser" } });

    const orphan = {
      contacts: await adminDb.contact.count({ where: { companyId: loser.id } }),
      leads: await adminDb.lead.count({ where: { companyId: loser.id } }),
      deals: await adminDb.deal.count({ where: { companyId: loser.id } }),
      activities: await adminDb.activity.count({ where: { companyId: loser.id } }),
      tasks: await adminDb.task.count({ where: { companyId: loser.id } }),
    };
    expect(orphan).toEqual({ contacts: 0, leads: 0, deals: 0, activities: 0, tasks: 0 });
    expect((await adminDb.contact.findUniqueOrThrow({ where: { id: contact.id } })).companyId).toBe(winner.id);

    const history = await listMergesFor(ctx, "Company", loser.id);
    expect(history[0]).toMatchObject({ id: merged.mergeRecordId, canUndo: true });

    const restoredLoser = await undoMerge(ctx, merged.mergeRecordId);
    expect(restoredLoser).toMatchObject({ archivedAt: null, mergedIntoId: null, archiveReason: null });
    expect((await adminDb.contact.findUniqueOrThrow({ where: { id: contact.id } })).companyId).toBe(loser.id);
    expect((await adminDb.lead.findUniqueOrThrow({ where: { id: lead.id } })).companyId).toBe(loser.id);
    expect((await adminDb.deal.findUniqueOrThrow({ where: { id: deal.id } })).companyId).toBe(loser.id);
    expect((await adminDb.activity.findUniqueOrThrow({ where: { id: activity.id } })).companyId).toBe(loser.id);
    expect((await adminDb.task.findUniqueOrThrow({ where: { id: task.id } })).companyId).toBe(loser.id);
    expect((await adminDb.company.findUniqueOrThrow({ where: { id: winner.id } })).phone).toBeNull(); // the winner's merged field is back

    await expect(undoMerge(ctx, merged.mergeRecordId)).rejects.toThrow(/already been undone/);
    const audit = await adminDb.auditEvent.findMany({ where: { organizationId: org.id, entityId: loser.id }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["company.merged", "company.merge_undone"]));
  });

  it("an undo does not overwrite a winner field someone edited after the merge", async () => {
    const { ctx, loser, winner } = await companiesWithWork();
    const merged = await companyService.mergeCompanies(ctx, loser.id, winner.id, { fields: { phone: "loser" } });
    await companyService.updateCompany(ctx, winner.id, { phone: "0799 999 999" });
    await undoMerge(ctx, merged.mergeRecordId);
    expect((await adminDb.company.findUniqueOrThrow({ where: { id: winner.id } })).phone).toBe("0799 999 999");
  });

  it("refuses an undo after the window, and when the surviving record has since been archived", async () => {
    const { org, ctx, loser, winner } = await companiesWithWork();
    const merged = await companyService.mergeCompanies(ctx, loser.id, winner.id);
    await adminDb.mergeRecord.update({ where: { id: merged.mergeRecordId }, data: { undoExpiresAt: new Date(Date.now() - 1000) } });
    await expect(undoMerge(ctx, merged.mergeRecordId)).rejects.toThrow(/time to undo/);

    const second = await companiesWithWork();
    const m2 = await companyService.mergeCompanies(second.ctx, second.loser.id, second.winner.id);
    await companyService.archiveCompany(second.ctx, second.winner.id);
    await expect(undoMerge(second.ctx, m2.mergeRecordId)).rejects.toThrow(/archived/);
    void org;
  });

  it("merges contacts the same way, and only people who may merge can undo", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const delivery = await createTestContext(org.id, "DELIVERY");
    const { contact: loser } = await contactService.createContact(ctx, { firstName: "Dup", phone: "0712 000 000" });
    const { contact: winner } = await contactService.createContact(ctx, { firstName: "Dup", lastName: "Person" });
    const task = await taskService.createTask(ctx, { title: "call", contactId: loser.id });

    const merged = await contactService.mergeContacts(ctx, loser.id, winner.id, { fields: { phone: "loser" } });
    expect((await adminDb.task.findUniqueOrThrow({ where: { id: task.id } })).contactId).toBe(winner.id);
    expect((await adminDb.contact.findUniqueOrThrow({ where: { id: winner.id } })).phone).toBe("0712 000 000");

    await expect(undoMerge(delivery, merged.mergeRecordId)).rejects.toBeInstanceOf(ForbiddenError);
    await undoMerge(ctx, merged.mergeRecordId);
    expect((await adminDb.task.findUniqueOrThrow({ where: { id: task.id } })).contactId).toBe(loser.id);
  });

  it("merge records are tenant-isolated: another organisation cannot read or undo them", async () => {
    const one = await companiesWithWork();
    const other = await createTestOrganization();
    const otherCtx = await createTestContext(other.id, "MANAGEMENT");
    const merged = await companyService.mergeCompanies(one.ctx, one.loser.id, one.winner.id);
    await expect(undoMerge(otherCtx, merged.mergeRecordId)).rejects.toThrow(/not found/i);
  });
});
