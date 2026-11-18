import { afterEach, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { suggestMapping, templateCsv, parseDateCell, parseMoneyCell, FIELDS, MIGRATION_ENTITIES } from "../src/lib/migrationFields";
import {
  deleteMigrationPreset,
  getMigrationErrorReport,
  getMigrationTemplate,
  listMigrationEntities,
  listMigrationIssues,
  listMigrationPresets,
  listMigrationSessions,
  saveMigrationPreset,
  startMigrationDryRun,
  startMigrationImport,
  startMigrationValidation,
} from "../src/services/migrationService";
import { createCustomFieldDefinition } from "../src/services/customFieldService";
import { createTestContext, createTestOrganization, getPipelineStageId } from "./helpers/fixtures";
import { createCompanyRow } from "./helpers/stage3";
import { csv, emailOf, prepare, startSession } from "./helpers/migration";

async function setup() {
  const org = await createTestOrganization("Migration");
  const management = await createTestContext(org.id, "MANAGEMENT", "mig.mgmt");
  const sales = await createTestContext(org.id, "SALES", "mig.sales");
  return { org, management, sales, salesEmail: await emailOf(sales), mgmtEmail: await emailOf(management) };
}

afterEach(() => {
  delete process.env.MIGRATION_MAX_ROWS;
});

describe("fields, templates and the mapper (pure)", () => {
  it("has a fixed template per kind whose own headers map themselves", () => {
    for (const entity of MIGRATION_ENTITIES) {
      const csvText = templateCsv(entity);
      const [header, example] = csvText.trim().split("\n");
      const headers = header!.split(",");
      expect(headers).toEqual(FIELDS[entity].map((f) => f.key));
      expect(example).toBeTruthy();
      const mapping = suggestMapping(entity, headers);
      for (const f of FIELDS[entity]) expect(mapping[f.key], `${entity}.${f.key}`).toBe(f.key);
    }
  });

  it("maps common spreadsheet headers by name, each column once", () => {
    expect(suggestMapping("COMPANY", ["Company Name", "Phone Number", "E-mail", "Account Owner", "Notes", "Weird Column"])).toEqual({
      name: "Company Name",
      phone: "Phone Number",
      email: "E-mail",
      notes: "Notes",
      ownerEmail: "Account Owner",
    });
    expect(suggestMapping("DEAL", ["Customer", "Amount", "Pipeline Stage", "Deal Owner", "Close Date", "Product"])).toMatchObject({ company: "Customer", value: "Amount", stage: "Pipeline Stage", ownerEmail: "Deal Owner", expectedCloseDate: "Close Date", service: "Product" });
    expect(suggestMapping("CONTACT", ["Name", "Email", "cf:favourite_colour"])).toMatchObject({ fullName: "Name", email: "Email", "cf:favourite_colour": "cf:favourite_colour" });
  });

  it("reads dates the way people write them, day first, and refuses impossible ones", () => {
    expect(parseDateCell("2026-10-26", "d").toISOString()).toBe("2026-10-26T00:00:00.000Z");
    expect(parseDateCell("26/10/2026", "d").toISOString()).toBe("2026-10-26T00:00:00.000Z");
    expect(parseDateCell("26 Oct 2026 14:30", "d").toISOString()).toBe("2026-10-26T14:30:00.000Z");
    expect(parseDateCell("2026-10-26 09:05:07", "d").toISOString()).toBe("2026-10-26T09:05:07.000Z");
    for (const bad of ["31/02/2026", "2026-13-01", "yesterday", "26/10/1980", "10/26/2026"]) expect(() => parseDateCell(bad, "d"), bad).toThrow();
  });

  it("reads money the way people write it", () => {
    expect(parseMoneyCell("450000", "v")).toBe(450000);
    expect(parseMoneyCell("KES 450,000", "v")).toBe(450000);
    expect(parseMoneyCell("1,250,000.50", "v")).toBe(1250000.5);
    expect(parseMoneyCell("99.999", "v")).toBe(100);
    for (const bad of ["", "abc", "-5"]) expect(() => parseMoneyCell(bad, "v"), bad).toThrow();
  });
});

describe("the seven steps and their guards (FIG-1061)", () => {
  it("walks source, upload, map, validate, dry run, import, review, and refuses steps out of order", async () => {
    const { management, salesEmail } = await setup();
    const drive = await startSession(management, { entity: "COMPANY" });
    expect((await drive.get()).steps.map((s) => s.state)).toEqual(["done", "current", "todo", "todo", "todo", "todo", "todo"]);

    // Nothing works before the file.
    await expect(drive.map({ mapping: { name: "name" } })).rejects.toThrow(/Upload the file first/);
    await expect(startMigrationValidation(management, drive.id)).rejects.toThrow(/Map the fields/);

    const uploaded = await drive.upload("companies.csv", csv([{ name: "Order Co", owner: salesEmail }]));
    expect(uploaded.session).toMatchObject({ status: "UPLOADED", step: "MAP", file: { name: "companies.csv", headers: ["name", "owner"], rows: 1 } });
    expect(uploaded.suggestedMapping).toEqual({ name: "name", ownerEmail: "owner" });
    await expect(startMigrationValidation(management, drive.id)).rejects.toThrow(/Map the fields/);

    await drive.map({ mapping: uploaded.suggestedMapping });
    await expect(startMigrationDryRun(management, drive.id)).rejects.toThrow(/Validate the file/);
    await expect(startMigrationImport(management, drive.id, { confirm: true })).rejects.toThrow(/dry run/);

    const validated = await drive.validate();
    expect(validated).toMatchObject({ status: "VALIDATED", counts: { total: 1, valid: 1, errors: 0 } });
    await expect(startMigrationImport(management, drive.id, { confirm: true })).rejects.toThrow(/dry run/);

    const dry = await drive.dryRun();
    expect(dry.status).toBe("DRY_RUN_DONE");
    await expect(startMigrationImport(management, drive.id, {})).rejects.toThrow(/Confirm/);

    const done = await drive.run();
    expect(done).toMatchObject({ status: "COMPLETED", step: "REVIEW", counts: { created: 1 } });
    expect(done.steps.every((s) => s.state === "done")).toBe(true);
    expect(done.rollback.canRollback).toBe(true);
    // A finished migration takes no more files or mappings.
    await expect(drive.upload("again.csv", csv([{ name: "x" }]))).rejects.toThrow(/can no longer take/);
    await expect(drive.map({ mapping: { name: "name" } })).rejects.toThrow(/can no longer be changed/);
  });

  it("changing the mapping makes the earlier results stale, so the steps run again", async () => {
    const { management } = await setup();
    const drive = await prepare(management, { entity: "COMPANY" }, csv([{ name: "Stale Co", city: "Nairobi" }]));
    expect((await drive.get()).status).toBe("DRY_RUN_DONE");
    await drive.map({ mapping: { name: "name", location: "city" } });
    const after = await drive.get();
    expect(after).toMatchObject({ status: "MAPPED", dryRun: null, counts: { valid: 0, processed: 0 } });
    await expect(startMigrationImport(management, drive.id, { confirm: true })).rejects.toThrow(/dry run/);
  });

  it("a dry run that finds nothing to import cannot be imported", async () => {
    const { management } = await setup();
    const drive = await prepare(management, { entity: "COMPANY" }, csv([{ name: "", email: "a@x.test" }, { name: "", email: "b@x.test" }]));
    expect((await drive.get()).dryRun).toMatchObject({ wouldCreate: 0, errors: 2 });
    await expect(startMigrationImport(management, drive.id, { confirm: true })).rejects.toThrow(/nothing to import/);
  });
});

describe("upload checks", () => {
  it("refuses a file that is empty, binary, malformed, headerless, repeated headers, or over the row limit", async () => {
    const { management } = await setup();
    const fresh = () => startSession(management, { entity: "COMPANY" });
    const refusal = async (data: Buffer) => (await (await fresh()).upload("x.csv", data).catch((e) => e)) as Error;
    expect(await refusal(Buffer.alloc(0))).toBeInstanceOf(ValidationError);
    expect((await refusal(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00]))).message).toMatch(/does not look like a CSV/);
    expect((await refusal(Buffer.from("name\n"))).message).toMatch(/no rows/);
    expect((await refusal(Buffer.from("name,name\na,b\n"))).message).toMatch(/same name/);
    expect((await refusal(Buffer.from("name,\na,b\n"))).message).toMatch(/needs a name/);
    expect((await refusal(Buffer.from('name\n"unterminated\n'))).message).toMatch(/could not be read as CSV|malformed/i);
    process.env.MIGRATION_MAX_ROWS = "3";
    const err = (await refusal(csv(Array.from({ length: 4 }, (_, i) => ({ name: `Row ${i}` }))))) as ValidationError;
    expect(err.message).toMatch(/At most 3 rows/);
    expect(err.issues?.[0]?.code).toBe("TOO_MANY_ROWS");
  });

  it("warns when the exact same file was already imported", async () => {
    const { management } = await setup();
    const data = csv([{ name: "Twice Co" }]);
    const first = await prepare(management, { entity: "COMPANY" }, data);
    await first.run();
    const second = await startSession(management, { entity: "COMPANY" });
    const uploaded = await second.upload("again.csv", data);
    expect(uploaded.session.warnings).toEqual([expect.objectContaining({ code: "FILE_ALREADY_IMPORTED", sessionId: first.id })]);
  });
});

