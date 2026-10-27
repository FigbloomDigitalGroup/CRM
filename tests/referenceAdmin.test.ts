import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { listCustomFieldDefinitions } from "../src/services/customFieldService";
import { listTemplates } from "../src/services/emailTemplateService";
import {
  type CreateReferenceInput,
  type ReferenceKind,
  createReferenceValue,
  deleteReferenceValue,
  getReferenceValueUsage,
  listReferenceKinds,
  listReferenceValues,
  mergeReferenceValues,
  renameReferenceValue,
  reorderReferenceValue,
  setReferenceValueHidden,
} from "../src/services/referenceAdminService";
import { getFormReferenceData } from "../src/services/referenceDataService";
import { changeTags, listTags } from "../src/services/tagService";
import { createTestContext, createTestOrganization, getLeadStatusId } from "./helpers/fixtures";
import { createCompanyRow } from "./helpers/stage3";

type Fixture = {
  /** Input for creating a fresh value of this kind. */
  create: (n: string) => CreateReferenceInput;
  /** Puts one record on the value, so it is "in use". */
  use: (orgId: string, ctx: Awaited<ReturnType<typeof createTestContext>>, valueId: string) => Promise<void>;
  /** The ids a picker offers to a normal (non-manager) user. */
  picker: (orgId: string, member: Awaited<ReturnType<typeof createTestContext>>) => Promise<string[]>;
  /** What the old record still carries after the value is hidden. */
  stillOnRecord: (orgId: string, valueId: string) => Promise<boolean>;
};

const fixtures: Record<Exclude<ReferenceKind, "pipelineStages">, Fixture> = {
  leadSources: {
    create: (n) => ({ name: `Source ${n}` }),
    use: async (orgId, ctx, id) => void (await adminDb.lead.create({ data: { organizationId: orgId, leadStatusId: await getLeadStatusId(orgId), leadSourceId: id } })),
    picker: async (_o, m) => (await getFormReferenceData(m)).leadSources.map((s) => s.id),
    stillOnRecord: async (orgId, id) => (await adminDb.lead.count({ where: { organizationId: orgId, leadSourceId: id } })) === 1,
  },
  leadStatuses: {
    create: (n) => ({ name: `Status ${n}` }),
    use: async (orgId, _c, id) => void (await adminDb.lead.create({ data: { organizationId: orgId, leadStatusId: id } })),
    picker: async (_o, m) => (await getFormReferenceData(m)).leadStatuses.map((s) => s.id),
    stillOnRecord: async (orgId, id) => (await adminDb.lead.count({ where: { organizationId: orgId, leadStatusId: id } })) === 1,
  },
  lostReasons: {
    create: (n) => ({ name: `Reason ${n}` }),
    use: async (orgId, _c, id) => void (await adminDb.lead.create({ data: { organizationId: orgId, leadStatusId: await getLeadStatusId(orgId), lostReasonId: id } })),
    picker: async (_o, m) => (await getFormReferenceData(m)).lostReasons.map((s) => s.id),
    stillOnRecord: async (orgId, id) => (await adminDb.lead.count({ where: { organizationId: orgId, lostReasonId: id } })) === 1,
  },
  services: {
    create: (n) => ({ name: `Service ${n}`, category: "Test" }),
    use: async (orgId, _c, id) => void (await adminDb.lead.create({ data: { organizationId: orgId, leadStatusId: await getLeadStatusId(orgId), serviceInterestId: id } })),
    picker: async (_o, m) => (await getFormReferenceData(m)).services.map((s) => s.id),
    stillOnRecord: async (orgId, id) => (await adminDb.lead.count({ where: { organizationId: orgId, serviceInterestId: id } })) === 1,
  },
  customerLifecycleStates: {
    create: (n) => ({ name: `Lifecycle ${n}` }),
    use: async (orgId, _c, id) => void (await adminDb.company.create({ data: { organizationId: orgId, name: "Lifecycle Co", lifecycleStateId: id } })),
    picker: async (_o, m) => (await getFormReferenceData(m)).lifecycleStates.map((s) => s.id),
    stillOnRecord: async (orgId, id) => (await adminDb.company.count({ where: { organizationId: orgId, lifecycleStateId: id } })) === 1,
  },
  tags: {
    create: (n) => ({ name: `Tag ${n}` }),
    use: async (orgId, ctx, id) => {
      const company = await createCompanyRow(orgId);
      await changeTags(ctx, "company", company.id, { addTagIds: [id] });
    },
    picker: async (_o, m) => (await listTags(m)).map((t) => t.id),
    stillOnRecord: async (orgId, id) => (await adminDb.tagLink.count({ where: { organizationId: orgId, tagId: id } })) === 1,
  },
  templates: {
    create: (n) => ({ name: `Template ${n}`, subject: "Hello", body: "Body text" }),
    use: async (orgId, _c, id) => {
      const company = await createCompanyRow(orgId);
      await adminDb.communication.create({ data: { organizationId: orgId, channel: "EMAIL", direction: "OUTBOUND", summary: "Sent", companyId: company.id, emailTemplateId: id } });
    },
    picker: async (_o, m) => (await listTemplates(m)).map((t) => t.id),
    stillOnRecord: async (orgId, id) => (await adminDb.communication.count({ where: { organizationId: orgId, emailTemplateId: id } })) === 1,
  },
  customFields: {
    create: (n) => ({ name: `Field ${n}`, entityType: "COMPANY", key: `field_${n}`, fieldType: "TEXT" }),
    use: async (orgId, _c, id) => {
      const def = await adminDb.customFieldDefinition.findUniqueOrThrow({ where: { id } });
      await adminDb.company.create({ data: { organizationId: orgId, name: "Field Co", customFields: { [def.key]: "a value" } } });
    },
    picker: async (_o, m) => (await listCustomFieldDefinitions(m, { entityType: "COMPANY" })).map((d) => d.id),
    stillOnRecord: async (orgId, id) => {
      const def = await adminDb.customFieldDefinition.findUniqueOrThrow({ where: { id } });
      const company = await adminDb.company.findFirstOrThrow({ where: { organizationId: orgId, name: "Field Co" } });
      return (company.customFields as Record<string, unknown>)[def.key] === "a value";
    },
  },
};

