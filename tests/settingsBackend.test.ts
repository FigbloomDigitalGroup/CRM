import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ForbiddenError, UnauthorizedError, ValidationError } from "../src/auth/errors";
import { resolveWebsitePublicContext } from "../src/auth/websiteApiKey";
import { adminDb } from "../src/db/adminClient";
import { ingestInboundEmail } from "../src/services/inboundEmailService";
import {
  getWhatsAppConfig,
  listIntegrations,
  renderWhatsAppMessage,
  updateWhatsAppConfig,
  whatsappLinkFor,
} from "../src/services/integrationRegistryService";
import * as integrationService from "../src/services/integrationService";
import { listMemberships } from "../src/services/membershipService";
import { getSettingsOverview } from "../src/services/settingsService";
import { submitWebsiteLead } from "../src/services/websiteLeadService";
import { createTestContext, createTestMembership, createTestOrganization } from "./helpers/fixtures";

function uniqueIp(): string {
  return `198.51.100.${randomUUID().slice(0, 4)}`;
}
const goodLead = () => JSON.stringify({ name: "Settings Test Lead", email: `lead-${randomUUID().slice(0, 8)}@example.test` });

describe("members list (B4.01)", () => {
  it("shows every state and the last successful sign-in", async () => {
    const org = await createTestOrganization("SettingsMembers");
    const admin = await createTestContext(org.id, "MANAGEMENT", "settings.admin");
    const sales = await createTestContext(org.id, "SALES", "settings.sales");
    const signedInAt = new Date("2026-10-20T08:30:00.000Z");
    await adminDb.signInEvent.create({
      data: { organizationId: org.id, userId: sales.userId, email: "x@example.test", outcome: "SUCCESS", createdAt: signedInAt },
    });
    // A failed attempt later does not count as a sign-in.
    await adminDb.signInEvent.create({
      data: { organizationId: org.id, userId: sales.userId, email: "x@example.test", outcome: "FAILURE", createdAt: new Date("2026-10-21T08:30:00.000Z") },
    });
    const pending = await createTestMembership(org.id, "DELIVERY", "settings.pending");
    await adminDb.membership.update({ where: { id: pending.membership.id }, data: { status: "PENDING", invitedAt: new Date(), inviteTokenExpiresAt: new Date(Date.now() - 1000) } });

    const members = await listMemberships(admin);
    const row = (id: string) => members.find((m) => m.membershipId === id)!;
    expect(row(sales.membershipId).state).toBe("active");
    expect(row(sales.membershipId).lastSignInAt?.toISOString()).toBe(signedInAt.toISOString());
    expect(row(admin.membershipId).lastSignInAt).toBeNull();
    expect(row(pending.membership.id).state).toBe("invited");
    expect(row(pending.membership.id).inviteExpired).toBe(true);
  });
});