describe("mapping rules and presets", () => {
  it("refuses unknown fields, unknown columns, a column used twice, and missing required mappings, per kind", async () => {
    const { management } = await setup();
    const drive = await startSession(management, { entity: "COMPANY" });
    await drive.upload("x.csv", csv([{ a: "1", b: "2" }]));
    const issuesOf = async (mapping: Record<string, string>) => ((await drive.map({ mapping }).catch((e) => e)) as ValidationError).issues?.map((i) => i.code ?? i.message);
    expect(await issuesOf({ name: "a", colour: "b" })).toContain("UNKNOWN_FIELD");
    expect(await issuesOf({ name: "zzz" })).toContain("UNKNOWN_COLUMN");
    expect(await issuesOf({ name: "a", industry: "a" })).toContain("COLUMN_REUSED");
    expect(await issuesOf({ industry: "a" })).toContain("MAPPING_REQUIRED");

    const required: Record<string, string[]> = { CONTACT: ["firstName"], LEAD: ["contactName"], DEAL: ["company", "stage"], TASK: ["title"], ACTIVITY: ["type", "occurredAt", "company"] };
    for (const [entity, paths] of Object.entries(required)) {
      const d = await startSession(management, { entity });
      await d.upload("x.csv", csv([{ a: "1" }]));
      const err = (await d.map({ mapping: {} }).catch((e) => e)) as ValidationError;
      expect(err.issues?.map((i) => i.path), entity).toEqual(paths.map((p) => `mapping.${p}`));
    }
  });

  it("saves a mapping as a preset, starts the next migration from it, and keeps presets per organisation", async () => {
    const { management } = await setup();
    const first = await startSession(management, { entity: "DEAL" });
    await first.upload("a.csv", csv([{ Customer: "A", Amount: "1", Phase: "x", Rep: "r@x.test" }]));
    await first.map({ mapping: { company: "Customer", value: "Amount", stage: "Phase", ownerEmail: "Rep" }, valueMappings: { stage: { Won: "Closed Won" } }, savePresetAs: "Old CRM deals" });
    const presets = await listMigrationPresets(management, "DEAL");
    expect(presets.items).toHaveLength(1);
    expect(presets.items[0]).toMatchObject({ name: "Old CRM deals", entity: "DEAL", mapping: { company: "Customer", stage: "Phase" }, valueMappings: { stage: { Won: "Closed Won" } } });

    const next = await startSession(management, { entity: "DEAL", presetId: presets.items[0]!.id });
    const uploaded = await next.upload("b.csv", csv([{ Customer: "B", Amount: "2", Phase: "y", Rep: "s@x.test" }]));
    expect(uploaded.session.mapping).toMatchObject({ company: "Customer", stage: "Phase" });
    expect(uploaded.session.valueMappings).toEqual({ stage: { Won: "Closed Won" } });

    // Saving under the same name updates it; a bad field is refused; delete is audited.
    await saveMigrationPreset(management, { name: "old crm deals", entity: "DEAL", mapping: { company: "Customer", stage: "Phase" } });
    expect((await listMigrationPresets(management, "DEAL")).items).toHaveLength(1);
    await expect(saveMigrationPreset(management, { name: "Bad", entity: "DEAL", mapping: { favourite: "x" } })).rejects.toThrow(ValidationError);
    await expect(saveMigrationPreset(management, { name: "  ", entity: "DEAL", mapping: {} })).rejects.toThrow(ValidationError);
    await deleteMigrationPreset(management, presets.items[0]!.id);
    expect((await listMigrationPresets(management)).items).toHaveLength(0);

    const other = await createTestContext((await createTestOrganization("MigrationOtherPreset")).id, "MANAGEMENT", "mig.other");
    expect((await listMigrationPresets(other)).items).toHaveLength(0);
  });
});

