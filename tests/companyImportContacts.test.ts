import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import * as importService from "../src/services/importService";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";

/**
 * A company import keeps each row's email and phone as a contact on the new company (Sales, 18 Nov 2026: 24 schools were imported with no contacts).
 */
const csv = (text: string) => Readable.from([text]);
const MAPPING = { name: "Company or person", email: "Email", phone: "Phone" };
const FILE =
  "Company or person,Email,Phone\n" +
  "Diamond Junior School,info@diamondjunior.com,0715 591 879\n" +
  "The Ark Junior School,Available on website,0713 769 176 / 0728 676 000\n" +
  "St Bakhita School,,\n";

describe("company import creates a contact from the row's email and phone", () => {
  it("makes a contact for a row with an email or phone, uses the first phone number, and none for an empty row", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT", "importer");
    const summary = await importService.importCompanies(ctx, { fileStream: csv(FILE), mapping: MAPPING, duplicateStrategy: "skip" });
    expect(summary.created).toBe(3);

    const contacts = await adminDb.contact.findMany({ where: { organizationId: org.id }, include: { company: true } });
    expect(contacts).toHaveLength(2);
    const diamond = contacts.find((c) => c.company?.name === "Diamond Junior School")!;
    expect(diamond.email).toBe("info@diamondjunior.com");
    expect(diamond.phone).toBe("0715 591 879");
    const ark = contacts.find((c) => c.company?.name === "The Ark Junior School")!;
    expect(ark.email).toBeNull(); // "Available on website" is not an email
    expect(ark.phone).toBe("0713 769 176");
    expect(ark.notes).toContain("0728 676 000");
  });

  it("does not make a second contact when the organisation already has one with that email", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT", "importer");
    await adminDb.contact.create({ data: { organizationId: org.id, firstName: "Existing", email: "info@diamondjunior.com" } });
    await importService.importCompanies(ctx, { fileStream: csv(FILE), mapping: MAPPING, duplicateStrategy: "skip" });
    expect(await adminDb.contact.count({ where: { organizationId: org.id, email: "info@diamondjunior.com" } })).toBe(1);
  });
});
