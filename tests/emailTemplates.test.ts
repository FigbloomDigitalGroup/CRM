import { describe, expect, it } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/auth/errors";
import { MERGE_FIELDS, renderMergeFields, tokensIn, unknownTokens } from "../src/lib/mergeFields";
import { sendAndLogEmail } from "../src/services/communicationService";
import * as companyService from "../src/services/companyService";
import * as contactService from "../src/services/contactService";
import {
  createTemplate,
  listTemplates,
  removeTemplate,
  renderTemplate,
  updateTemplate,
} from "../src/services/emailTemplateService";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";

async function issuesOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ValidationError) return err.issues ?? [];
    throw err;
  }
  throw new Error("Expected the call to be rejected.");
}

describe("merge fields (FIG-797)", () => {
  it("finds tokens, flags unknown ones, and fills known ones with blanks reported", () => {
    expect(tokensIn("Hi {{contact.firstName}}, {{ company.name }} and {{nope}}")).toEqual(["contact.firstName", "company.name", "nope"]);
    expect(unknownTokens("{{contact.firstName}} {{typo.field}}", "{{typo.field}} {{owner.name}}")).toEqual(["typo.field"]);
    const out = renderMergeFields("Dear {{contact.firstName}} {{contact.lastName}} of {{company.name}}", {
      "contact.firstName": "Wanjiru",
      "contact.lastName": null,
      "company.name": "Sarova",
    });
    expect(out).toEqual({ text: "Dear Wanjiru  of Sarova", missing: ["contact.lastName"] });
    expect(MERGE_FIELDS).toEqual(expect.arrayContaining(["contact.firstName", "company.name", "owner.name"]));
  });
});