describe("validation: per-row errors and warnings", () => {
  it("reports each bad row with its field, counts valid, warning and error rows, and lists unmapped values", async () => {
    const { org, management, sales, salesEmail } = await setup();
    const delivery = await createTestContext(org.id, "DELIVERY", "mig.delivery");
    const contact = await adminDb.contact.create({ data: { organizationId: org.id, firstName: "Known", email: "known@example.test" } });
    void contact;
    const rows = [
      { company: "Good Co", stage: "Negotiation", owner: salesEmail, value: "100,000", close: "30/11/2026", contact: "known@example.test" },
      { company: "Warn Co", stage: "Negotiation", owner: salesEmail, value: "5", close: "", contact: "nobody@example.test" },
      { company: "", stage: "Negotiation", owner: salesEmail, value: "1", close: "", contact: "" },
      { company: "No Stage Co", stage: "Pending Magic", owner: salesEmail, value: "1", close: "", contact: "" },
      { company: "Other Stage Co", stage: "Pending Magic", owner: salesEmail, value: "1", close: "", contact: "" },
      { company: "Stranger Co", stage: "Negotiation", owner: "stranger@elsewhere.test", value: "1", close: "", contact: "" },
      { company: "Bad Date Co", stage: "Negotiation", owner: salesEmail, value: "1", close: "31/02/2026", contact: "" },
      { company: "Bad Money Co", stage: "Negotiation", owner: salesEmail, value: "lots", close: "", contact: "" },
      { company: "Delivery Co", stage: "Negotiation", owner: await emailOf(delivery), value: "1", close: "", contact: "" },
    ];
    const drive = await startSession(management, { entity: "DEAL" });
    await drive.upload("deals.csv", csv(rows));
    await drive.map({ mapping: { company: "company", stage: "stage", ownerEmail: "owner", value: "value", expectedCloseDate: "close", contactEmail: "contact" } });
    const session = await drive.validate();

    expect(session.counts).toMatchObject({ total: 9, valid: 2, warnings: 1, errors: 7 });
    const errors = await listMigrationIssues(management, drive.id, { severity: "ERROR" });
    const byRow = new Map(errors.items.map((i) => [i.row, i]));
    expect(byRow.get(4)).toMatchObject({ field: "company", message: "The company is required." });
    expect(byRow.get(5)).toMatchObject({ field: "stage" });
    expect(byRow.get(5)!.message).toContain("Pending Magic");
    expect(byRow.get(7)).toMatchObject({ field: "ownerEmail" });
    expect(byRow.get(8)).toMatchObject({ field: "expectedCloseDate" });
    expect(byRow.get(9)).toMatchObject({ field: "value" });
    expect(byRow.get(10)!.message).toMatch(/cannot be the deal owner/);
    const warnings = await listMigrationIssues(management, drive.id, { severity: "WARNING" });
    expect(warnings.items).toEqual([expect.objectContaining({ row: 3, field: "contactEmail" })]);

    // Values the file uses that the CRM does not know, ready for the value mapping step.
    expect(session.validation?.unmappedValues).toEqual(
      expect.arrayContaining([
        { field: "stage", value: "Pending Magic", count: 2 },
        { field: "ownerEmail", value: "stranger@elsewhere.test", count: 1 },
      ]),
    );
    void sales;
  });

  it("a value mapping fixes unknown values without editing the file", async () => {
    const { management, salesEmail, mgmtEmail } = await setup();
    const rows = [
      { company: "VM One", stage: "Open", owner: "old.rep@previous-crm.test" },
      { company: "VM Two", stage: "Won", owner: "old.rep@previous-crm.test" },
      { company: "VM Three", stage: "Negotiation", owner: salesEmail },
    ];
    const drive = await startSession(management, { entity: "DEAL" });
    await drive.upload("deals.csv", csv(rows));
    await drive.map({ mapping: { company: "company", stage: "stage", ownerEmail: "owner" } });
    expect((await drive.validate()).counts).toMatchObject({ valid: 1, errors: 2 });

    await drive.map({
      mapping: { company: "company", stage: "stage", ownerEmail: "owner" },
      valueMappings: { stage: { open: "Solution Presented", WON: "Closed Won" }, ownerEmail: { "old.rep@previous-crm.test": mgmtEmail } },
    });
    expect((await drive.validate()).counts).toMatchObject({ valid: 3, errors: 0 });
    await drive.dryRun();
    const done = await drive.run();
    expect(done.counts.created).toBe(3);
    const won = await adminDb.deal.findFirstOrThrow({ where: { organizationId: management.organizationId, company: { name: "VM Two" } }, include: { pipelineStage: true } });
    expect(won).toMatchObject({ outcome: "WON", ownerMembershipId: management.membershipId });
    expect(won.pipelineStage.name).toBe("Closed Won");
  });

  it("the error report is the problem rows beside their original values, ready to fix and upload again", async () => {
    const { management } = await setup();
    const drive = await startSession(management, { entity: "COMPANY" });
    await drive.upload("c.csv", csv([{ name: "Fine Co", email: "ok@example.test" }, { name: "Broken Co", email: "not-an-email" }, { name: "", email: "x@example.test" }]));
    await drive.map({ mapping: { name: "name", email: "email" } });
    await drive.validate();
    const report = (await getMigrationErrorReport(management, drive.id)).toString("utf8").trim().split("\n");
    expect(report[0]).toBe("row,severity,field,problem,existing_record_id,name,email");
    expect(report).toHaveLength(3);
    expect(report[1]).toContain("3,ERROR,email");
    expect(report[1]).toContain("Broken Co,not-an-email");
    expect(report[2]).toContain("4,ERROR,name,The company name is required.");
    expect(report[2]).toContain(",,x@example.test");
  });
});