describe("website key rotation with a grace window (B4.01)", () => {
  it("keeps the old key working during the window and the new key from the start", async () => {
    const org = await createTestOrganization("KeyGrace");
    const ctx = await createTestContext(org.id, "MANAGEMENT", "key.admin");
    const first = await integrationService.regenerateWebsiteApiKey(ctx);
    const second = await integrationService.regenerateWebsiteApiKey(ctx, { graceHours: 2 });

    expect(second.previousKeyValidUntil).toBeInstanceOf(Date);
    await expect(resolveWebsitePublicContext(org.slug, first.apiKey)).resolves.toMatchObject({ organizationId: org.id });
    await expect(resolveWebsitePublicContext(org.slug, second.apiKey)).resolves.toMatchObject({ organizationId: org.id });

    const status = await integrationService.getWebsiteIntegrationStatus(ctx);
    expect(status.configured && status.previousKey?.keyPrefix).toBe(first.keyPrefix);
    expect(status.configured && status.rotatedAt).not.toBeNull();
  });

  it("stops the old key when the window ends, and never accepts a key older than the previous one", async () => {
    const org = await createTestOrganization("KeyExpiry");
    const ctx = await createTestContext(org.id, "MANAGEMENT", "key.admin");
    const first = await integrationService.regenerateWebsiteApiKey(ctx);
    const second = await integrationService.regenerateWebsiteApiKey(ctx, { graceHours: 1 });
    const third = await integrationService.regenerateWebsiteApiKey(ctx, { graceHours: 1 });

    // Only one previous key is kept: the first key is gone, the second is in its window.
    await expect(resolveWebsitePublicContext(org.slug, first.apiKey)).rejects.toThrow(UnauthorizedError);
    await expect(resolveWebsitePublicContext(org.slug, second.apiKey)).resolves.toBeDefined();

    await adminDb.websiteApiKey.update({ where: { organizationId: org.id }, data: { previousKeyExpiresAt: new Date(Date.now() - 1000) } });
    await expect(resolveWebsitePublicContext(org.slug, second.apiKey)).rejects.toThrow(UnauthorizedError);
    await expect(resolveWebsitePublicContext(org.slug, third.apiKey)).resolves.toBeDefined();
    const status = await integrationService.getWebsiteIntegrationStatus(ctx);
    expect(status.configured && status.previousKey).toBeNull();
  });

  it("a live form submission through the old key still creates a lead during the window", async () => {
    const org = await createTestOrganization("KeyLive");
    const ctx = await createTestContext(org.id, "MANAGEMENT", "key.admin");
    const first = await integrationService.regenerateWebsiteApiKey(ctx);
    await integrationService.regenerateWebsiteApiKey(ctx);
    const result = await submitWebsiteLead(org.slug, first.apiKey, goodLead(), { ipAddress: uniqueIp(), origin: null });
    expect(result?.leadId).toBeTruthy();
  });

  it("revoking switches off the key in its window too", async () => {
    const org = await createTestOrganization("KeyRevoke");
    const ctx = await createTestContext(org.id, "MANAGEMENT", "key.admin");
    const first = await integrationService.regenerateWebsiteApiKey(ctx);
    const second = await integrationService.regenerateWebsiteApiKey(ctx);
    await integrationService.revokeWebsiteApiKey(ctx);
    await expect(resolveWebsitePublicContext(org.slug, first.apiKey)).rejects.toThrow(UnauthorizedError);
    await expect(resolveWebsitePublicContext(org.slug, second.apiKey)).rejects.toThrow(UnauthorizedError);
  });

  it("refuses a grace window that is negative or longer than 72 hours, and audits the rotation", async () => {
    const org = await createTestOrganization("KeyBounds");
    const ctx = await createTestContext(org.id, "MANAGEMENT", "key.admin");
    await expect(integrationService.regenerateWebsiteApiKey(ctx, { graceHours: -1 })).rejects.toThrow(ValidationError);
    await expect(integrationService.regenerateWebsiteApiKey(ctx, { graceHours: 73 })).rejects.toThrow(ValidationError);
    await integrationService.regenerateWebsiteApiKey(ctx, { graceHours: 6 });
    const events = await adminDb.auditEvent.findMany({ where: { organizationId: org.id, action: "website_api_key.regenerated" } });
    expect(events).toHaveLength(1);
    expect((events[0]!.metadata as { graceHours: number }).graceHours).toBe(6);
  });
});

