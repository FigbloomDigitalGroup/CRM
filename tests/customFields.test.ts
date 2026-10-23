import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { applyValues, missingRequired, schemaForField, type FieldDefinition } from "../src/lib/customFields";
import * as companyService from "../src/services/companyService";
import * as contactService from "../src/services/contactService";
import * as dealService from "../src/services/dealService";
import {
  buildCustomFieldWhere,
  countFieldUsage,
  createCustomFieldDefinition,
  listCustomFieldDefinitions,
  updateCustomFieldDefinition,
} from "../src/services/customFieldService";
import * as leadService from "../src/services/leadService";
import { createTestContext, createTestOrganization, getLeadStatusId, getPipelineStageId } from "./helpers/fixtures";

const def = (over: Partial<FieldDefinition>): FieldDefinition => ({
  key: "f",
  label: "F",
  fieldType: "TEXT",
  options: undefined,
  required: false,
  requiredOnQualify: false,
  section: "GENERAL",
  serviceId: null,
  isActive: true,
  ...over,
});

describe("custom field values: types (FIG-803)", () => {
  it("coerces and validates each field type, and treats an empty value as no answer", () => {
    const num = schemaForField(def({ fieldType: "NUMBER" }));
    expect(num.parse("42.5")).toBe(42.5);
    expect(num.parse(7)).toBe(7);
    expect(num.parse("")).toBeNull();
    expect(num.safeParse("abc").success).toBe(false);

    const date = schemaForField(def({ fieldType: "DATE" }));
    expect(date.parse("2026-11-30")).toBe("2026-11-30");
    expect(date.parse("2026-11-30T10:00:00Z")).toBe("2026-11-30");
    expect(date.safeParse("30/11/2026").success).toBe(false);
    expect(date.safeParse("2026-13-45").success).toBe(false);

    const bool = schemaForField(def({ fieldType: "BOOLEAN" }));
    expect(bool.parse("true")).toBe(true);
    expect(bool.parse(false)).toBe(false);
    expect(bool.safeParse("yes").success).toBe(false);

    const select = schemaForField(def({ fieldType: "SELECT", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] }));
    expect(select.parse("a")).toBe("a");
    expect(select.safeParse("c").success).toBe(false);

    const multi = schemaForField(def({ fieldType: "MULTISELECT", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] }));
    expect(multi.parse(["a", "a", "b"])).toEqual(["a", "b"]);
    expect(multi.parse([])).toBeNull();
    expect(multi.safeParse(["z"]).success).toBe(false);

    const text = schemaForField(def({}));
    expect(text.parse("  hello  ")).toBe("hello");
    expect(text.safeParse("x".repeat(2001)).success).toBe(false);
  });

  it("applies values onto stored ones, clears with null, reports bad values by path, and rejects unknown keys", () => {
    const defs = [def({ key: "a", fieldType: "NUMBER" }), def({ key: "b" })];
    const result = applyValues(defs, { a: "5", b: null, c: "x" }, { existing: { b: "old", keep: 1 }, unknownKeys: "reject" });
    expect(result.values).toEqual({ a: 5, keep: 1 });
    expect(result.changes).toEqual({ a: { before: null, after: 5 }, b: { before: "old", after: null } });
    expect(result.issues).toEqual([expect.objectContaining({ path: "customFields.c", code: "UNKNOWN_FIELD" })]);

    const bad = applyValues(defs, { a: "five" }, { existing: {}, unknownKeys: "reject" });
    expect(bad.issues[0]).toMatchObject({ path: "customFields.a", code: "INVALID_VALUE" });
    expect(bad.values).toEqual({});

    const keep = applyValues(defs, { utm: { source: "x" } }, { existing: {}, unknownKeys: "keep" });
    expect(keep.values).toEqual({ utm: { source: "x" } });
  });

  it("reports required fields for saving and for qualifying", () => {
    const defs = [def({ key: "a", required: true }), def({ key: "b", requiredOnQualify: true }), def({ key: "c", required: true, isActive: false })];
    expect(missingRequired(defs, {}, "save").map((i) => i.path)).toEqual(["customFields.a"]);
    expect(missingRequired(defs, {}, "qualify").map((i) => i.code)).toEqual(["REQUIRED_ON_QUALIFY", "REQUIRED_ON_QUALIFY"]);
    expect(missingRequired(defs, { a: "x", b: "y" }, "qualify")).toEqual([]);
  });
});