describe("importing each kind of record", () => {
  it("companies: tags, custom fields, owners by email, the original date, and every row tagged with the session", async () => {
    const { org, management, sales, salesEmail } = await setup();
    await createCustomFieldDefinition(management, { entityType: "COMPANY", key: "tier", label: "Tier", fieldType: "SELECT", options: [{ value: "gold", label: "Gold" }, { value: "silver", label: "Silver" }] });
    const rows = [
      { name: "Alpha Traders", industry: "Retail", email: "info@alpha.test", owner: salesEmail, tags: "vip; nairobi", created: "14/03/2024", "cf:tier": "gold", state: "Active Customer" },
      { name: "Beta Supplies", industry: "Hardware", email: "", owner: "", tags: "", created: "2023-01-02", "cf:tier": "", state: "" },
    ];
    const drive = await prepare(management, { entity: "COMPANY" }, csv(rows), { mapping: { name: "name", industry: "industry", email: "email", ownerEmail: "owner", tags: "tags", createdAt: "created", "cf:tier": "cf:tier", lifecycleState: "state" } });
    const done = await drive.run();
    expect(done).toMatchObject({ status: "COMPLETED", counts: { created: 2, errors: 0 } });

    const alpha = await adminDb.company.findFirstOrThrow({ where: { organizationId: org.id, name: "Alpha Traders" }, include: { lifecycleState: true, tagLinks: { include: { tag: true } } } });
    expect(alpha).toMatchObject({ industry: "Retail", ownerMembershipId: sales.membershipId, importSessionId: drive.id, createdByMembershipId: management.membershipId });
    expect(alpha.createdAt.toISOString()).toBe("2024-03-14T00:00:00.000Z");
    expect(alpha.customFields).toEqual({ tier: "gold" });
    expect(alpha.lifecycleState?.key).toBe("ACTIVE_CUSTOMER");
    expect(alpha.tagLinks.map((l) => l.tag.name).sort()).toEqual(["nairobi", "vip"]);
    // No owner in the file: the person importing owns it.
    const beta = await adminDb.company.findFirstOrThrow({ where: { organizationId: org.id, name: "Beta Supplies" } });
    expect(beta).toMatchObject({ ownerMembershipId: management.membershipId, importSessionId: drive.id });
    expect(await adminDb.importSessionChange.count({ where: { sessionId: drive.id, action: "CREATED", entity: "COMPANY" } })).toBe(2);

    // Audited, with who and what.
    const audit = await adminDb.auditEvent.findFirstOrThrow({ where: { organizationId: org.id, action: "data_migration.imported" } });
    expect(audit).toMatchObject({ actorMembershipId: management.membershipId, entityId: drive.id });
    expect(audit.metadata).toMatchObject({ entity: "COMPANY", created: 2, file: "migration.csv" });
  });

  it("contacts: first and last name or a full name, linked to companies by name, created if asked", async () => {
    const { org, management } = await setup();
    await createCompanyRow(org.id, { name: "Existing Ltd" });
    const rows = [
      { name: "Amina Odhiambo", email: "amina@example.test", phone: "0722 111 222", company: "Existing Ltd" },
      { name: "Brian", email: "", phone: "", company: "Brand New Ltd" },
    ];
    const strict = await prepare(management, { entity: "CONTACT" }, csv(rows));
    expect((await strict.get()).dryRun).toMatchObject({ wouldCreate: 1, errors: 1 });
    const issue = (await listMigrationIssues(management, strict.id)).items[0]!;
    expect(issue).toMatchObject({ field: "company" });
    expect(issue.message).toContain("Brand New Ltd");

    const open = await prepare(management, { entity: "CONTACT", createMissingCompanies: true }, csv(rows));
    expect((await open.get()).dryRun).toMatchObject({ wouldCreate: 2, newCompanies: 1 });
    await open.run();
    const amina = await adminDb.contact.findFirstOrThrow({ where: { organizationId: org.id, email: "amina@example.test" }, include: { company: true } });
    expect(amina).toMatchObject({ firstName: "Amina", lastName: "Odhiambo", importSessionId: open.id });
    expect(amina.company?.name).toBe("Existing Ltd");
    const brian = await adminDb.contact.findFirstOrThrow({ where: { organizationId: org.id, firstName: "Brian" }, include: { company: true } });
    expect(brian.company).toMatchObject({ name: "Brand New Ltd", importSessionId: open.id });
  });

  it("leads: create their contacts and companies, start as New, map statuses and sources, and keep unowned leads unowned", async () => {
    const { org, management, salesEmail, sales } = await setup();
    const rows = [
      { name: "Cynthia Wanjiru", email: "cynthia@example.test", phone: "0733 000 111", company: "Wanjiru Foods", status: "", source: "Referral", service: "CCTV", temp: "hot", owner: salesEmail, notes: "Wants 8 cameras" },
      { name: "", email: "", phone: "", company: "", status: "New", source: "", service: "", temp: "", owner: "", notes: "nothing here" },
      { name: "Dennis", email: "", phone: "0744 000 222", company: "", status: "Negotiating", source: "", service: "", temp: "", owner: "", notes: "" },
    ];
    const drive = await startSession(management, { entity: "LEAD", createMissingCompanies: true });
    await drive.upload("leads.csv", csv(rows));
    await drive.map({
      mapping: { contactName: "name", contactEmail: "email", contactPhone: "phone", company: "company", leadStatus: "status", leadSource: "source", serviceInterest: "service", temperature: "temp", ownerEmail: "owner", notes: "notes" },
      valueMappings: { leadStatus: { Negotiating: "Contacted" } },
    });
    expect((await drive.validate()).counts).toMatchObject({ valid: 2, errors: 1 });
    expect((await listMigrationIssues(management, drive.id, { severity: "ERROR" })).items[0]!.message).toMatch(/contact .* or a company/);
    await drive.dryRun();
    const done = await drive.run();
    expect(done.counts).toMatchObject({ created: 2, errors: 1 });

    const cynthia = await adminDb.lead.findFirstOrThrow({ where: { organizationId: org.id, contact: { email: "cynthia@example.test" } }, include: { leadStatus: true, leadSource: true, serviceInterest: true, company: true, contact: true } });
    expect(cynthia).toMatchObject({ temperature: "HOT", ownerMembershipId: sales.membershipId, notes: "Wants 8 cameras", importSessionId: drive.id });
    expect(cynthia.leadStatus.key).toBe("NEW");
    expect(cynthia.leadSource?.key).toBe("REFERRAL");
    expect(cynthia.serviceInterest?.key).toBe("CCTV");
    expect(cynthia.company).toMatchObject({ name: "Wanjiru Foods", importSessionId: drive.id });
    expect(cynthia.contact).toMatchObject({ firstName: "Cynthia", lastName: "Wanjiru", importSessionId: drive.id });
    const dennis = await adminDb.lead.findFirstOrThrow({ where: { organizationId: org.id, contact: { firstName: "Dennis" } }, include: { leadStatus: true } });
    expect(dennis.leadStatus.key).toBe("CONTACTED");
    expect(dennis.ownerMembershipId).toBeNull();
  });

  it("deals (FIG-800): company by name or created, contact by email, stage by name, owner by email, nothing silently defaulted", async () => {
    const { org, management, sales, salesEmail } = await setup();
    const existing = await createCompanyRow(org.id, { name: "Kamau Hardware Ltd" });
    const contact = await adminDb.contact.create({ data: { organizationId: org.id, firstName: "Amina", email: "amina@kamau.test", companyId: existing.id } });
    const rows = [
      { name: "CCTV for Westlands", company: "Kamau Hardware Ltd", contact: "amina@kamau.test", value: "KES 450,000", stage: "Negotiation", owner: salesEmail, service: "CCTV", closedate: "30/11/2026", notes: "8 cameras" },
      { name: "", company: "Brand New Traders", contact: "", value: "120000", stage: "Closed Won", owner: salesEmail, service: "", closedate: "", notes: "" },
      { name: "", company: "Lost Cause Co", contact: "", value: "50000", stage: "closed lost", owner: salesEmail, service: "", closedate: "2026-09-01", notes: "" },
      { name: "", company: "Unknown Stage Co", contact: "", value: "1", stage: "Maybe Later", owner: salesEmail, service: "", closedate: "", notes: "" },
      { name: "", company: "Unknown Owner Co", contact: "", value: "1", stage: "Negotiation", owner: "ghost@nowhere.test", service: "", closedate: "", notes: "" },
      { name: "", company: "Blank Owner Co", contact: "", value: "1", stage: "Negotiation", owner: "", service: "", closedate: "", notes: "" },
    ];
    const drive = await prepare(management, { entity: "DEAL" }, csv(rows));
    expect((await drive.get()).dryRun).toMatchObject({ wouldCreate: 3, errors: 3, newCompanies: 2 });
    const done = await drive.run();
    expect(done).toMatchObject({ status: "COMPLETED_WITH_ERRORS", counts: { created: 3, errors: 3 } });

    const first = await adminDb.deal.findFirstOrThrow({ where: { organizationId: org.id, companyId: existing.id }, include: { pipelineStage: true, service: true } });
    expect(first).toMatchObject({ primaryContactId: contact.id, ownerMembershipId: sales.membershipId, currency: "KES", outcome: "OPEN", importSessionId: drive.id });
    expect(first.value?.toString()).toBe("450000");
    expect(first.pipelineStage.name).toBe("Negotiation");
    expect(first.service?.key).toBe("CCTV");
    expect(first.expectedCloseDate?.toISOString().slice(0, 10)).toBe("2026-11-30");
    expect(first.notes).toBe("Deal: CCTV for Westlands\n8 cameras");
    // An open deal does not arrive already stalled.
    expect(Date.now() - first.lastActivityAt.getTime()).toBeLessThan(5 * 60_000);

    const won = await adminDb.deal.findFirstOrThrow({ where: { organizationId: org.id, company: { name: "Brand New Traders" } }, include: { company: true } });
    expect(won).toMatchObject({ outcome: "WON" });
    expect(won.wonAt).not.toBeNull();
    expect(won.company.importSessionId).toBe(drive.id);
    const lost = await adminDb.deal.findFirstOrThrow({ where: { organizationId: org.id, company: { name: "Lost Cause Co" } }, include: { lostReason: true } });
    expect(lost).toMatchObject({ outcome: "LOST" });
    expect(lost.lostReason?.key).toBe("OTHER");
    expect(lost.lostAt?.toISOString().slice(0, 10)).toBe("2026-09-01");
    // Not imported, and not defaulted into something else.
    for (const name of ["Unknown Stage Co", "Unknown Owner Co", "Blank Owner Co"]) {
      expect(await adminDb.deal.count({ where: { organizationId: org.id, company: { name } } }), name).toBe(0);
      expect(await adminDb.company.count({ where: { organizationId: org.id, name } }), name).toBe(0);
    }
    const errors = (await listMigrationIssues(management, drive.id, { phase: "VALIDATE", severity: "ERROR" })).items;
    expect(errors.map((e) => e.field).sort()).toEqual(["ownerEmail", "ownerEmail", "stage"]);

    // Imported deals are audited, and a won import starts no handoff and moves no lifecycle.
    expect(await adminDb.auditEvent.count({ where: { organizationId: org.id, action: "data_migration.imported" } })).toBe(1);
    expect(await adminDb.dealHandoff.count({ where: { organizationId: org.id } })).toBe(0);
    expect(await adminDb.notification.count({ where: { organizationId: org.id } })).toBe(0);
  });

  it("tasks and activities: linked by company name and contact email, with the original dates", async () => {
    const { org, management, sales, salesEmail } = await setup();
    const company = await createCompanyRow(org.id, { name: "Linked Ltd" });
    await adminDb.contact.create({ data: { organizationId: org.id, firstName: "Link", email: "link@example.test", companyId: company.id } });
    const tasks = await prepare(management, { entity: "TASK" }, csv([
      { title: "Send the quote", due: "05/11/2026", assignee: salesEmail, status: "pending", priority: "high", company: "Linked Ltd", created: "20/10/2026" },
      { title: "Old chore", due: "", assignee: "", status: "completed", priority: "", company: "", created: "01/01/2025" },
      { title: "", due: "", assignee: "", status: "", priority: "", company: "", created: "" },
      { title: "Bad status", due: "", assignee: "", status: "later", priority: "", company: "", created: "" },
    ]));
    expect((await tasks.get()).dryRun).toMatchObject({ wouldCreate: 2, errors: 2 });
    await tasks.run();
    const quote = await adminDb.task.findFirstOrThrow({ where: { organizationId: org.id, title: "Send the quote" } });
    expect(quote).toMatchObject({ assigneeMembershipId: sales.membershipId, status: "PENDING", priority: "HIGH", companyId: company.id, importSessionId: tasks.id });
    expect(quote.dueAt?.toISOString().slice(0, 10)).toBe("2026-11-05");
    expect(quote.createdAt.toISOString().slice(0, 10)).toBe("2026-10-20");
    const chore = await adminDb.task.findFirstOrThrow({ where: { organizationId: org.id, title: "Old chore" } });
    expect(chore).toMatchObject({ status: "COMPLETED", assigneeMembershipId: management.membershipId });
    expect(chore.completedAt).not.toBeNull();

    const activities = await prepare(management, { entity: "ACTIVITY" }, csv([
      { type: "call", subject: "Call about the quote", description: "Confirmed", when: "18/10/2026 14:30", outcome: "Reached", author: salesEmail, company: "Linked Ltd", contact: "link@example.test" },
      { type: "note", subject: "", description: "Orphan", when: "18/10/2026", outcome: "", author: "", company: "", contact: "" },
      { type: "dance", subject: "", description: "", when: "18/10/2026", outcome: "", author: "", company: "Linked Ltd", contact: "" },
      { type: "email", subject: "Future", description: "", when: "2099-01-01", outcome: "", author: "", company: "Linked Ltd", contact: "" },
    ]));
    expect((await activities.get()).dryRun).toMatchObject({ wouldCreate: 1, errors: 3 });
    await activities.run();
    const call = await adminDb.activity.findFirstOrThrow({ where: { organizationId: org.id, subject: "Call about the quote" } });
    expect(call).toMatchObject({ type: "CALL", authorMembershipId: sales.membershipId, companyId: company.id, importSessionId: activities.id });
    expect(call.contactId).not.toBeNull();
    expect(call.occurredAt.toISOString()).toBe("2026-10-18T14:30:00.000Z");
  });
});