describe("last accepted, last rejected and the rejected list (B4.01)", () => {
  it("records both, explains the reason, filters and pages the list, for Management only", async () => {
    const org = await createTestOrganization("RejectedList");
    const ctx = await createTestContext(org.id, "MANAGEMENT", "rej.admin");
    const sales = await createTestContext(org.id, "SALES", "rej.sales");
    const { apiKey } = await integrationService.regenerateWebsiteApiKey(ctx);
    await integrationService.updateWebsiteApiKeySettings(ctx, { allowedOrigins: ["https://good.example.test"] });

    await submitWebsiteLead(org.slug, apiKey, goodLead(), { ipAddress: uniqueIp(), origin: "https://good.example.test" });
    await expect(submitWebsiteLead(org.slug, apiKey, goodLead(), { ipAddress: uniqueIp(), origin: "https://evil.example.test" })).rejects.toThrow(UnauthorizedError);
    await expect(submitWebsiteLead(org.slug, "wlk_live_wrong", goodLead(), { ipAddress: uniqueIp(), origin: null })).rejects.toThrow(UnauthorizedError);
    await expect(submitWebsiteLead(org.slug, apiKey, "{not json", { ipAddress: uniqueIp(), origin: "https://good.example.test" })).rejects.toThrow(ValidationError);

    const status = await integrationService.getWebsiteIntegrationStatus(ctx);
    if (!status.configured) throw new Error("expected a configured key");
    expect(status.lastAcceptedAt).not.toBeNull();
    expect(status.lastRejectedAt).not.toBeNull();
    expect(status.lastRejection?.explanation).toBeTruthy();

    const all = await integrationService.listRejectedWebsiteSubmissions(ctx);
    expect(all.total).toBe(3);
    expect(all.items.map((r) => r.outcome).sort()).toEqual(["INVALID_KEY", "ORIGIN_NOT_ALLOWED", "VALIDATION_FAILED"]);
    expect(all.items.every((r) => r.explanation)).toBe(true);
    expect(all.items.some((r) => r.outcome === "ACCEPTED")).toBe(false);

    const origin = await integrationService.listRejectedWebsiteSubmissions(ctx, { outcome: "ORIGIN_NOT_ALLOWED" });
    expect(origin.total).toBe(1);
    expect(origin.items[0]!.reason).toBe("https://evil.example.test");

    const paged = await integrationService.listRejectedWebsiteSubmissions(ctx, { paging: { pageSize: 2 } });
    expect(paged.items).toHaveLength(2);
    expect(paged.nextCursor).not.toBeNull();

    await expect(integrationService.listRejectedWebsiteSubmissions(ctx, { outcome: "NOPE" })).rejects.toThrow(ValidationError);
    await expect(integrationService.listRejectedWebsiteSubmissions(sales)).rejects.toThrow(ForbiddenError);
  });

  it("never lists another organisation's rejections", async () => {
    const a = await createTestOrganization("RejectedA");
    const b = await createTestOrganization("RejectedB");
    const ctxA = await createTestContext(a.id, "MANAGEMENT", "iso.a");
    const ctxB = await createTestContext(b.id, "MANAGEMENT", "iso.b");
    const { apiKey } = await integrationService.regenerateWebsiteApiKey(ctxA);
    await integrationService.regenerateWebsiteApiKey(ctxB);
    await expect(submitWebsiteLead(a.slug, apiKey, "{bad", { ipAddress: uniqueIp(), origin: null })).rejects.toThrow(ValidationError);

    expect((await integrationService.listRejectedWebsiteSubmissions(ctxA)).total).toBe(1);
    expect((await integrationService.listRejectedWebsiteSubmissions(ctxB)).total).toBe(0);
  });
});

describe("inbound email status (B4.01)", () => {
  it("shows when mail last arrived and the last error, and a good message clears the error", async () => {
    const org = await createTestOrganization("InboundStatus");
    const ctx = await createTestContext(org.id, "MANAGEMENT", "inbound.admin");
    const { token } = await integrationService.regenerateInboundEmailKey(ctx);

    const before = await integrationService.getInboundEmailIntegrationStatus(ctx);
    expect(before.configured && before.lastReceivedAt).toBeNull();

    await expect(ingestInboundEmail(org.slug, token, { from: "" })).rejects.toThrow(ValidationError);
    const failed = await integrationService.getInboundEmailIntegrationStatus(ctx);
    expect(failed.configured && failed.lastError?.message).toContain("from");

    await ingestInboundEmail(org.slug, token, { from: "Buyer <buyer@example.test>", subject: "Hello", text: "Hi", messageId: `<${randomUUID()}@mail.test>` });
    const ok = await integrationService.getInboundEmailIntegrationStatus(ctx);
    expect(ok.configured && ok.lastReceivedAt).not.toBeNull();
    expect(ok.configured && ok.lastError).toBeNull();
  });

  it("is Management only", async () => {
    const org = await createTestOrganization("InboundPerm");
    const sales = await createTestContext(org.id, "SALES", "inbound.sales");
    await expect(integrationService.getInboundEmailIntegrationStatus(sales)).rejects.toThrow(ForbiddenError);
  });
});

