import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import * as importService from "../src/services/importService";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";

/**
 * Lead import takes a row with whatever it has (Sales request, 17 Nov 2026, from a real schools sheet): the company is linked or created, the
 * email and phone are saved on a contact, notes are kept, and a value the organisation does not have yet (source, service, status, owner,
 * temperature word) is left at its default and reported as a note to add later. Only an empty row is refused.
 */

const stream = (csv: string) => Readable.from([csv]);
const SCHOOLS =
  "School Name,Email Address,Phone Number,Urgency Level,Client Feedback,Status\n" +
  "Embakasi Benedicta Academy,admin@ebenedictaacademy.co.ke,254 110 380 560,Medium,,New\n" +
  'Rockside academy,info@rocksideacademy.sc.ke,254 734 808 355 / 254 718 164 141,Medium,"Wants a quote, call after 2",New\n' +
  "Green Edgewood Academy,greenedgewood.academy@gmail.com,254 759 285 800,High,,New\n" +
  "No Contact School,,,Low,,New\n" +
  "Bad Email School,not-an-email,254 700 000 001,Sparkly,,New\n";
const MAPPING = { company: "School Name", contactEmail: "Email Address", contactPhone: "Phone Number", temperature: "Urgency Level", notes: "Client Feedback", leadStatus: "Status" };

async function setup(role: "SALES" | "MANAGEMENT" = "SALES") {
  const org = await createTestOrganization();
  const ctx = await createTestContext(org.id, role, "importer");
  return { org, ctx };
}