describe("duplicate handling (B2.04 normalisers)", () => {
  it("SKIP leaves existing records alone and skips repeats inside the file; the report says which row matched what", async () => {
    const { org, management } = await setup();
    const existing = await adminDb.contact.create({ data: { organizationId: org.id, firstName: "Peter", email: "Peter+work@Example.test", phone: "0700 555 123" } });
    const rows = [
      { name: "Peter Mwangi", email: "peter@example.test", phone: "" },
      { name: "Peter M", email: "", phone: "+254 700 555 123" },
      { name: "Fresh Person", email: "fresh@example.test", phone: "0711 000 000" },
      { name: "Fresh Person Again", email: "FRESH@example.test", phone: "" },
    ];
    const drive = await prepare(management, { entity: "CONTACT" }, csv(rows), { duplicatePolicy: "SKIP" });
    const dry = (await drive.get()).dryRun as { wouldCreate: number; wouldSkip: number; duplicates: number };
    expect(dry).toMatchObject({ wouldCreate: 1, wouldSkip: 3, duplicates: 3 });
    const done = await drive.run();
    expect(done.counts).toMatchObject({ created: 1, skipped: 3, duplicates: 3 });
    expect(await adminDb.contact.count({ where: { organizationId: org.id } })).toBe(2);
    const dupes = (await listMigrationIssues(management, drive.id, { phase: "IMPORT", severity: "DUPLICATE" })).items;
    expect(dupes.map((d) => d.row)).toEqual([2, 3, 5]);
    expect(dupes[0]).toMatchObject({ matchedRecordId: existing.id });
    expect(dupes[0]!.message).toContain("same email");
    expect(dupes[1]!.message).toContain("same phone");
  });

  it("running the same file twice with SKIP creates nothing the second time", async () => {
    const { org, management } = await setup();
    const rows = [{ name: "Repeat Co", email: "a@repeat.test" }, { name: "Repeat Two", email: "b@repeat.test" }];
    await (await prepare(management, { entity: "COMPANY" }, csv(rows))).run();
    const second = await prepare(management, { entity: "COMPANY" }, csv(rows));
    expect((await second.get()).dryRun).toMatchObject({ wouldCreate: 0, wouldSkip: 2, duplicates: 2 });
    // Nothing to do, so the import itself is refused rather than run empty.
    await expect(startMigrationImport(management, second.id, { confirm: true })).rejects.toThrow(/nothing to import/);
    expect(await adminDb.company.count({ where: { organizationId: org.id } })).toBe(2);
  });

  it("UPDATE fills in the fields the file carries, never blanks one, and remembers what it changed", async () => {
    const { org, management } = await setup();
    const company = await adminDb.company.create({ data: { organizationId: org.id, name: "Update Ltd", industry: "Old industry", phone: "0700 000 000", notes: "Keep these notes" } });
    const drive = await prepare(management, { entity: "COMPANY" }, csv([{ name: "update ltd", industry: "New industry", phone: "", notes: "", website: "update.test" }]), { duplicatePolicy: "UPDATE" });
    expect((await drive.get()).dryRun).toMatchObject({ wouldUpdate: 1, wouldCreate: 0 });
    const done = await drive.run();
    expect(done.counts).toMatchObject({ updated: 1, created: 0 });
    const after = await adminDb.company.findUniqueOrThrow({ where: { id: company.id } });
    expect(after).toMatchObject({ industry: "New industry", website: "update.test", phone: "0700 000 000", notes: "Keep these notes", name: "Update Ltd" });
    const change = await adminDb.importSessionChange.findFirstOrThrow({ where: { sessionId: drive.id, recordId: company.id } });
    expect(change).toMatchObject({ action: "UPDATED", previous: { before: { industry: "Old industry", website: null }, after: { industry: "New industry", website: "update.test" } } });
  });

  it("CREATE makes the record anyway; tasks and activities have no natural key, so they are only ever created", async () => {
    const { org, management } = await setup();
    await adminDb.company.create({ data: { organizationId: org.id, name: "Twin Ltd" } });
    const created = await prepare(management, { entity: "COMPANY" }, csv([{ name: "Twin Ltd" }]), { duplicatePolicy: "CREATE" });
    expect((await created.run()).counts.created).toBe(1);
    expect(await adminDb.company.count({ where: { organizationId: org.id, name: "Twin Ltd" } })).toBe(2);
  });

  it("an open lead for the same contact is the duplicate of a lead row; a deal with the same company, service, value, stage and date is the duplicate of a deal row", async () => {
    const { org, management, salesEmail } = await setup();
    const status = await adminDb.leadStatus.findFirstOrThrow({ where: { organizationId: org.id, key: "NEW" } });
    const contact = await adminDb.contact.create({ data: { organizationId: org.id, firstName: "Has", email: "has@lead.test" } });
    const lead = await adminDb.lead.create({ data: { organizationId: org.id, leadStatusId: status.id, contactId: contact.id } });
    const leadsDrive = await prepare(management, { entity: "LEAD" }, csv([{ name: "Has Lead", email: "has@lead.test" }, { name: "No Lead", email: "no@lead.test" }]));
    expect((await leadsDrive.get()).dryRun).toMatchObject({ wouldCreate: 1, wouldSkip: 1 });
    expect(((await leadsDrive.get()).dryRun as { sample: { duplicate: { reason: string }[] } }).sample.duplicate[0]!.reason).toContain("open lead");
    void lead;

    const company = await createCompanyRow(org.id, { name: "Dup Deal Co" });
    const stage = await getPipelineStageId(org.id, "NEGOTIATION");
    await adminDb.deal.create({ data: { organizationId: org.id, companyId: company.id, pipelineStageId: stage, ownerMembershipId: management.membershipId, value: 1000, expectedCloseDate: new Date("2026-12-01") } });
    const dealsDrive = await prepare(management, { entity: "DEAL" }, csv([
      { company: "Dup Deal Co", stage: "Negotiation", owner: salesEmail, value: "1000", closedate: "01/12/2026" },
      { company: "Dup Deal Co", stage: "Negotiation", owner: salesEmail, value: "2000", closedate: "01/12/2026" },
    ]));
    expect((await dealsDrive.get()).dryRun).toMatchObject({ wouldCreate: 1, wouldSkip: 1 });
  });
});

