import { afterEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { createCompany } from "../src/services/companyService";
import { createContact } from "../src/services/contactService";
import * as communicationService from "../src/services/communicationService";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";

vi.mock("../src/notifications/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/notifications/email")>();
  return { ...actual, sendComposedEmail: vi.fn().mockResolvedValue(undefined) };
});
import * as notificationEmail from "../src/notifications/email";

afterEach(() => {
  vi.clearAllMocks();
  vi.mocked(notificationEmail.sendComposedEmail).mockResolvedValue(undefined);
});

describe("communicationService: createCommunication", () => {
  it("rejects a communication with no linked record", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");

    await expect(
      communicationService.createCommunication(ctx, {
        channel: "PHONE",
        direction: "OUTBOUND",
        summary: "Called, no answer.",
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects for a role without communications.create (Finance)", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");
    const { contact } = await createContact(ctx, { firstName: "Jane" });
    const financeCtx = await createTestContext(org.id, "FINANCE", "finance");

    await expect(
      communicationService.createCommunication(financeCtx, {
        channel: "PHONE",
        direction: "OUTBOUND",
        summary: "Called Jane.",
        contactId: contact.id,
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("creates a communication linked to a contact, lists it on that contact's timeline, and audits it", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");
    const { contact } = await createContact(ctx, { firstName: "Jane" });

    const communication = await communicationService.createCommunication(ctx, {
      channel: "PHONE",
      direction: "OUTBOUND",
      summary: "Called Jane about the proposal.",
      contactId: contact.id,
    });
    expect(communication.authorMembershipId).toBe(ctx.membershipId);

    const timeline = await communicationService.listCommunicationsForContact(ctx, contact.id);
    expect(timeline).toHaveLength(1);
    expect(timeline[0]!.summary).toBe("Called Jane about the proposal.");

    const auditEvents = await adminDb.auditEvent.findMany({
      where: { organizationId: org.id, action: "communication.logged", entityId: communication.id },
    });
    expect(auditEvents).toHaveLength(1);
  });

  it("a caller who cannot view the linked contact cannot log a communication against it", async () => {
    const org = await createTestOrganization();
    const salesCtx = await createTestContext(org.id, "SALES", "owner");
    const techCtx = await createTestContext(org.id, "RESTRICTED_TECHNICAL", "tech");
    const { contact } = await createContact(salesCtx, { firstName: "Jane" });

    // Restricted Technical has no contacts.view at all.
    await expect(
      communicationService.createCommunication(techCtx, {
        channel: "PHONE",
        direction: "OUTBOUND",
        summary: "Should not be allowed.",
        contactId: contact.id,
      }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("communicationService: sendAndLogEmail", () => {
  it("sends the composed email and logs it as an outbound EMAIL communication", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");
    const { company } = await createCompany(ctx, { name: "Acme Ltd" });

    const communication = await communicationService.sendAndLogEmail(ctx, {
      to: "jane@example.test",
      subject: "Following up",
      body: "Just checking in.",
      companyId: company.id,
    });

    expect(communication.channel).toBe("EMAIL");
    expect(communication.direction).toBe("OUTBOUND");
    expect(notificationEmail.sendComposedEmail).toHaveBeenCalledTimes(1);
    const [to, args] = vi.mocked(notificationEmail.sendComposedEmail).mock.calls[0]!;
    expect(to).toBe("jane@example.test");
    expect(args.subject).toBe("Following up");

    const timeline = await communicationService.listCommunicationsForCompany(ctx, company.id);
    expect(timeline).toHaveLength(1);
  });

  it("does not log anything if the send itself fails", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");
    const { company } = await createCompany(ctx, { name: "Acme Ltd" });
    vi.mocked(notificationEmail.sendComposedEmail).mockRejectedValueOnce(
      new Error("SMTP rejected the message"),
    );

    await expect(
      communicationService.sendAndLogEmail(ctx, {
        to: "jane@example.test",
        subject: "Following up",
        body: "Just checking in.",
        companyId: company.id,
      }),
    ).rejects.toThrow(ValidationError);

    const timeline = await communicationService.listCommunicationsForCompany(ctx, company.id);
    expect(timeline).toHaveLength(0);
  });
});