describe("lead import: a row comes in with what it has", () => {
  it("creates the companies and contacts, keeps email, phone and notes, and maps urgency words to temperature", async () => {
    const { org, ctx } = await setup();
    const summary = await importService.importLeads(ctx, { fileStream: stream(SCHOOLS), mapping: MAPPING, duplicateStrategy: "skip" });
    expect(summary.created).toBe(5);
    expect(summary.failed).toBe(0);

    const leads = await adminDb.lead.findMany({ where: { organizationId: org.id }, include: { company: true, contact: true } });
    const byCompany = (name: string) => leads.find((l) => l.company?.name === name)!;
    expect(await adminDb.company.count({ where: { organizationId: org.id } })).toBe(5);

    const rock = byCompany("Rockside academy");
    expect(rock.contact?.email).toBe("info@rocksideacademy.sc.ke");
    expect(rock.contact?.phone).toBe("254 734 808 355");
    expect(rock.contact?.notes).toContain("254 718 164 141");
    expect(rock.contact?.companyId).toBe(rock.companyId);
    expect(rock.notes).toBe("Wants a quote, call after 2");
    expect(rock.temperature).toBe("WARM");
    expect(rock.ownerMembershipId).toBe(ctx.membershipId);
    expect(byCompany("Green Edgewood Academy").temperature).toBe("HOT");
    expect(byCompany("No Contact School").temperature).toBe("COLD");
  });

  it("tells the importer what to add later, row by row, without failing the row", async () => {
    const { ctx } = await setup();
    const summary = await importService.importLeads(ctx, { fileStream: stream(SCHOOLS), mapping: MAPPING, duplicateStrategy: "skip" });
    const notes = summary.errors.filter((e) => e.outcome === "warning");
    expect(summary.errors.every((e) => e.outcome === "warning")).toBe(true);
    expect(notes.some((n) => n.row === 5 && /no email or phone/.test(n.reason))).toBe(true);
    expect(notes.some((n) => n.row === 6 && /not a valid email/.test(n.reason))).toBe(true);
    expect(notes.some((n) => n.row === 6 && /"Sparkly" is not a temperature/.test(n.reason))).toBe(true);
  });

  it("links a company that already exists instead of making a second one, and reuses a contact with the same email", async () => {
    const { org, ctx } = await setup();
    const company = await adminDb.company.create({ data: { organizationId: org.id, name: "Rockside Academy" } });
    const contact = await adminDb.contact.create({ data: { organizationId: org.id, firstName: "Mary", email: "info@rocksideacademy.sc.ke", companyId: company.id } });
    // With "skip duplicates" a person who is already in the CRM is reported as known; "create anyway" adds the lead to the existing records.
    const skipped = await importService.importLeads(ctx, { fileStream: stream(SCHOOLS), mapping: MAPPING, duplicateStrategy: "skip" });
    expect(skipped.errors.some((e) => e.outcome === "duplicate" && e.row === 3)).toBe(true);
    await adminDb.lead.deleteMany({ where: { organizationId: org.id } });
    await importService.importLeads(ctx, { fileStream: stream(SCHOOLS), mapping: MAPPING, duplicateStrategy: "create" });
    expect(await adminDb.company.count({ where: { organizationId: org.id, name: { equals: "Rockside Academy", mode: "insensitive" } } })).toBe(1);
    const lead = await adminDb.lead.findFirstOrThrow({ where: { organizationId: org.id, companyId: company.id } });
    expect(lead.contactId).toBe(contact.id);
  });

  it("makes one company however many rows name it", async () => {
    const { org, ctx } = await setup();
    const rows = ["Company,Email", ...Array.from({ length: 6 }, (_, i) => `Shared School,person${i}@shared.sc.ke`)].join("\n");
    const summary = await importService.importLeads(ctx, { fileStream: stream(rows), mapping: { company: "Company", contactEmail: "Email" }, duplicateStrategy: "create" });
    expect(summary.created).toBe(6);
    expect(await adminDb.company.count({ where: { organizationId: org.id, name: "Shared School" } })).toBe(1);
  });

  it("leaves an unknown source, service and owner blank or with the importer, each with a note", async () => {
    const { org, ctx } = await setup();
    const summary = await importService.importLeads(ctx, {
      fileStream: stream("Company,Source,Service,Owner\nOdd Co,Carrier Pigeon,Teleportation,nobody@example.com\n"),
      mapping: { company: "Company", leadSource: "Source", serviceInterest: "Service", ownerEmail: "Owner" },
      duplicateStrategy: "skip",
    });
    expect(summary.created).toBe(1);
    const reasons = summary.errors.map((e) => e.reason).join(" | ");
    expect(reasons).toMatch(/source "Carrier Pigeon"/);
    expect(reasons).toMatch(/service "Teleportation"/);
    expect(reasons).toMatch(/nobody@example.com/);
    const lead = await adminDb.lead.findFirstOrThrow({ where: { organizationId: org.id } });
    expect(lead.leadSourceId).toBeNull();
    expect(lead.serviceInterestId).toBeNull();
    expect(lead.ownerMembershipId).toBe(ctx.membershipId);
  });

  it("still refuses an empty row, and still stops a role that may not assign from handing a lead to someone else", async () => {
    const { ctx } = await setup();
    const empty = await importService.importLeads(ctx, { fileStream: stream("Company,Email\n,\nReal Co,\n"), mapping: { company: "Company", contactEmail: "Email" }, duplicateStrategy: "skip" });
    expect(empty.created).toBe(1);
    expect(empty.failed).toBe(1);
    expect(empty.errors.find((e) => e.outcome === "failed")?.reason).toMatch(/empty/);
  });

  it("skips a second run of the same file as duplicates instead of creating everything again", async () => {
    const { org, ctx } = await setup();
    await importService.importLeads(ctx, { fileStream: stream(SCHOOLS), mapping: MAPPING, duplicateStrategy: "skip" });
    const again = await importService.importLeads(ctx, { fileStream: stream(SCHOOLS), mapping: MAPPING, duplicateStrategy: "skip" });
    expect(again.failed).toBe(0);
    expect(again.duplicatesSkipped).toBeGreaterThanOrEqual(3);
    expect(await adminDb.company.count({ where: { organizationId: org.id } })).toBe(5);
  });

  it("is isolated by organisation: another organisation's company of the same name is not linked", async () => {
    const { ctx } = await setup();
    const other = await createTestOrganization();
    const theirs = await adminDb.company.create({ data: { organizationId: other.id, name: "Rockside academy" } });
    await importService.importLeads(ctx, { fileStream: stream(SCHOOLS), mapping: MAPPING, duplicateStrategy: "skip" });
    expect(await adminDb.lead.count({ where: { companyId: theirs.id } })).toBe(0);
  });
});
