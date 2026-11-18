import { describe, expect, it } from "vitest";
import { UnauthorizedError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { createCompany } from "../src/services/companyService";
import { createContact } from "../src/services/contactService";
import {
  regenerateInboundEmailKey,
  revokeInboundEmailKey,
} from "../src/services/integrationService";
import { ingestInboundEmail } from "../src/services/inboundEmailService";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";

describe("inboundEmailService: ingestInboundEmail", () => {
  it("rejects a missing or wrong token", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    await regenerateInboundEmailKey(ctx);

    await expect(
      ingestInboundEmail(org.slug, null, { from: "jane@example.test" }),
    ).rejects.toThrow(UnauthorizedError);
    await expect(
      ingestInboundEmail(org.slug, "iek_live_wrong", { from: "jane@example.test" }),
    ).rejects.toThrow(UnauthorizedError);
  });

  it("rejects once the token has been revoked", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const { token } = await regenerateInboundEmailKey(ctx);
    await revokeInboundEmailKey(ctx);

    await expect(
      ingestInboundEmail(org.slug, token, { from: "jane@example.test" }),
    ).rejects.toThrow(UnauthorizedError);
  });

  it("keeps a message from a sender matching no contact in the Needs-linking queue, and still succeeds", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const { token } = await regenerateInboundEmailKey(ctx);

    const result = await ingestInboundEmail(org.slug, token, {
      from: "unknown@example.test",
      subject: "Hi",
      text: "Hello there",
    });
    expect(result).toMatchObject({ logged: true, needsLinking: true });
    const waiting = await adminDb.communication.findUniqueOrThrow({ where: { id: result.communicationId! } });
    expect(waiting).toMatchObject({ needsLinking: true, counterpartyEmail: "unknown@example.test", contactId: null, companyId: null, direction: "INBOUND" });
  });

  it("never stores the same message twice when the provider retries", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const { token } = await regenerateInboundEmailKey(ctx);
    const payload = { from: "Pat Lee <pat@example.test>", subject: "Hi", text: "Hello", messageId: "<retry-1@mail.example.test>" };
    const first = await ingestInboundEmail(org.slug, token, payload);
    const second = await ingestInboundEmail(org.slug, token, payload);
    expect(second).toMatchObject({ logged: true, duplicate: true, communicationId: first.communicationId });
    expect(await adminDb.communication.count({ where: { organizationId: org.id } })).toBe(1);
    expect((await adminDb.communication.findUniqueOrThrow({ where: { id: first.communicationId! } })).counterpartyName).toBe("Pat Lee");
  });

  it("logs an inbound communication linked to the matching contact and company, with no author", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const { token } = await regenerateInboundEmailKey(ctx);
    const { company } = await createCompany(ctx, { name: "Acme Ltd" });
    const { contact } = await createContact(ctx, {
      firstName: "Jane",
      email: "jane@example.test",
      companyId: company.id,
    });

    const result = await ingestInboundEmail(org.slug, token, {
      from: "Jane Doe <jane@example.test>",
      subject: "Re: proposal",
      text: "Looks good, thanks!",
      messageId: "<abc123@mail.example.test>",
    });
    expect(result.logged).toBe(true);

    const communication = await adminDb.communication.findUniqueOrThrow({
      where: { id: result.communicationId! },
    });
    expect(communication.direction).toBe("INBOUND");
    expect(communication.channel).toBe("EMAIL");
    expect(communication.contactId).toBe(contact.id);
    expect(communication.companyId).toBe(company.id);
    expect(communication.authorMembershipId).toBeNull();
    expect(communication.externalReference).toBe("<abc123@mail.example.test>");
  });

  it("updates lastUsedAt on the inbound email key after a successful call", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    const { token } = await regenerateInboundEmailKey(ctx);

    await ingestInboundEmail(org.slug, token, { from: "unknown@example.test" });

    const record = await adminDb.inboundEmailKey.findUniqueOrThrow({
      where: { organizationId: org.id },
    });
    expect(record.lastUsedAt).not.toBeNull();
  });
});
