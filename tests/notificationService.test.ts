import { afterEach, describe, expect, it, vi } from "vitest";
import { adminDb } from "../src/db/adminClient";
import { assignLead, createLead } from "../src/services/leadService";
import * as notificationService from "../src/services/notificationService";
import {
  createTestContext,
  createTestMembership,
  createTestOrganization,
  getLeadStatusId,
} from "./helpers/fixtures";

vi.mock("../src/notifications/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/notifications/email")>();
  return {
    ...actual,
    sendLeadAssignedEmail: vi.fn().mockResolvedValue(undefined),
    sendTaskDueEmail: vi.fn().mockResolvedValue(undefined),
    sendTaskOverdueEmail: vi.fn().mockResolvedValue(undefined),
    sendWebsiteLeadAcknowledgementEmail: vi.fn().mockResolvedValue(undefined),
  };
});

import * as notificationEmail from "../src/notifications/email";

afterEach(() => {
  // `clearAllMocks` only clears call history, not a `mockRejectedValue(Once)`
  // implementation set by an earlier test -- reinstate the default success
  // behavior explicitly so failures don't leak into unrelated later tests.
  vi.clearAllMocks();
  vi.mocked(notificationEmail.sendLeadAssignedEmail).mockResolvedValue(undefined);
  vi.mocked(notificationEmail.sendTaskDueEmail).mockResolvedValue(undefined);
  vi.mocked(notificationEmail.sendTaskOverdueEmail).mockResolvedValue(undefined);
  vi.mocked(notificationEmail.sendWebsiteLeadAcknowledgementEmail).mockResolvedValue(undefined);
});

describe("notificationService: notifyLeadAssigned", () => {
  it("creates an in-app notification and sends an email to the new owner", async () => {
    const org = await createTestOrganization();
    const { user, membership } = await createTestMembership(org.id, "SALES", "owner");

    await notificationService.notifyLeadAssigned(org.id, membership.id, {
      id: "lead-1",
      label: "Acme Ltd",
    });

    const notifications = await adminDb.notification.findMany({
      where: { organizationId: org.id, membershipId: membership.id, type: "LEAD_ASSIGNED" },
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.entityId).toBe("lead-1");

    expect(notificationEmail.sendLeadAssignedEmail).toHaveBeenCalledTimes(1);
    const [to, args] = vi.mocked(notificationEmail.sendLeadAssignedEmail).mock.calls[0]!;
    expect(to).toBe(user.email);
    expect(args.leadLabel).toBe("Acme Ltd");

    const deliveries = await adminDb.notificationDelivery.findMany({
      where: { organizationId: org.id, notificationId: notifications[0]!.id },
    });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.status).toBe("SENT");
  });

  it("notifies again when the same lead is reassigned back to a previous owner (not deduped like due/overdue)", async () => {
    const org = await createTestOrganization();
    const { membership } = await createTestMembership(org.id, "SALES", "owner");

    await notificationService.notifyLeadAssigned(org.id, membership.id, {
      id: "lead-2",
      label: "Round Trip Co",
    });
    await notificationService.notifyLeadAssigned(org.id, membership.id, {
      id: "lead-2",
      label: "Round Trip Co",
    });

    const notifications = await adminDb.notification.findMany({
      where: {
        organizationId: org.id,
        membershipId: membership.id,
        type: "LEAD_ASSIGNED",
        entityId: "lead-2",
      },
    });
    expect(notifications).toHaveLength(2);
  });

  it("does not email (but still records the in-app notification) when the recipient has disabled email for this type", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES", "recipient");

    await notificationService.updateMyNotificationPreference(ctx, "LEAD_ASSIGNED", {
      emailEnabled: false,
    });

    await notificationService.notifyLeadAssigned(org.id, ctx.membershipId, {
      id: "lead-3",
      label: "No Email Co",
    });

    expect(notificationEmail.sendLeadAssignedEmail).not.toHaveBeenCalled();
    const notifications = await adminDb.notification.findMany({
      where: { organizationId: org.id, membershipId: ctx.membershipId, entityId: "lead-3" },
    });
    expect(notifications).toHaveLength(1);
  });

  it("hides a notification from the in-app feed when in-app is disabled for its type, without affecting email", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES", "recipient2");

    await notificationService.updateMyNotificationPreference(ctx, "LEAD_ASSIGNED", {
      inAppEnabled: false,
    });
    await notificationService.notifyLeadAssigned(org.id, ctx.membershipId, {
      id: "lead-4",
      label: "Hidden In App Co",
    });

    const visible = await notificationService.listMyNotifications(ctx);
    expect(visible.find((n) => n.entityId === "lead-4")).toBeUndefined();
    expect(notificationEmail.sendLeadAssignedEmail).toHaveBeenCalledTimes(1);
  });
});