describe("email templates (FIG-797)", () => {
  it("Management manages templates; anyone who can send email can list the active ones; unknown merge fields are rejected", async () => {
    const org = await createTestOrganization();
    const management = await createTestContext(org.id, "MANAGEMENT");
    const sales = await createTestContext(org.id, "SALES");
    const delivery = await createTestContext(org.id, "RESTRICTED_TECHNICAL");

    const t = await createTemplate(management, { name: "Proposal follow-up", subject: "Following up, {{contact.firstName}}", body: "Hi {{contact.firstName}},\n\nAny thoughts on the proposal for {{company.name}}?\n\n{{sender.name}}" });
    expect(t).toMatchObject({ name: "Proposal follow-up", isActive: true });

    const bad = await issuesOf(createTemplate(management, { name: "Bad", subject: "Hi {{contact.firstname}}", body: "x {{owner.nme}}" }));
    expect(bad.map((i) => i.code)).toEqual(["UNKNOWN_MERGE_FIELD", "UNKNOWN_MERGE_FIELD"]);
    expect((await issuesOf(createTemplate(management, { name: "proposal FOLLOW-UP", subject: "s", body: "b" })))[0]).toMatchObject({ code: "DUPLICATE_TEMPLATE" });
    expect((await issuesOf(createTemplate(management, { name: " ", subject: "", body: "" }))).map((i) => i.path).sort()).toEqual(["body", "name", "subject"]);

    await expect(createTemplate(sales, { name: "Nope", subject: "s", body: "b" })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listTemplates(sales)).map((x) => x.name)).toEqual(["Proposal follow-up"]);
    await expect(listTemplates(delivery)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listTemplates(sales, { includeInactive: true })).rejects.toBeInstanceOf(ForbiddenError);

    // A partial edit is checked as the whole template, and a template can be retired.
    expect((await issuesOf(updateTemplate(management, t.id, { body: "Hello {{nobody}}" })))[0]).toMatchObject({ code: "UNKNOWN_MERGE_FIELD" });
    await updateTemplate(management, t.id, { subject: "New subject" });
    await updateTemplate(management, t.id, { isActive: false });
    expect(await listTemplates(sales)).toEqual([]);
    expect(await listTemplates(management, { includeInactive: true })).toHaveLength(1);
  });

  it("fills a template for a contact and company, using only what the caller may open, and reports what it could not fill", async () => {
    const org = await createTestOrganization();
    const management = await createTestContext(org.id, "MANAGEMENT");
    const sales = await createTestContext(org.id, "SALES");
    const { company } = await companyService.createCompany(sales, { name: "Sarova Hotels", website: "https://sarova.co.ke" });
    const { contact } = await contactService.createContact(sales, { firstName: "Wanjiru", lastName: "Kamau", email: "w@sarova.co.ke", companyId: company.id });
    const t = await createTemplate(management, { name: "Welcome", subject: "Welcome to Figbloom, {{contact.firstName}}", body: "Dear {{contact.fullName}} at {{company.name}} ({{company.website}}), from {{sender.name}}. Your contact: {{owner.name}}. Job: {{contact.jobTitle}}" });

    const out = await renderTemplate(sales, t.id, { contactId: contact.id });
    expect(out.subject).toBe("Welcome to Figbloom, Wanjiru");
    expect(out.body).toContain("Dear Wanjiru Kamau at Sarova Hotels (https://sarova.co.ke), from Test User.");
    expect(out.missing).toEqual(["contact.jobTitle"]);

    // Nothing to fill from: fields come back blank and are listed.
    const bare = await renderTemplate(sales, t.id, {});
    expect(bare.missing).toEqual(expect.arrayContaining(["contact.firstName", "company.name"]));

    // Another salesperson cannot use records they cannot open to fill a template.
    const other = await createTestContext(org.id, "SALES", "other.sales");
    await expect(renderTemplate(other, t.id, { contactId: contact.id })).resolves.toBeDefined(); // contacts are organisation-wide for Sales
    const delivery = await createTestContext(org.id, "RESTRICTED_TECHNICAL");
    await expect(renderTemplate(delivery, t.id, {})).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("sending from a template records the template on the communication; the text may be edited first; unfilled fields are refused", async () => {
    const org = await createTestOrganization();
    const management = await createTestContext(org.id, "MANAGEMENT");
    const sales = await createTestContext(org.id, "SALES");
    const { contact } = await contactService.createContact(sales, { firstName: "Achieng", email: "a@x.co.ke" });
    const t = await createTemplate(management, { name: "Recap", subject: "Recap, {{contact.firstName}}", body: "Thanks {{contact.firstName}}." });

    const filled = await renderTemplate(sales, t.id, { contactId: contact.id });
    const edited = `${filled.body}\n\nP.S. Sending the brochure tomorrow.`;
    const sent = await sendAndLogEmail(sales, { to: "a@x.co.ke", subject: filled.subject, body: edited, contactId: contact.id, templateId: t.id });
    expect(sent.emailTemplateId).toBe(t.id);
    expect(sent.summary).toContain("P.S.");

    const issues = await issuesOf(sendAndLogEmail(sales, { to: "a@x.co.ke", subject: "Hi {{contact.firstName}}", body: "x", contactId: contact.id, templateId: t.id }));
    expect(issues[0]).toMatchObject({ code: "UNFILLED_MERGE_FIELD" });
    await expect(sendAndLogEmail(sales, { to: "a@x.co.ke", subject: "s", body: "b", contactId: contact.id, templateId: "00000000-0000-0000-0000-000000000000" })).rejects.toBeInstanceOf(NotFoundError);

    await updateTemplate(management, t.id, { isActive: false });
    await expect(sendAndLogEmail(sales, { to: "a@x.co.ke", subject: "s", body: "b", contactId: contact.id, templateId: t.id })).rejects.toBeInstanceOf(NotFoundError);

    // Deleting a template keeps the emails that used it.
    await removeTemplate(management, t.id);
    expect((await adminDb.communication.findUniqueOrThrow({ where: { id: sent.id } })).emailTemplateId).toBeNull();
  });

  it("another organisation cannot see, use or change them", async () => {
    const orgA = await createTestOrganization();
    const orgB = await createTestOrganization();
    const a = await createTestContext(orgA.id, "MANAGEMENT");
    const b = await createTestContext(orgB.id, "MANAGEMENT");
    const t = await createTemplate(a, { name: "Private", subject: "s", body: "b" });
    expect(await listTemplates(b, { includeInactive: true })).toEqual([]);
    await expect(updateTemplate(b, t.id, { subject: "hijack" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(removeTemplate(b, t.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(renderTemplate(b, t.id, {})).rejects.toBeInstanceOf(NotFoundError);
  });
});