/** The messages of the field-level issues a rejected write carries. */
async function issuesOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ValidationError) return [err.message, ...(err.issues ?? []).map((i) => i.message)].join(" | ");
    throw err;
  }
  throw new Error("Expected the call to be rejected.");
}

describe("custom field definitions (FIG-803)", () => {
  it("Management creates, edits and retires fields; others can read the fields of record types they use but not change them", async () => {
    const org = await createTestOrganization();
    const management = await createTestContext(org.id, "MANAGEMENT");
    const sales = await createTestContext(org.id, "SALES");
    const delivery = await createTestContext(org.id, "DELIVERY");

    const field = await createCustomFieldDefinition(management, { entityType: "CONTACT", key: "birthday", label: "Birthday", fieldType: "DATE" });
    expect(field).toMatchObject({ key: "birthday", fieldType: "DATE", section: "GENERAL", isActive: true });

    await expect(createCustomFieldDefinition(sales, { entityType: "CONTACT", key: "x", label: "X" })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listCustomFieldDefinitions(sales, { entityType: "CONTACT" })).map((d) => d.key)).toContain("birthday");
    // Delivery works deals, not leads: it can read deal fields and is refused lead fields.
    await expect(listCustomFieldDefinitions(delivery, { entityType: "DEAL" })).resolves.toBeDefined();
    await expect(listCustomFieldDefinitions(delivery, { entityType: "LEAD" })).rejects.toBeInstanceOf(ForbiddenError);

    const renamed = await updateCustomFieldDefinition(management, field.id, { label: "Date of birth", required: true });
    expect(renamed).toMatchObject({ label: "Date of birth", required: true });
    await expect(updateCustomFieldDefinition(sales, field.id, { label: "Nope" })).rejects.toBeInstanceOf(ForbiddenError);

    await updateCustomFieldDefinition(management, field.id, { isActive: false });
    expect((await listCustomFieldDefinitions(sales, { entityType: "CONTACT" })).map((d) => d.key)).not.toContain("birthday");
    expect((await listCustomFieldDefinitions(management, { entityType: "CONTACT", includeInactive: true })).map((d) => d.key)).toContain("birthday");

    const audit = await adminDb.auditEvent.findMany({ where: { organizationId: org.id, entityId: field.id }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => a.action)).toEqual(["custom_field.created", "custom_field.updated", "custom_field.deactivated"]);
  });

  it("validates keys, choice options, duplicate keys and qualification-only settings", async () => {
    const org = await createTestOrganization();
    const management = await createTestContext(org.id, "MANAGEMENT");

    expect(await issuesOf(createCustomFieldDefinition(management, { entityType: "DEAL", key: "Bad Key", label: "X" }))).toMatch(/lower-case/);
    expect(await issuesOf(createCustomFieldDefinition(management, { entityType: "DEAL", key: "pick", label: "Pick", fieldType: "SELECT" }))).toMatch(/at least one option/);
    expect(
      await issuesOf(
        createCustomFieldDefinition(management, { entityType: "DEAL", key: "pick", label: "Pick", fieldType: "SELECT", options: [{ value: "a", label: "A" }, { value: "a", label: "Again" }] }),
      ),
    ).toMatch(/Duplicate option/);
    expect(await issuesOf(createCustomFieldDefinition(management, { entityType: "DEAL", key: "q", label: "Q", requiredOnQualify: true }))).toMatch(/qualification question/);
    expect(await issuesOf(createCustomFieldDefinition(management, { entityType: "CONTACT", key: "q", label: "Q", section: "QUALIFICATION" }))).toMatch(/Only leads/);

    await createCustomFieldDefinition(management, { entityType: "DEAL", key: "region", label: "Region" });
    expect(await issuesOf(createCustomFieldDefinition(management, { entityType: "DEAL", key: "region", label: "Again" }))).toMatch(/already exists/);
    // The same key on another record type is fine.
    await expect(createCustomFieldDefinition(management, { entityType: "CONTACT", key: "region", label: "Region" })).resolves.toBeDefined();
    await expect(updateCustomFieldDefinition(management, "00000000-0000-0000-0000-000000000000", { label: "x" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("another organisation never sees or changes them", async () => {
    const orgA = await createTestOrganization();
    const orgB = await createTestOrganization();
    const a = await createTestContext(orgA.id, "MANAGEMENT");
    const b = await createTestContext(orgB.id, "MANAGEMENT");
    const field = await createCustomFieldDefinition(a, { entityType: "COMPANY", key: "segment", label: "Segment" });
    expect((await listCustomFieldDefinitions(b, { entityType: "COMPANY" })).map((d) => d.key)).not.toContain("segment");
    await expect(updateCustomFieldDefinition(b, field.id, { label: "Hijacked" })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("custom field values on records (FIG-803)", () => {
  async function setup() {
    const org = await createTestOrganization();
    const management = await createTestContext(org.id, "MANAGEMENT");
    await createCustomFieldDefinition(management, { entityType: "CONTACT", key: "birthday", label: "Birthday", fieldType: "DATE" });
    await createCustomFieldDefinition(management, { entityType: "CONTACT", key: "vip", label: "VIP", fieldType: "BOOLEAN" });
    await createCustomFieldDefinition(management, { entityType: "CONTACT", key: "channels", label: "Channels", fieldType: "MULTISELECT", options: [{ value: "email", label: "Email" }, { value: "sms", label: "SMS" }] });
    return { org, management };
  }

  it("stores validated values on create and update, clears with null, and audits the change", async () => {
    const { org, management } = await setup();
    const { contact } = await contactService.createContact(management, { firstName: "Cf", customFields: { birthday: "1990-05-01", vip: "true", channels: ["email", "email"] } });
    const stored = await adminDb.contact.findUniqueOrThrow({ where: { id: contact.id } });
    expect(stored.customFields).toEqual({ birthday: "1990-05-01", vip: true, channels: ["email"] });

    await contactService.updateContact(management, contact.id, { customFields: { vip: false, birthday: null } });
    expect((await adminDb.contact.findUniqueOrThrow({ where: { id: contact.id } })).customFields).toEqual({ vip: false, channels: ["email"] });

    const audit = await adminDb.auditEvent.findMany({ where: { organizationId: org.id, entityId: contact.id, action: "contact.custom_fields_updated" }, orderBy: { createdAt: "asc" } });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.previousValue).toEqual({ vip: true, birthday: "1990-05-01" });
    expect(audit[0]!.newValue).toEqual({ vip: false, birthday: null });
  });

  it("rejects bad values and unknown fields with the field path, and nothing is saved", async () => {
    const { management } = await setup();
    let err: unknown;
    try {
      await contactService.createContact(management, { firstName: "Bad", customFields: { birthday: "tomorrow", nope: 1 } });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).issues?.map((i) => i.path).sort()).toEqual(["customFields.birthday", "customFields.nope"]);
  });

  it("a required field must be given on create, but an older record can still be edited and a required field cannot be cleared", async () => {
    const { management } = await setup();
    const { contact: older } = await contactService.createContact(management, { firstName: "Older" });
    const required = await createCustomFieldDefinition(management, { entityType: "CONTACT", key: "region", label: "Region", required: true });
    expect(required.required).toBe(true);

    await expect(contactService.createContact(management, { firstName: "New" })).rejects.toThrow(/Some custom fields/);
    await expect(contactService.createContact(management, { firstName: "New", customFields: { region: "Coast" } })).resolves.toBeDefined();

    // The older record has no region yet, and can still be edited.
    await expect(contactService.updateContact(management, older.id, { notes: "still editable" })).resolves.toBeDefined();
    await contactService.updateContact(management, older.id, { customFields: { region: "Rift" } });
    await expect(contactService.updateContact(management, older.id, { customFields: { region: null } })).rejects.toThrow(/Some custom fields/);
  });

  it("a retired field is refused on new values but its stored value stays", async () => {
    const { management } = await setup();
    const { contact } = await contactService.createContact(management, { firstName: "Keep", customFields: { vip: true } });
    const vip = (await listCustomFieldDefinitions(management, { entityType: "CONTACT" })).find((d) => d.key === "vip")!;
    expect((await countFieldUsage(management, vip.id)).records).toBe(1);
    await updateCustomFieldDefinition(management, vip.id, { isActive: false });
    await expect(contactService.updateContact(management, contact.id, { customFields: { vip: false } })).rejects.toThrow(/Some custom fields/);
    expect((await adminDb.contact.findUniqueOrThrow({ where: { id: contact.id } })).customFields).toEqual({ vip: true });
  });

  it("works on companies, deals and leads too", async () => {
    const org = await createTestOrganization();
    const management = await createTestContext(org.id, "MANAGEMENT");
    for (const entityType of ["COMPANY", "DEAL", "LEAD"] as const) {
      await createCustomFieldDefinition(management, { entityType, key: "tier", label: "Tier", fieldType: "SELECT", options: [{ value: "gold", label: "Gold" }, { value: "silver", label: "Silver" }] });
    }
    const { company } = await companyService.createCompany(management, { name: "Tiered Co", customFields: { tier: "gold" } });
    const deal = await dealService.createDeal(management, { companyId: company.id, pipelineStageId: await getPipelineStageId(org.id), customFields: { tier: "silver" } });
    const { lead } = await leadService.createLead(management, { leadStatusId: await getLeadStatusId(org.id), customFields: { tier: "gold" } });
    expect(company.customFields).toEqual({ tier: "gold" });
    expect(deal.customFields).toEqual({ tier: "silver" });
    expect(lead.customFields).toEqual({ tier: "gold" });
    await expect(dealService.updateDeal(management, deal.id, { customFields: { tier: "bronze" } })).rejects.toThrow(/Some custom fields/);
    await dealService.updateDeal(management, deal.id, { customFields: { tier: "gold" } });
    await expect(leadService.updateLead(management, lead.id, { customFields: { tier: "silver" } })).resolves.toBeDefined();
    const dealAudit = await adminDb.auditEvent.findMany({ where: { organizationId: org.id, entityId: deal.id, action: "deal.custom_fields_updated" } });
    expect(dealAudit).toHaveLength(1);
  });

  it("filters lists by a custom field, including multi-select, and rejects unknown or invalid filters", async () => {
    const { management } = await setup();
    const { contact: a } = await contactService.createContact(management, { firstName: "A", customFields: { vip: true, channels: ["email", "sms"] } });
    const { contact: b } = await contactService.createContact(management, { firstName: "B", customFields: { vip: false, channels: ["sms"] } });
    await contactService.createContact(management, { firstName: "C" });

    const vip = await buildCustomFieldWhere(management.organizationId, "CONTACT", { vip: "true" });
    expect((await contactService.listContacts(management, { customFieldClauses: vip })).map((c) => c.id)).toEqual([a.id]);
    const sms = await buildCustomFieldWhere(management.organizationId, "CONTACT", { channels: "sms" });
    expect((await contactService.listContacts(management, { customFieldClauses: sms })).map((c) => c.id).sort()).toEqual([a.id, b.id].sort());
    const both = await buildCustomFieldWhere(management.organizationId, "CONTACT", { vip: "false", channels: "sms" });
    expect((await contactService.listContacts(management, { customFieldClauses: both })).map((c) => c.id)).toEqual([b.id]);

    await expect(buildCustomFieldWhere(management.organizationId, "CONTACT", { nope: "x" })).rejects.toThrow(/not valid/);
    await expect(buildCustomFieldWhere(management.organizationId, "CONTACT", { vip: "maybe" })).rejects.toThrow(/not valid/);
    expect(await buildCustomFieldWhere(management.organizationId, "CONTACT", {})).toBeUndefined();
  });
});

describe("migration of existing qualification keys (FIG-803)", () => {
  it("turns plain top-level qualification keys into definitions and leaves system objects alone", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const { lead } = await leadService.createLead(ctx, { leadStatusId: await getLeadStatusId(org.id) });
    await adminDb.lead.update({
      where: { id: lead.id },
      data: { qualificationData: { legacy_budget: "500k", legacy_count: 4, utm: { source: "fb" }, "Bad Key": "x" } },
    });

    const sql = readFileSync("prisma/migrations/20261023170000_custom_fields/migration.sql", "utf8");
    const insert = sql.slice(sql.indexOf('INSERT INTO "custom_field_definitions"'));
    await adminDb.$executeRawUnsafe(insert);
    await adminDb.$executeRawUnsafe(insert); // idempotent: running it again adds nothing

    const defs = await adminDb.customFieldDefinition.findMany({ where: { organizationId: org.id, key: { startsWith: "legacy_" } }, orderBy: { key: "asc" } });
    expect(defs.map((d) => [d.key, d.label, d.section, d.entityType])).toEqual([
      ["legacy_budget", "Legacy Budget", "QUALIFICATION", "LEAD"],
      ["legacy_count", "Legacy Count", "QUALIFICATION", "LEAD"],
    ]);
    expect(await adminDb.customFieldDefinition.count({ where: { organizationId: org.id, key: { in: ["utm", "Bad Key"] } } })).toBe(0);
  });
});
