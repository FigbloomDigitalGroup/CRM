import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { ForbiddenError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import * as importService from "../src/services/importService";
import { createCompany, listCompanies } from "../src/services/companyService";
import { listContacts } from "../src/services/contactService";
import { listLeads } from "../src/services/leadService";
import {
  createTestContext,
  createTestMembership,
  createTestOrganization,
  getLeadStatusId,
} from "./helpers/fixtures";

function csvStream(content: string): Readable {
  return Readable.from([content]);
}

describe("importService: companies", () => {
  it("rejects import for a role without companies.import", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");

    await expect(
      importService.importCompanies(ctx, {
        fileStream: csvStream("Name\nAcme\n"),
        mapping: { name: "Name" },
        duplicateStrategy: "skip",
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("creates companies, resolving owner by email and lifecycle state by name", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const { user: owner } = await createTestMembership(
      org.id,
      "SALES",
      "import.owner",
    );
    const lifecycleState = await adminDb.customerLifecycleState.findFirstOrThrow({
      where: { organizationId: org.id },
    });

    const csv = `Name,Email,Owner,Lifecycle\nAcme Ltd,hello@acme.test,${owner.email},${lifecycleState.name}\n`;
    const summary = await importService.importCompanies(ctx, {
      fileStream: csvStream(csv),
      mapping: { name: "Name", email: "Email", ownerEmail: "Owner", lifecycleState: "Lifecycle" },
      duplicateStrategy: "skip",
    });

    expect(summary).toMatchObject({ totalRows: 1, created: 1, failed: 0, duplicatesSkipped: 0 });

    const companies = await listCompanies(ctx);
    expect(companies).toHaveLength(1);
    expect(companies[0]!.name).toBe("Acme Ltd");
    expect(companies[0]!.lifecycleStateId).toBe(lifecycleState.id);

    const auditEvents = await adminDb.auditEvent.findMany({
      where: { organizationId: org.id, action: "companies.imported" },
    });
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]!.metadata).toMatchObject({ created: 1 });
  });

  it("reports a per-row validation error without aborting the rest of the file", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");

    // A fully blank line would be dropped by skip_empty_lines, so the
    // "invalid" row still has a populated second column -- only Name is empty.
    const csv = `Name,Email\n,blank@example.test\nValid Co,valid@example.test\n`;
    const summary = await importService.importCompanies(ctx, {
      fileStream: csvStream(csv),
      mapping: { name: "Name", email: "Email" },
      duplicateStrategy: "skip",
    });

    expect(summary.created).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]!.row).toBe(2);
  });

  it("skips a row that matches an existing company by default, and creates it anyway with duplicateStrategy 'create'", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");

    await importService.importCompanies(ctx, {
      fileStream: csvStream("Name,Email\nAcme Ltd,hello@acme.test\n"),
      mapping: { name: "Name", email: "Email" },
      duplicateStrategy: "skip",
    });

    const skipped = await importService.importCompanies(ctx, {
      fileStream: csvStream("Name,Email\nAcme Ltd,hello@acme.test\n"),
      mapping: { name: "Name", email: "Email" },
      duplicateStrategy: "skip",
    });
    expect(skipped).toMatchObject({ created: 0, duplicatesSkipped: 1 });

    const forced = await importService.importCompanies(ctx, {
      fileStream: csvStream("Name,Email\nAcme Ltd,hello@acme.test\n"),
      mapping: { name: "Name", email: "Email" },
      duplicateStrategy: "create",
    });
    expect(forced).toMatchObject({ created: 1, duplicatesSkipped: 0 });

    const companies = await listCompanies(ctx, { query: "Acme" });
    expect(companies).toHaveLength(2);
  });
});

describe("importService: contacts", () => {
  it("links a contact to an existing company by exact name, and errors when the company is not found", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const { company } = await createCompany(ctx, { name: "Acme Ltd" });

    const summary = await importService.importContacts(ctx, {
      fileStream: csvStream(
        `FirstName,Company\nJane,Acme Ltd\nJohn,Nonexistent Co\n`,
      ),
      mapping: { firstName: "FirstName", company: "Company" },
      duplicateStrategy: "skip",
    });

    expect(summary.created).toBe(1);
    expect(summary.failed).toBe(1);

    const contacts = await listContacts(ctx);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]!.companyId).toBe(company.id);
  });
});

describe("importService: leads", () => {
  it("requires a resolvable lead status and validates temperature", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const statusId = await getLeadStatusId(org.id);
    const status = await adminDb.leadStatus.findUniqueOrThrow({ where: { id: statusId } });

    const summary = await importService.importLeads(ctx, {
      fileStream: csvStream(
        `Status,Temperature\n${status.name},HOT\nUnknownStatus,HOT\n${status.name},SPICY\n`,
      ),
      mapping: { leadStatus: "Status", temperature: "Temperature" },
      duplicateStrategy: "skip",
    });

    expect(summary.created).toBe(1);
    expect(summary.failed).toBe(2);

    const leads = await listLeads(ctx);
    expect(leads).toHaveLength(1);
    expect(leads[0]!.temperature).toBe("HOT");
  });
});