const kinds = Object.keys(fixtures) as (keyof typeof fixtures)[];
let counter = 0;
const nextName = () => `${Date.now().toString(36)}${(counter += 1)}`.replace(/[^a-z0-9]/g, "");

async function setup(kind: keyof typeof fixtures) {
  const org = await createTestOrganization(`RefAdmin-${kind}`);
  const admin = await createTestContext(org.id, "MANAGEMENT", "ref.admin");
  const sales = await createTestContext(org.id, "SALES", "ref.sales");
  return { org, admin, sales, f: fixtures[kind] };
}

describe.each(kinds)("reference data admin: %s", (kind) => {
  it("creates, renames and counts usage", async () => {
    const { org, admin, f } = await setup(kind);
    const created = await createReferenceValue(admin, kind, f.create(nextName()));
    expect(created).toMatchObject({ kind, hidden: false, usageCount: 0 });
    const renamed = await renameReferenceValue(admin, kind, created.id, "Renamed Value");
    expect(renamed.name).toBe("Renamed Value");

    await f.use(org.id, admin, created.id);
    const usage = await getReferenceValueUsage(admin, kind, created.id);
    expect(usage).toMatchObject({ inUse: true, usageCount: 1 });
    expect(usage.holders.length).toBeGreaterThan(0);
    expect((await listReferenceValues(admin, kind)).find((v) => v.id === created.id)!.usageCount).toBe(1);
  });

  it("deletes an unused value, and refuses a used one with the usage and the advice to hide it", async () => {
    const { org, admin, f } = await setup(kind);
    const unused = await createReferenceValue(admin, kind, f.create(nextName()));
    await expect(deleteReferenceValue(admin, kind, unused.id)).resolves.toEqual({ id: unused.id, deleted: true });
    expect((await listReferenceValues(admin, kind)).some((v) => v.id === unused.id)).toBe(false);

    const used = await createReferenceValue(admin, kind, f.create(nextName()));
    await f.use(org.id, admin, used.id);
    const err = await deleteReferenceValue(admin, kind, used.id).catch((e) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.message).toMatch(/in use \(1 /);
    expect(err.message).toMatch(/Hide it instead/);
    expect(err.issues?.[0]?.code).toBe("IN_USE");
    // Still there, still counted.
    expect((await listReferenceValues(admin, kind)).find((v) => v.id === used.id)!.usageCount).toBe(1);
  });

  it("hides: the value leaves the pickers but stays on the old records, and unhiding brings it back", async () => {
    const { org, admin, sales, f } = await setup(kind);
    const value = await createReferenceValue(admin, kind, f.create(nextName()));
    await f.use(org.id, admin, value.id);
    expect(await f.picker(org.id, sales)).toContain(value.id);

    const hidden = await setReferenceValueHidden(admin, kind, value.id, true);
    expect(hidden.hidden).toBe(true);
    expect(await f.picker(org.id, sales)).not.toContain(value.id);
    expect(await f.stillOnRecord(org.id, value.id)).toBe(true);
    // The admin list still shows it, marked hidden.
    expect((await listReferenceValues(admin, kind)).find((v) => v.id === value.id)!.hidden).toBe(true);

    const back = await setReferenceValueHidden(admin, kind, value.id, false);
    expect(back.hidden).toBe(false);
    expect(await f.picker(org.id, sales)).toContain(value.id);
  });

  it("is for managers of that list only, and never crosses organisations", async () => {
    const { org, admin, sales, f } = await setup(kind);
    const value = await createReferenceValue(admin, kind, f.create(nextName()));
    await expect(listReferenceValues(sales, kind)).rejects.toThrow(ForbiddenError);
    await expect(createReferenceValue(sales, kind, f.create(nextName()))).rejects.toThrow(ForbiddenError);
    await expect(deleteReferenceValue(sales, kind, value.id)).rejects.toThrow(ForbiddenError);
    await expect(setReferenceValueHidden(sales, kind, value.id, true)).rejects.toThrow(ForbiddenError);

    const other = await createTestOrganization(`RefAdminOther-${kind}`);
    const otherAdmin = await createTestContext(other.id, "MANAGEMENT", "ref.other");
    await expect(renameReferenceValue(otherAdmin, kind, value.id, "Hijacked")).rejects.toThrow(NotFoundError);
    await expect(deleteReferenceValue(otherAdmin, kind, value.id)).rejects.toThrow(NotFoundError);
    await expect(mergeReferenceValues(otherAdmin, kind, value.id, value.id)).rejects.toThrow();
    expect((await listReferenceValues(otherAdmin, kind)).some((v) => v.id === value.id)).toBe(false);
    void org;
  });
});

describe.each(["leadSources", "leadStatuses", "lostReasons", "services", "customerLifecycleStates", "tags"] as const)("merging %s", (kind) => {
  it("re-points every record, removes the merged value and audits it", async () => {
    const { org, admin, f } = await setup(kind);
    const from = await createReferenceValue(admin, kind, f.create(nextName()));
    const into = await createReferenceValue(admin, kind, f.create(nextName()));
    await f.use(org.id, admin, from.id);

    const result = await mergeReferenceValues(admin, kind, from.id, into.id);
    expect(result.removed.id).toBe(from.id);
    expect(result.into.usageCount).toBe(1);
    expect(result.moved.reduce((n, m) => n + m.count, 0)).toBe(1);
    expect((await listReferenceValues(admin, kind)).some((v) => v.id === from.id)).toBe(false);
    expect(await f.stillOnRecord(org.id, into.id)).toBe(true);

    const events = await adminDb.auditEvent.findMany({
      where: { organizationId: org.id, action: { in: ["reference_value.merged", "tag.merged"] } },
    });
    expect(events).toHaveLength(1);
  });

  it("refuses merging a value into itself, into a hidden value, or away from a system value", async () => {
    const { admin, f } = await setup(kind);
    const a = await createReferenceValue(admin, kind, f.create(nextName()));
    const b = await createReferenceValue(admin, kind, f.create(nextName()));
    await expect(mergeReferenceValues(admin, kind, a.id, a.id)).rejects.toThrow(ValidationError);
    await setReferenceValueHidden(admin, kind, b.id, true);
    await expect(mergeReferenceValues(admin, kind, a.id, b.id)).rejects.toThrow(/hidden/);
  });
});

describe("lists that cannot be reordered, merged or changed", () => {
  it("tags and templates are alphabetical; templates and custom fields cannot be merged", async () => {
    const { admin } = await setup("tags");
    const tag = await createReferenceValue(admin, "tags", fixtures.tags.create(nextName()));
    await expect(reorderReferenceValue(admin, "tags", tag.id, "up")).rejects.toThrow(/alphabetically/);
    const template = await createReferenceValue(admin, "templates", fixtures.templates.create(nextName()));
    await expect(reorderReferenceValue(admin, "templates", template.id, "down")).rejects.toThrow(ValidationError);
    await expect(mergeReferenceValues(admin, "templates", template.id, template.id)).rejects.toThrow(ValidationError);
    const field = await createReferenceValue(admin, "customFields", fixtures.customFields.create(nextName()));
    await expect(mergeReferenceValues(admin, "customFields", field.id, field.id)).rejects.toThrow(/cannot be merged/);
  });

  it("pipeline stages are fixed in V1: rename only", async () => {
    const org = await createTestOrganization("RefAdminStages");
    const admin = await createTestContext(org.id, "MANAGEMENT", "ref.admin");
    const stages = await listReferenceValues(admin, "pipelineStages");
    expect(stages.length).toBe(5);
    expect(stages.every((s) => s.protected && !s.capabilities.hide && !s.capabilities.delete && !s.capabilities.merge && !s.capabilities.reorder)).toBe(true);

    const stage = stages[0]!;
    expect((await renameReferenceValue(admin, "pipelineStages", stage.id, "Solution Shown")).name).toBe("Solution Shown");
    await expect(createReferenceValue(admin, "pipelineStages", { name: "Extra" })).rejects.toThrow(/fixed in V1/);
    await expect(setReferenceValueHidden(admin, "pipelineStages", stage.id, true)).rejects.toThrow(ValidationError);
    await expect(deleteReferenceValue(admin, "pipelineStages", stage.id)).rejects.toThrow(ValidationError);
    await expect(reorderReferenceValue(admin, "pipelineStages", stage.id, "down")).rejects.toThrow(/fixed in V1/);
    await expect(mergeReferenceValues(admin, "pipelineStages", stage.id, stages[1]!.id)).rejects.toThrow(ValidationError);
  });

  it("values the system relies on can be renamed but never hidden, deleted or merged away", async () => {
    const org = await createTestOrganization("RefAdminSystem");
    const admin = await createTestContext(org.id, "MANAGEMENT", "ref.admin");
    const find = async (kind: ReferenceKind, key: string) => (await listReferenceValues(admin, kind)).find((v) => v.key === key)!;
    const website = await find("leadSources", "WEBSITE");
    const status = await find("leadStatuses", "NEW");
    const prospect = await find("customerLifecycleStates", "PROSPECT");
    const spare = await createReferenceValue(admin, "leadSources", { name: "Spare Source" });

    for (const [kind, v] of [["leadSources", website], ["leadStatuses", status], ["customerLifecycleStates", prospect]] as const) {
      expect(v.protected).toBe(true);
      expect((await renameReferenceValue(admin, kind, v.id, `${v.name} X`)).name).toBe(`${v.name} X`);
      await expect(setReferenceValueHidden(admin, kind, v.id, true)).rejects.toThrow(/used by the system/);
      await expect(deleteReferenceValue(admin, kind, v.id)).rejects.toThrow(/used by the system/);
    }
    await expect(mergeReferenceValues(admin, "leadSources", website.id, spare.id)).rejects.toThrow(/used by the system/);
    // Merging INTO a system value is fine.
    await expect(mergeReferenceValues(admin, "leadSources", spare.id, website.id)).resolves.toBeDefined();
  });

  it("reorders catalogs and custom fields, one step at a time", async () => {
    const org = await createTestOrganization("RefAdminOrder");
    const admin = await createTestContext(org.id, "MANAGEMENT", "ref.admin");
    const a = await createReferenceValue(admin, "lostReasons", { name: "Order A" });
    const b = await createReferenceValue(admin, "lostReasons", { name: "Order B" });
    const order = async () => (await listReferenceValues(admin, "lostReasons")).map((v) => v.id);
    const before = await order();
    expect(before.indexOf(a.id)).toBeLessThan(before.indexOf(b.id));
    await reorderReferenceValue(admin, "lostReasons", b.id, "up");
    const after = await order();
    expect(after.indexOf(b.id)).toBeLessThan(after.indexOf(a.id));

    const f1 = await createReferenceValue(admin, "customFields", { name: "First", entityType: "LEAD", key: "first_f", fieldType: "TEXT" });
    const f2 = await createReferenceValue(admin, "customFields", { name: "Second", entityType: "LEAD", key: "second_f", fieldType: "TEXT" });
    await reorderReferenceValue(admin, "customFields", f2.id, "up");
    const fields = (await listReferenceValues(admin, "customFields")).filter((v) => v.entityType === "LEAD");
    expect(fields.findIndex((v) => v.id === f2.id)).toBeLessThan(fields.findIndex((v) => v.id === f1.id));
    // Moving the first one up again is a no-op, not an error.
    await expect(reorderReferenceValue(admin, "customFields", f2.id, "up")).resolves.toBeDefined();
  });

  it("only offers each manager the lists their role can manage", async () => {
    const org = await createTestOrganization("RefAdminKinds");
    const admin = await createTestContext(org.id, "MANAGEMENT", "ref.admin");
    const sales = await createTestContext(org.id, "SALES", "ref.sales");
    const adminKinds = await listReferenceKinds(admin);
    expect(adminKinds.map((k) => k.kind)).toEqual(["leadSources", "leadStatuses", "pipelineStages", "lostReasons", "services", "customerLifecycleStates", "tags", "templates", "customFields"]);
    expect(adminKinds.find((k) => k.kind === "pipelineStages")!.note).toMatch(/fixed in V1/);
    expect(await listReferenceKinds(sales)).toEqual([]);
  });

  it("a hidden tag cannot be added to a record, by id or by name, but stays on records that carry it", async () => {
    const org = await createTestOrganization("RefAdminHiddenTag");
    const admin = await createTestContext(org.id, "MANAGEMENT", "ref.admin");
    const tag = await createReferenceValue(admin, "tags", { name: "Old Promo" });
    const first = await createCompanyRow(org.id);
    const second = await createCompanyRow(org.id);
    await changeTags(admin, "company", first.id, { addTagIds: [tag.id] });
    await setReferenceValueHidden(admin, "tags", tag.id, true);

    const byId = await changeTags(admin, "company", second.id, { addTagIds: [tag.id] }).catch((e) => e);
    expect(byId).toBeInstanceOf(ValidationError);
    expect(byId.issues[0]).toMatchObject({ code: "TAG_HIDDEN" });
    const byName = await changeTags(admin, "company", second.id, { addTagNames: ["old promo"] }).catch((e) => e);
    expect(byName.issues[0]).toMatchObject({ code: "TAG_HIDDEN" });
    expect((await listTags(admin)).map((t) => t.id)).not.toContain(tag.id);
    expect((await listTags(admin, undefined, { includeHidden: true })).map((t) => t.id)).toContain(tag.id);
    expect(await adminDb.tagLink.count({ where: { organizationId: org.id, tagId: tag.id } })).toBe(1);
  });
});
