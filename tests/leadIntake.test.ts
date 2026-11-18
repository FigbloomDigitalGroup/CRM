import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { quickCapture } from "../src/services/quickCaptureService";
import { createLeadFromForm } from "../src/services/leadIntakeService";
import { createTestContext, createTestOrganization, getLeadStatusId } from "./helpers/fixtures";

vi.mock("../src/services/teamActivityNotifier", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/teamActivityNotifier")>();
  return { ...actual, emitTeamActivity: vi.fn(actual.emitTeamActivity) };
});
import { emitTeamActivity } from "../src/services/teamActivityNotifier";

/** FIG-1675 (P2-21): a new lead saves its company and contact together, once, with the person's role. */

async function setup() {
  const org = await createTestOrganization("LeadIntake");
  const sales = await createTestContext(org.id, "SALES", "li.sales");
  const statusId = await getLeadStatusId(org.id, "NEW");
  return { org, sales, statusId };
}

const counts = async (orgId: string) => ({
  leads: await adminDb.lead.count({ where: { organizationId: orgId } }),
  contacts: await adminDb.contact.count({ where: { organizationId: orgId } }),
  companies: await adminDb.company.count({ where: { organizationId: orgId } }),
});

beforeEach(() => {
  vi.mocked(emitTeamActivity).mockClear();
});

