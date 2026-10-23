import { describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { ArchivedReadOnlyError, ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { flattenTags } from "../src/repositories/tags";
import * as companyService from "../src/services/companyService";
import * as contactService from "../src/services/contactService";
import { createCustomFieldDefinition } from "../src/services/customFieldService";
import * as dealService from "../src/services/dealService";
import * as exportService from "../src/services/exportService";
import * as leadService from "../src/services/leadService";
import { undoMerge } from "../src/services/mergeService";
import {
  MAX_TAGS_PER_RECORD,
  changeTags,
  createTag,
  deleteTag,
  getRecordTags,
  listTags,
  mergeTags,
  updateTag,
} from "../src/services/tagService";
import { createTestContext, createTestOrganization, getLeadStatusId, getPipelineStageId } from "./helpers/fixtures";

async function issuesOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ValidationError) return err.issues ?? [];
    throw err;
  }
  throw new Error("Expected the call to be rejected.");
}

describe("tags (FIG-798)", () => {
  it("Management creates, recolours and renames tags; names are unique regardless of case; others cannot", async () => {
    const org = await createTestOrganization();
    const management = await createTestContext(org.id, "MANAGEMENT");
    const sales = await createTestContext(org.id, "SALES");

    const vip = await createTag(management, { name: "  VIP   client ", colour: "ocean" });
    expect(vip).toMatchObject({ name: "VIP client", colour: "ocean" });
    expect((await issuesOf(createTag(management, { name: "vip CLIENT" })))[0]).toMatchObject({ code: "DUPLICATE_TAG" });
    expect((await issuesOf(createTag(management, { name: "" })))[0]).toMatchObject({ path: "name" });
    expect((await issuesOf(createTag(management, { name: "x".repeat(41) })))[0]).toMatchObject({ path: "name" });
    expect((await issuesOf(createTag(management, { name: "Odd", colour: "neon" })))[0]).toMatchObject({ path: "colour" });
    await expect(createTag(management, { name: "Hex", colour: "#2f6f4f" })).resolves.toMatchObject({ colour: "#2f6f4f" });

    const renamed = await updateTag(management, vip.id, { name: "Key account", colour: "plum" });
    expect(renamed).toMatchObject({ name: "Key account", colour: "plum" });
    const other = await createTag(management, { name: "Other" });
    expect((await issuesOf(updateTag(management, other.id, { name: "key ACCOUNT" })))[0]).toMatchObject({ code: "DUPLICATE_TAG" });
    // Re-saving its own name is fine.
    await expect(updateTag(management, other.id, { name: "OTHER" })).resolves.toMatchObject({ name: "OTHER" });

    await expect(createTag(sales, { name: "Nope" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(updateTag(sales, vip.id, { name: "Nope" })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listTags(sales)).map((t) => t.name)).toContain("Key account");
  });

  it("anyone who can edit a record adds and removes existing tags inline; a new tag on the fly needs tags.manage", async () => {
    const org = await createTestOrganization();
    const management = await createTestContext(org.id, "MANAGEMENT");
    const sales = await createTestContext(org.id, "SALES");
    const hot = await createTag(management, { name: "Hot" });
    const { contact } = await contactService.createContact(sales, { firstName: "Tagged" });

    const added = await changeTags(sales, "contact", contact.id, { addTagIds: [hot.id], addTagNames: ["hot", "HOT"] });
    expect(added.map((t) => t.name)).toEqual(["Hot"]); // by id and by name (any case) is one tag
    expect((await issuesOf(changeTags(sales, "contact", contact.id, { addTagNames: ["Brand new"] })))[0]).toMatchObject({ code: "TAG_CREATE_FORBIDDEN" });

    const created = await changeTags(management, "contact", contact.id, { addTagNames: ["Brand new"] });
    expect(created.map((t) => t.name)).toEqual(["Brand new", "Hot"]);

    const removed = await changeTags(sales, "contact", contact.id, { removeTagIds: [hot.id] });
    expect(removed.map((t) => t.name)).toEqual(["Brand new"]);

    const audit = await adminDb.auditEvent.findMany({ where: { organizationId: org.id, entityId: contact.id, action: "contact.tags_updated" }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => a.metadata)).toEqual([
      { added: ["Hot"], removed: [], created: [] },
      { added: ["Brand new"], removed: [], created: ["Brand new"] },
      { added: [], removed: ["Hot"], created: [] },
    ]);
  });

  it("tags leads, deals and companies too, with scope: own leads only, archived records read-only, unknown ids refused", async () => {
    const org = await createTestOrganization();
    const management = await createTestContext(org.id, "MANAGEMENT");
    const owner = await createTestContext(org.id, "SALES", "owner");
    const other = await createTestContext(org.id, "SALES", "other");
    const tag = await createTag(management, { name: "Q4" });

    const { lead } = await leadService.createLead(owner, { leadStatusId: await getLeadStatusId(org.id) });
    await expect(changeTags(owner, "lead", lead.id, { addTagIds: [tag.id] })).resolves.toHaveLength(1);
    await expect(changeTags(other, "lead", lead.id, { addTagIds: [tag.id] })).rejects.toBeInstanceOf(NotFoundError);
    await expect(getRecordTags(other, "lead", lead.id)).rejects.toBeInstanceOf(NotFoundError);

    const { company } = await companyService.createCompany(management, { name: "Tagged Co" });
    const deal = await dealService.createDeal(management, { companyId: company.id, pipelineStageId: await getPipelineStageId(org.id) });
    await changeTags(management, "company", company.id, { addTagIds: [tag.id] });
    await changeTags(management, "deal", deal.id, { addTagIds: [tag.id] });

    await leadService.archiveLead(management, lead.id);
    await expect(changeTags(owner, "lead", lead.id, { removeTagIds: [tag.id] })).rejects.toBeInstanceOf(ArchivedReadOnlyError);

    expect((await issuesOf(changeTags(management, "company", company.id, { addTagIds: ["00000000-0000-0000-0000-000000000000"] })))[0]).toMatchObject({ code: "UNKNOWN_TAG" });
  });

  it("caps the tags on one record", async () => {
    const org = await createTestOrganization();
    const management = await createTestContext(org.id, "MANAGEMENT");
    const { company } = await companyService.createCompany(management, { name: "Many Tags Co" });
    const names = Array.from({ length: MAX_TAGS_PER_RECORD }, (_, i) => `t${i}`);
    await changeTags(management, "company", company.id, { addTagNames: names });
    expect((await issuesOf(changeTags(management, "company", company.id, { addTagNames: ["one too many"] })))[0].message).toMatch(/at most 20/i);
    // Removing one and adding one in the same change stays within the cap.
    const tags = await getRecordTags(management, "company", company.id);
    await expect(changeTags(management, "company", company.id, { removeTagIds: [tags[0]!.id], addTagNames: ["swap"] })).resolves.toHaveLength(MAX_TAGS_PER_RECORD);
  });

  it("lists filter by tag, and rows carry their tags", async () => {
    const org = await createTestOrganization();
    const management = await createTestContext(org.id, "MANAGEMENT");
    const red = await createTag(management, { name: "Red" });
    const blue = await createTag(management, { name: "Blue" });
    const { contact: a } = await contactService.createContact(management, { firstName: "A" });
    const { contact: b } = await contactService.createContact(management, { firstName: "B" });
    await contactService.createContact(management, { firstName: "C" });
    await changeTags(management, "contact", a.id, { addTagIds: [red.id] });
    await changeTags(management, "contact", b.id, { addTagIds: [blue.id] });

    expect((await contactService.listContacts(management, { tagIds: [red.id] })).map((c) => c.id)).toEqual([a.id]);
    expect((await contactService.listContacts(management, { tagIds: [red.id, blue.id] })).map((c) => c.id).sort()).toEqual([a.id, b.id].sort());
    expect(await contactService.listContacts(management, { tagIds: ["00000000-0000-0000-0000-000000000000"] })).toEqual([]);

    const rows = await contactService.listContacts(management, {});
    const flat = flattenTags(rows.find((r) => r.id === a.id)!);
    expect(flat.tags).toEqual([{ id: red.id, name: "Red", colour: "forest" }]);
    expect("tagLinks" in flat).toBe(false);

    const { company } = await companyService.createCompany(management, { name: "Filter Co" });
    await changeTags(management, "company", company.id, { addTagIds: [blue.id] });
    expect((await companyService.listCompanies(management, { tagIds: [blue.id] })).map((c) => c.id)).toEqual([company.id]);
  });

  it("merges one tag into another once per record, then removes the source; delete removes its links", async () => {
    const org = await createTestOrganization();
    const management = await createTestContext(org.id, "MANAGEMENT");
    const from = await createTag(management, { name: "Old name" });
    const into = await createTag(management, { name: "New name" });
    const { contact: both } = await contactService.createContact(management, { firstName: "Both" });
    const { contact: onlyOld } = await contactService.createContact(management, { firstName: "OnlyOld" });
    await changeTags(management, "contact", both.id, { addTagIds: [from.id, into.id] });
    await changeTags(management, "contact", onlyOld.id, { addTagIds: [from.id] });

    const result = await mergeTags(management, from.id, into.id);
    expect(result.recordsMoved).toBe(1);
    expect((await getRecordTags(management, "contact", both.id)).map((t) => t.name)).toEqual(["New name"]);
    expect((await getRecordTags(management, "contact", onlyOld.id)).map((t) => t.name)).toEqual(["New name"]);
    expect(await adminDb.tag.count({ where: { id: from.id } })).toBe(0);
    await expect(mergeTags(management, into.id, into.id)).rejects.toThrow(/itself/);

    await deleteTag(management, into.id);
    expect(await adminDb.tagLink.count({ where: { organizationId: org.id } })).toBe(0);
    expect(await getRecordTags(management, "contact", both.id)).toEqual([]);
  });

  it("tags follow a company merge, a tag both already have is not duplicated, and undo gives it all back", async () => {
    const org = await createTestOrganization();
    const management = await createTestContext(org.id, "MANAGEMENT");
    const shared = await createTag(management, { name: "Shared" });
    const loserOnly = await createTag(management, { name: "Loser only" });
    const { company: loser } = await companyService.createCompany(management, { name: "Loser Tags Co" });
    const { company: winner } = await companyService.createCompany(management, { name: "Winner Tags Co" });
    await changeTags(management, "company", loser.id, { addTagIds: [shared.id, loserOnly.id] });
    await changeTags(management, "company", winner.id, { addTagIds: [shared.id] });

    const merged = await companyService.mergeCompanies(management, loser.id, winner.id);
    expect((await getRecordTags(management, "company", winner.id)).map((t) => t.name)).toEqual(["Loser only", "Shared"]);
    expect(await adminDb.tagLink.count({ where: { companyId: loser.id } })).toBe(0);

    await undoMerge(management, merged.mergeRecordId);
    expect((await getRecordTags(management, "company", loser.id)).map((t) => t.name)).toEqual(["Loser only", "Shared"]);
    expect((await getRecordTags(management, "company", winner.id)).map((t) => t.name)).toEqual(["Shared"]);
  });

  it("another organisation cannot use, see or change these tags", async () => {
    const orgA = await createTestOrganization();
    const orgB = await createTestOrganization();
    const a = await createTestContext(orgA.id, "MANAGEMENT");
    const b = await createTestContext(orgB.id, "MANAGEMENT");
    const tag = await createTag(a, { name: "Private" });
    const { company } = await companyService.createCompany(b, { name: "B Co" });

    expect((await listTags(b)).map((t) => t.name)).not.toContain("Private");
    expect((await issuesOf(changeTags(b, "company", company.id, { addTagIds: [tag.id] })))[0]).toMatchObject({ code: "UNKNOWN_TAG" });
    await expect(updateTag(b, tag.id, { name: "Hijack" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteTag(b, tag.id)).rejects.toBeInstanceOf(NotFoundError);
    // The same name is free to use in another organisation.
    await expect(createTag(b, { name: "Private" })).resolves.toBeDefined();
  });

  it("exports carry the tags and the custom field columns", async () => {
    const org = await createTestOrganization();
    const management = await createTestContext(org.id, "MANAGEMENT");
    await createCustomFieldDefinition(management, { entityType: "CONTACT", key: "region", label: "Region" });
    await createCustomFieldDefinition(management, { entityType: "CONTACT", key: "channels", label: "Channels", fieldType: "MULTISELECT", options: [{ value: "email", label: "Email" }, { value: "sms", label: "SMS" }] });
    const { contact } = await contactService.createContact(management, { firstName: "Exported", customFields: { region: "Coast", channels: ["email", "sms"] } });
    await changeTags(management, "contact", contact.id, { addTagNames: ["Beta", "Alpha"] });

    const csv = await exportService.exportContactsCsv(management, {});
    expect(csv.columns).toEqual(expect.arrayContaining(["tags", "cf:region", "cf:channels"]));
    const rows: Record<string, unknown>[] = [];
    for await (const row of csv.rows) rows.push(row);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tags: "Alpha; Beta", "cf:region": "Coast", "cf:channels": "email;sms" });

    const leads = await exportService.exportLeadsCsv(management, {});
    expect(leads.columns).toEqual(expect.arrayContaining(["tags", "q:budget_range"]));
  });
});