describe("notificationService: retry on delivery failure", () => {
  it("marks a failed delivery FAILED with a future retry time, then SENT once retried successfully", async () => {
    const org = await createTestOrganization();
    const { membership } = await createTestMembership(org.id, "SALES", "flaky");

    vi.mocked(notificationEmail.sendLeadAssignedEmail).mockRejectedValueOnce(
      new Error("SMTP temporarily unavailable"),
    );
    await notificationService.notifyLeadAssigned(org.id, membership.id, {
      id: "lead-5",
      label: "Flaky Co",
    });

    const afterFailure = await adminDb.notificationDelivery.findFirstOrThrow({
      where: { organizationId: org.id, recipientEmail: { not: null } },
      orderBy: { createdAt: "desc" },
    });
    expect(afterFailure.status).toBe("FAILED");
    expect(afterFailure.attempts).toBe(1);
    expect(afterFailure.lastError).toContain("SMTP temporarily unavailable");
    expect(afterFailure.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    // Force it due now rather than waiting for real backoff.
    await adminDb.notificationDelivery.update({
      where: { id: afterFailure.id },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });

    const { attempted } = await notificationService.retryDueDeliveries(org.id);
    expect(attempted).toBe(1);

    const afterRetry = await adminDb.notificationDelivery.findUniqueOrThrow({
      where: { id: afterFailure.id },
    });
    expect(afterRetry.status).toBe("SENT");
    expect(afterRetry.sentAt).not.toBeNull();
  });

  it("marks EXHAUSTED once attempts reach maxAttempts", async () => {
    const org = await createTestOrganization();
    const { membership } = await createTestMembership(org.id, "SALES", "doomed");

    vi.mocked(notificationEmail.sendLeadAssignedEmail).mockRejectedValue(new Error("down"));
    await notificationService.notifyLeadAssigned(org.id, membership.id, {
      id: "lead-6",
      label: "Doomed Co",
    });

    const delivery = await adminDb.notificationDelivery.findFirstOrThrow({
      where: { organizationId: org.id, recipientEmail: { not: null } },
      orderBy: { createdAt: "desc" },
    });

    // Drive it to maxAttempts via direct retries, forcing each one due immediately.
    let current = delivery;
    while (current.attempts < current.maxAttempts) {
      await adminDb.notificationDelivery.update({
        where: { id: current.id },
        data: { nextAttemptAt: new Date(Date.now() - 1000) },
      });
      await notificationService.retryDueDeliveries(org.id);
      current = await adminDb.notificationDelivery.findUniqueOrThrow({ where: { id: current.id } });
    }

    expect(current.status).toBe("EXHAUSTED");
  });
});

describe("notificationService: website lead acknowledgement", () => {
  it("is off by default, and sends once enabled", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");

    await notificationService.sendWebsiteLeadAcknowledgement(org.id, {
      name: "Jane Enquirer",
      email: "jane@example.test",
    });
    expect(notificationEmail.sendWebsiteLeadAcknowledgementEmail).not.toHaveBeenCalled();

    await notificationService.setWebsiteAcknowledgementSetting(ctx, true);
    await notificationService.sendWebsiteLeadAcknowledgement(org.id, {
      name: "Jane Enquirer",
      email: "jane@example.test",
    });

    expect(notificationEmail.sendWebsiteLeadAcknowledgementEmail).toHaveBeenCalledTimes(1);
    const [to, args] = vi
      .mocked(notificationEmail.sendWebsiteLeadAcknowledgementEmail)
      .mock.calls[0]!;
    expect(to).toBe("jane@example.test");
    expect(args.enquirerName).toBe("Jane Enquirer");
    expect(args.organizationName).toBe(org.name);
  });

  it("creates no Notification row -- there is no membership recipient", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");
    await notificationService.setWebsiteAcknowledgementSetting(ctx, true);

    await notificationService.sendWebsiteLeadAcknowledgement(org.id, {
      name: "No Account Here",
      email: "noaccount@example.test",
    });

    const deliveries = await adminDb.notificationDelivery.findMany({
      where: { organizationId: org.id, recipientEmail: "noaccount@example.test" },
    });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.notificationId).toBeNull();
  });
});

describe("notificationService: real trigger points", () => {
  it("leadService.assignLead notifies the new owner", async () => {
    const org = await createTestOrganization();
    const managerCtx = await createTestContext(org.id, "MANAGEMENT", "manager");
    const { membership: newOwner } = await createTestMembership(org.id, "SALES", "newowner");
    const leadStatusId = await getLeadStatusId(org.id);

    const { lead } = await createLead(managerCtx, { leadStatusId });
    await assignLead(managerCtx, lead.id, newOwner.id);

    const notifications = await adminDb.notification.findMany({
      where: { organizationId: org.id, membershipId: newOwner.id, type: "LEAD_ASSIGNED" },
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.entityId).toBe(lead.id);
  });
});