describe("the entity catalogue and templates", () => {
  it("describe every kind, its fields and the custom fields, for Management only", async () => {
    const { org, management, sales } = await setup();
    await createCustomFieldDefinition(management, { entityType: "LEAD", key: "budget", label: "Budget", fieldType: "NUMBER" });
    const { items, steps } = await listMigrationEntities(management);
    expect(steps).toHaveLength(7);
    expect(items.map((i) => i.entity)).toEqual([...MIGRATION_ENTITIES]);
    expect(items.find((i) => i.entity === "DEAL")!.fields.find((f) => f.key === "stage")).toMatchObject({ required: true, valueMapping: "stage" });
    expect(items.find((i) => i.entity === "LEAD")!.fields.map((f) => f.key)).toContain("cf:budget");
    expect(items.find((i) => i.entity === "COMPANY")!.fields.map((f) => f.key)).not.toContain("cf:budget");
    expect(getMigrationTemplate(management, "DEAL").split("\n")[0]).toContain("company,contactEmail,value");
    expect(() => getMigrationTemplate(management, "SPACESHIP")).toThrow(ValidationError);
    await expect(listMigrationEntities(sales)).rejects.toThrow(ForbiddenError);
    expect(() => getMigrationTemplate(sales, "DEAL")).toThrow(ForbiddenError);
    void org;
  });

  it("the template file imports as it is", async () => {
    const { management, salesEmail } = await setup();
    for (const entity of ["COMPANY", "CONTACT", "LEAD", "TASK"] as const) {
      const text = getMigrationTemplate(management, entity).replace(/sales@yourcompany\.co\.ke/g, salesEmail);
      const drive = await prepare(management, { entity, sourceKind: "TEMPLATE", createMissingCompanies: true }, Buffer.from(text));
      const dry = (await drive.get()).dryRun as { wouldCreate: number; errors: number };
      expect(dry, entity).toMatchObject({ wouldCreate: 1, errors: 0 });
    }
  });
});