describe("new lead with company, email and role", () => {
  it("creates the company and the contact, links both to the lead, and stores the role and a lower-cased email", async () => {
    const { org, sales, statusId } = await setup();
    const res = await createLeadFromForm(sales, { leadStatusId: statusId, newCompanyName: "  Sarova Hotels ", contact: { name: "Amara Osei", email: " Amara@Sarova.COM ", phone: "0722000111", role: "Procurement manager" } });
    const lead = await adminDb.lead.findUniqueOrThrow({ where: { id: res.lead.id }, include: { company: true, contact: true } });
    expect(lead.company?.name).toBe("Sarova Hotels");
    expect(lead.contact).toMatchObject({ firstName: "Amara", lastName: "Osei", email: "amara@sarova.com", phone: "0722000111", jobTitle: "Procurement manager", companyId: lead.companyId });
    expect(lead.ownerMembershipId).toBe(sales.membershipId);
    const audits = await adminDb.auditEvent.findMany({ where: { organizationId: org.id, action: { in: ["company.created", "contact.created", "lead.created"] } } });
    expect(audits.map((a) => a.action).sort()).toEqual(["company.created", "contact.created", "lead.created"]);
  });

  it("links an existing company and reuses an existing contact by email, without changing either or duplicating", async () => {
    const { org, sales, statusId } = await setup();
    const company = await adminDb.company.create({ data: { organizationId: org.id, name: "Known Ltd", phone: "111" } });
    const first = await createLeadFromForm(sales, { leadStatusId: statusId, companyId: company.id, contact: { name: "Jo Mwangi", email: "jo@known.com", role: "Owner" } });
    const second = await createLeadFromForm(sales, { leadStatusId: statusId, companyId: company.id, contact: { name: "Someone Else", email: "JO@known.com", role: "Finance" } });
    expect(second.contactReused).toBe(true);
    expect(await counts(org.id)).toEqual({ leads: 2, contacts: 1, companies: 1 });
    const a = await adminDb.lead.findUniqueOrThrow({ where: { id: first.lead.id } });
    const b = await adminDb.lead.findUniqueOrThrow({ where: { id: second.lead.id } });
    expect(b.contactId).toBe(a.contactId);
    const contact = await adminDb.contact.findUniqueOrThrow({ where: { id: a.contactId! } });
    expect(contact).toMatchObject({ firstName: "Jo", jobTitle: "Owner" });
  });

  it("links a company that already has the typed name instead of creating a second one", async () => {
    const { org, sales, statusId } = await setup();
    await adminDb.company.create({ data: { organizationId: org.id, name: "Acme Ltd" } });
    const res = await createLeadFromForm(sales, { leadStatusId: statusId, newCompanyName: "acme ltd", contact: { name: "Pat Doe" } });
    expect(res.companyReused).toBe(true);
    expect((await counts(org.id)).companies).toBe(1);
  });

  it("refuses an invalid email and saves nothing", async () => {
    const { org, sales, statusId } = await setup();
    await expect(createLeadFromForm(sales, { leadStatusId: statusId, newCompanyName: "X Ltd", contact: { name: "Pat", email: "not-an-email" } })).rejects.toBeInstanceOf(ValidationError);
    expect(await counts(org.id)).toEqual({ leads: 0, contacts: 0, companies: 0 });
  });

  it("refuses a company id from another organisation", async () => {
    const { org, sales, statusId } = await setup();
    const other = await createTestOrganization("LeadIntakeOther");
    const foreign = await adminDb.company.create({ data: { organizationId: other.id, name: "Foreign Ltd" } });
    await expect(createLeadFromForm(sales, { leadStatusId: statusId, companyId: foreign.id, contact: { name: "Pat", email: "pat@x.com" } })).rejects.toBeInstanceOf(ValidationError);
    expect(await counts(org.id)).toEqual({ leads: 0, contacts: 0, companies: 0 });
  });

  it("does not reuse a contact from another organisation that has the same email", async () => {
    const { org, sales, statusId } = await setup();
    const other = await createTestOrganization("LeadIntakeOther2");
    await adminDb.contact.create({ data: { organizationId: other.id, firstName: "Far", email: "same@x.com" } });
    const res = await createLeadFromForm(sales, { leadStatusId: statusId, contact: { name: "Near", email: "same@x.com" } });
    expect(res.contactReused).toBe(false);
    expect((await counts(org.id)).contacts).toBe(1);
  });

  it("rolls the whole action back when a step fails", async () => {
    const { org, sales, statusId } = await setup();
    // A membership that does not exist makes the contact insert fail after the company was inserted.
    const broken = { ...sales, membershipId: "00000000-0000-0000-0000-000000000000" };
    await expect(createLeadFromForm(broken, { leadStatusId: statusId, newCompanyName: "Rollback Ltd", contact: { name: "Pat", email: "pat@rb.com" } })).rejects.toBeTruthy();
    expect(await counts(org.id)).toEqual({ leads: 0, contacts: 0, companies: 0 });
  });

  it("explains a missing right and writes nothing: creating a lead does not imply creating a contact or company", async () => {
    const { org, sales, statusId } = await setup();
    const noContacts = { ...sales, permissionKeys: sales.permissionKeys.filter((k) => k !== "contacts.create") };
    await expect(createLeadFromForm(noContacts, { leadStatusId: statusId, newCompanyName: "A Ltd", contact: { name: "Pat", email: "pat@a.com" } })).rejects.toBeInstanceOf(ForbiddenError);
    const noCompanies = { ...sales, permissionKeys: sales.permissionKeys.filter((k) => k !== "companies.create") };
    await expect(createLeadFromForm(noCompanies, { leadStatusId: statusId, newCompanyName: "B Ltd", contact: { name: "Pat" } })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await counts(org.id)).toEqual({ leads: 0, contacts: 0, companies: 0 });
    // Linking existing records needs neither right.
    const company = await adminDb.company.create({ data: { organizationId: org.id, name: "C Ltd" } });
    await adminDb.contact.create({ data: { organizationId: org.id, firstName: "Old", email: "old@c.com" } });
    await expect(createLeadFromForm(noContacts, { leadStatusId: statusId, companyId: company.id, contact: { name: "Old", email: "old@c.com" } })).resolves.toBeTruthy();
  });

  it("sends one team alert for the action, not one each for the lead, contact and company", async () => {
    const { sales, statusId } = await setup();
    await createLeadFromForm(sales, { leadStatusId: statusId, newCompanyName: "Alert Ltd", contact: { name: "Pat Doe", email: "pat@alert.com" } });
    const keys = vi.mocked(emitTeamActivity).mock.calls.map((c) => c[0].eventKey);
    expect(keys).toEqual(["LEAD_CREATED"]);
  });

  it("without the new fields behaves as before", async () => {
    const { org, sales, statusId } = await setup();
    const company = await adminDb.company.create({ data: { organizationId: org.id, name: "Plain Ltd" } });
    const res = await createLeadFromForm(sales, { leadStatusId: statusId, companyId: company.id });
    expect(res.lead.companyId).toBe(company.id);
    expect((await counts(org.id)).contacts).toBe(0);
  });
});

describe("quick capture with a role", () => {
  it("stores the role on the contact linked to the company", async () => {
    const { org, sales } = await setup();
    const company = await adminDb.company.create({ data: { organizationId: org.id, name: "Roles Ltd" } });
    const res = await quickCapture(sales, { name: "Rita Njoroge", phone: "0711222333", company: "Roles Ltd", role: "Decision maker" });
    if (res.status !== "CREATED") throw new Error("expected CREATED");
    const contact = await adminDb.contact.findUniqueOrThrow({ where: { id: res.contact.id } });
    expect(contact).toMatchObject({ jobTitle: "Decision maker", companyId: company.id });
  });
});