describe("settings overview (B4.01)", () => {
  it("gives profile, member counts and integrations to Management, and nothing to anyone else", async () => {
    const org = await createTestOrganization("Overview");
    const admin = await createTestContext(org.id, "MANAGEMENT", "overview.admin");
    await createTestContext(org.id, "SALES", "overview.sales");
    const overview = await getSettingsOverview(admin);
    expect(overview.profile.name).toContain("Overview");
    expect(overview.members.counts.active).toBeGreaterThanOrEqual(2);
    expect("integrations" in overview && "counts" in overview.integrations).toBe(true);

    const sales = await createTestContext(org.id, "SALES", "overview.sales2");
    await expect(getSettingsOverview(sales)).rejects.toThrow(ForbiddenError);
  });
});

describe("integrations registry (B4.03)", () => {
  it("derives state from real signals, not a manual flag", async () => {
    const org = await createTestOrganization("Registry");
    const ctx = await createTestContext(org.id, "MANAGEMENT", "registry.admin");
    const byKey = async () => Object.fromEntries((await listIntegrations(ctx)).integrations.map((i) => [i.key, i]));

    let e = await byKey();
    expect(e.WEBSITE!.state).toBe("NOT_CONNECTED");
    expect(e.INBOUND_EMAIL!.state).toBe("NOT_CONNECTED");
    expect(e.WHATSAPP_CLICK_TO_CHAT!.state).toBe("NOT_CONNECTED");

    // A key alone is not "connected": nothing has been accepted yet.
    const { apiKey } = await integrationService.regenerateWebsiteApiKey(ctx);
    const { token } = await integrationService.regenerateInboundEmailKey(ctx);
    e = await byKey();
    expect(e.WEBSITE!.state).toBe("NOT_CONNECTED");
    expect(e.WEBSITE!.stateReason).toContain("no submission");
    expect(e.INBOUND_EMAIL!.state).toBe("NOT_CONNECTED");

    await submitWebsiteLead(org.slug, apiKey, goodLead(), { ipAddress: uniqueIp(), origin: null });
    await ingestInboundEmail(org.slug, token, { from: "a@example.test", subject: "s", text: "t", messageId: `<${randomUUID()}@mail.test>` });
    e = await byKey();
    expect(e.WEBSITE!.state).toBe("CONNECTED");
    expect(e.WEBSITE!.lastActivityAt).not.toBeNull();
    expect(e.INBOUND_EMAIL!.state).toBe("CONNECTED");

    // Revoking turns it off again.
    await integrationService.revokeWebsiteApiKey(ctx);
    e = await byKey();
    expect(e.WEBSITE!.state).toBe("NOT_CONNECTED");
  });

  it("lists the planned integrations as planned and informational", async () => {
    const org = await createTestOrganization("RegistryPlanned");
    const ctx = await createTestContext(org.id, "MANAGEMENT", "registry.admin");
    const { integrations, counts } = await listIntegrations(ctx);
    const planned = integrations.filter((i) => i.state === "PLANNED");
    expect(planned.map((i) => i.key).sort()).toEqual(["ACCOUNTING", "API_WEBHOOKS", "CALENDAR", "EMAIL_PROVIDER"]);
    expect(planned.every((i) => !i.configurable)).toBe(true);
    expect(counts.PLANNED).toBe(4);
    expect(integrations.find((i) => i.key === "EMAIL_PROVIDER")!.release).toBe("V1.1");
    expect(integrations.find((i) => i.key === "API_WEBHOOKS")!.release).toBe("V2");
  });

  it("surfaces a website rejection newer than the last accepted lead as the last error", async () => {
    const org = await createTestOrganization("RegistryError");
    const ctx = await createTestContext(org.id, "MANAGEMENT", "registry.admin");
    const { apiKey } = await integrationService.regenerateWebsiteApiKey(ctx);
    await submitWebsiteLead(org.slug, apiKey, goodLead(), { ipAddress: uniqueIp(), origin: null });
    await new Promise((r) => setTimeout(r, 15));
    await expect(submitWebsiteLead(org.slug, apiKey, "{bad", { ipAddress: uniqueIp(), origin: null })).rejects.toThrow(ValidationError);
    const website = (await listIntegrations(ctx)).integrations.find((i) => i.key === "WEBSITE")!;
    expect(website.lastError?.message).toContain("turned away");
  });

  it("is Management only", async () => {
    const org = await createTestOrganization("RegistryPerm");
    for (const role of ["SALES", "DELIVERY", "FINANCE"] as const) {
      const ctx = await createTestContext(org.id, role, `registry.${role}`);
      await expect(listIntegrations(ctx)).rejects.toThrow(ForbiddenError);
      await expect(getWhatsAppConfig(ctx)).rejects.toThrow(ForbiddenError);
      await expect(updateWhatsAppConfig(ctx, { number: "+254700000000" })).rejects.toThrow(ForbiddenError);
    }
  });
});