describe("sessions list and detail", () => {
  it("lists the organisation's sessions, newest first, with filters; another organisation sees none of them", async () => {
    const { management } = await setup();
    const a = await startSession(management, { entity: "COMPANY" });
    const b = await startSession(management, { entity: "DEAL" });
    const list = await listMigrationSessions(management);
    expect(list.items.map((s) => s.id)).toEqual([b.id, a.id]);
    expect((await listMigrationSessions(management, { entity: "DEAL" })).items.map((s) => s.id)).toEqual([b.id]);
    expect((await listMigrationSessions(management, { status: "UPLOADED" })).items).toHaveLength(0);
    const other = await createTestContext((await createTestOrganization("MigrationOtherList")).id, "MANAGEMENT", "mig.other2");
    expect((await listMigrationSessions(other)).items).toHaveLength(0);
    await expect(import("../src/services/migrationService").then((m) => m.getMigrationSession(other, a.id))).rejects.toThrow(NotFoundError);
  });
});

describe("spreadsheet upload", () => {
  it("reads the first sheet of an .xlsx (dates, numbers, formulas) and stores it as CSV, then imports like any file", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const { org, management } = await setup();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Companies");
    ws.addRow(["Company Name", "Industry", "Date Added", "Employees"]);
    ws.addRow(["Sheet Co", "Retail", new Date(Date.UTC(2024, 2, 14)), 42]);
    ws.addRow(["Formula Co", "Hardware", new Date(Date.UTC(2025, 0, 2)), { formula: "20+22", result: 42 }]);
    wb.addWorksheet("Ignored").addRow(["not", "read"]);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());

    const drive = await startSession(management, { entity: "COMPANY" });
    const uploaded = await drive.upload("companies.xlsx", buffer);
    expect(uploaded.session.file).toMatchObject({ name: "companies.csv", headers: ["Company Name", "Industry", "Date Added", "Employees"], rows: 2 });
    expect(uploaded.suggestedMapping).toMatchObject({ name: "Company Name", industry: "Industry", createdAt: "Date Added" });
    await drive.map({ mapping: uploaded.suggestedMapping });
    await drive.validate();
    await drive.dryRun();
    expect((await drive.run()).counts.created).toBe(2);
    expect((await adminDb.company.findFirstOrThrow({ where: { organizationId: org.id, name: "Sheet Co" } })).createdAt.toISOString().slice(0, 10)).toBe("2024-03-14");
  });

  it("refuses an .xlsx that is not a real workbook, and one that is too wide", async () => {
    const { management } = await setup();
    const drive = await startSession(management, { entity: "COMPANY" });
    await expect(drive.upload("fake.xlsx", Buffer.from("PK\u0003\u0004 definitely not a workbook"))).rejects.toThrow(/could not be read/);
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Wide").addRow(Array.from({ length: 101 }, (_, i) => `c${i}`));
    await expect(drive.upload("wide.xlsx", Buffer.from(await wb.xlsx.writeBuffer()))).rejects.toThrow(/At most 100 columns/);
  });
});