describe("WhatsApp click-to-chat configuration (B4.03)", () => {
  it("stores the organisation number as wa.me digits and the message templates, and audits it", async () => {
    const org = await createTestOrganization("Whatsapp");
    const ctx = await createTestContext(org.id, "MANAGEMENT", "wa.admin");
    const saved = await updateWhatsAppConfig(ctx, {
      number: "0700 123 456",
      defaultMessage: "Hello {{name}}, this is {{organisation}}.",
      templates: [{ label: "Quote follow-up", body: "Hi {{name}}, any questions on the quote?" }],
    });
    expect(saved.number).toBe("254700123456");
    expect(saved.templates).toEqual([{ key: "quote-follow-up", label: "Quote follow-up", body: "Hi {{name}}, any questions on the quote?" }]);
    expect(saved.mode).toBe("CLICK_TO_CHAT");

    const entry = (await listIntegrations(ctx)).integrations.find((i) => i.key === "WHATSAPP_CLICK_TO_CHAT")!;
    expect(entry.state).toBe("CONNECTED");

    const events = await adminDb.auditEvent.findMany({ where: { organizationId: org.id, action: "integration.whatsapp_updated" } });
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events[0]!.metadata)).not.toContain("254700123456");
  });

  it("builds a wa.me link with the default or a chosen template, with merge fields filled", async () => {
    const org = await createTestOrganization("WhatsappLink");
    const ctx = await createTestContext(org.id, "MANAGEMENT", "wa.admin");
    await updateWhatsAppConfig(ctx, {
      number: "+254700123456",
      defaultMessage: "Hello {{name}}",
      templates: [{ label: "Thanks", body: "Thanks {{name}} from {{organisation}}" }],
    });
    const plain = await whatsappLinkFor(org.id, "0711 222 333", { name: "Amina" });
    expect(plain?.href).toBe(`https://wa.me/254711222333?text=${encodeURIComponent("Hello Amina")}`);
    const template = await whatsappLinkFor(org.id, "0711222333", { templateKey: "thanks", name: "Amina" });
    expect(template?.message).toContain("Thanks Amina from");
    expect(await whatsappLinkFor(org.id, null)).toBeNull();
    expect(renderWhatsAppMessage("Hi {{ name }}", {})).toBe("Hi there");
  });

  it("refuses a bad number, an over-long message and duplicate template names; clears the number with null", async () => {
    const org = await createTestOrganization("WhatsappBad");
    const ctx = await createTestContext(org.id, "MANAGEMENT", "wa.admin");
    await expect(updateWhatsAppConfig(ctx, { number: "12" })).rejects.toThrow(ValidationError);
    await expect(updateWhatsAppConfig(ctx, { defaultMessage: "x".repeat(1001) })).rejects.toThrow(ValidationError);
    await expect(
      updateWhatsAppConfig(ctx, { templates: [{ label: "Same", body: "a" }, { label: "Same", body: "b" }] }),
    ).rejects.toThrow(ValidationError);
    await updateWhatsAppConfig(ctx, { number: "+254700123456" });
    expect((await updateWhatsAppConfig(ctx, { number: null })).number).toBeNull();
  });

  it("keeps the organisation's configuration to itself", async () => {
    const a = await createTestOrganization("WhatsappA");
    const b = await createTestOrganization("WhatsappB");
    const ctxA = await createTestContext(a.id, "MANAGEMENT", "wa.a");
    const ctxB = await createTestContext(b.id, "MANAGEMENT", "wa.b");
    await updateWhatsAppConfig(ctxA, { number: "+254700123456", defaultMessage: "A only" });
    expect((await getWhatsAppConfig(ctxB)).number).toBeNull();
    expect((await getWhatsAppConfig(ctxB)).defaultMessage).toBe("");
  });
});
