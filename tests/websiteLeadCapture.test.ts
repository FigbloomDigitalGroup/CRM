import { describe, expect, it } from "vitest";
import { ForbiddenError, UnauthorizedError, ValidationError } from "../src/auth/errors";
import { resolveWebsitePublicContext } from "../src/auth/websiteApiKey";
import { adminDb } from "../src/db/adminClient";
import { ingestWebsiteLead } from "../src/repositories/leadIngestion";
import * as integrationService from "../src/services/integrationService";
import { submitWebsiteLead } from "../src/services/websiteLeadService";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";

async function generateAndSetKey(organizationId: string) {
  const { regenerateWebsiteApiKey } = integrationService;
  const ctx = await createTestContext(organizationId, "MANAGEMENT");
  const { apiKey } = await regenerateWebsiteApiKey(ctx);
  return { ctx, apiKey };
}

describe("website lead capture: ingestion", () => {
  it("creates a lead with a new company and contact, auto-sourced and auto-statused", async () => {
    const org = await createTestOrganization();

    const result = await ingestWebsiteLead(org.id, {
      name: "Jane Doe",
      email: "jane@example.test",
      company: "Example Ltd",
      message: "Interested in CCTV for our warehouse.",
    });

    expect(result.companyMatched).toBe(false);
    expect(result.contactMatched).toBe(false);

    const lead = await adminDb.lead.findUniqueOrThrow({
      where: { id: result.leadId },
      include: { leadSource: true, leadStatus: true, contact: true, company: true },
    });
    expect(lead.leadSource?.key).toBe("WEBSITE");
    expect(lead.leadStatus.sequence).toBe(1);
    expect(lead.notes).toBe("Interested in CCTV for our warehouse.");
    expect(lead.contact?.firstName).toBe("Jane");
    expect(lead.contact?.lastName).toBe("Doe");
    expect(lead.company?.name).toBe("Example Ltd");
  });

  it("reuses an existing contact and company on a repeat submission by email/company name, but always creates a new lead", async () => {
    const org = await createTestOrganization();

    const first = await ingestWebsiteLead(org.id, {
      name: "Jane Doe",
      email: "jane@example.test",
      company: "Example Ltd",
    });
    const second = await ingestWebsiteLead(org.id, {
      name: "Jane Doe",
      email: "JANE@example.test",
      company: "example ltd",
    });

    expect(second.contactMatched).toBe(true);
    expect(second.companyMatched).toBe(true);
    expect(second.contactId).toBe(first.contactId);
    expect(second.companyId).toBe(first.companyId);
    expect(second.leadId).not.toBe(first.leadId);
  });

  it("best-effort resolves a recognized service and ignores an unrecognized one without failing", async () => {
    const org = await createTestOrganization();

    const matched = await ingestWebsiteLead(org.id, {
      name: "Sam Roe",
      phone: "+254700000001",
      service: "cctv",
    });
    const lead1 = await adminDb.lead.findUniqueOrThrow({
      where: { id: matched.leadId },
    });
    expect(lead1.serviceInterestId).not.toBeNull();

    const unmatched = await ingestWebsiteLead(org.id, {
      name: "Alex Roe",
      phone: "+254700000002",
      service: "Something We Don't Offer",
    });
    const lead2 = await adminDb.lead.findUniqueOrThrow({
      where: { id: unmatched.leadId },
    });
    expect(lead2.serviceInterestId).toBeNull();
    expect(
      (lead2.qualificationData as { unmatchedService?: string } | null)
        ?.unmatchedService,
    ).toBe("Something We Don't Offer");
  });

  it("round-robins ownership across active Sales memberships and fires an acknowledgement task", async () => {
    const org = await createTestOrganization();
    const sales1 = await createTestContext(org.id, "SALES", "s1");
    const sales2 = await createTestContext(org.id, "SALES", "s2");

    const a = await ingestWebsiteLead(org.id, {
      name: "Lead One",
      phone: "+254700000010",
    });
    const b = await ingestWebsiteLead(org.id, {
      name: "Lead Two",
      phone: "+254700000011",
    });
    const c = await ingestWebsiteLead(org.id, {
      name: "Lead Three",
      phone: "+254700000012",
    });

    const owners = [a.ownerMembershipId, b.ownerMembershipId, c.ownerMembershipId];
    expect(new Set(owners.slice(0, 2))).toEqual(
      new Set([sales1.membershipId, sales2.membershipId]),
    );
    expect(owners[2]).toBe(owners[0]);

    const task = await adminDb.task.findFirst({
      where: { leadId: a.leadId },
    });
    expect(task?.assigneeMembershipId).toBe(a.ownerMembershipId);
    expect(task?.title).toBe("Follow up on new website lead");
  });

  it("leaves a lead unowned (and skips the acknowledgement task) when the organization has no active Sales membership", async () => {
    const org = await createTestOrganization();

    const result = await ingestWebsiteLead(org.id, {
      name: "Orphan Lead",
      phone: "+254700000099",
    });

    expect(result.ownerMembershipId).toBeNull();
    const task = await adminDb.task.findFirst({ where: { leadId: result.leadId } });
    expect(task).toBeNull();
  });

  it("leaves every new lead unowned when the assignment mode is set to UNASSIGNED, even with active Sales reps (FIG-599)", async () => {
    const org = await createTestOrganization();
    const managementCtx = await createTestContext(org.id, "MANAGEMENT");
    await createTestContext(org.id, "SALES", "s1");

    await integrationService.setWebsiteAssignmentSetting(managementCtx, "UNASSIGNED");

    const result = await ingestWebsiteLead(org.id, {
      name: "Manual Triage Lead",
      phone: "+254700000098",
    });

    expect(result.ownerMembershipId).toBeNull();
    const task = await adminDb.task.findFirst({ where: { leadId: result.leadId } });
    expect(task).toBeNull();
  });
});

describe("website lead capture: API key authentication", () => {
  it("resolves the organization for a valid key and rejects a wrong one with the same generic message", async () => {
    const org = await createTestOrganization();
    const { apiKey } = await generateAndSetKey(org.id);

    const resolved = await resolveWebsitePublicContext(org.slug, apiKey);
    expect(resolved.organizationId).toBe(org.id);

    await expect(
      resolveWebsitePublicContext(org.slug, "wlk_live_wrongkey"),
    ).rejects.toThrow(UnauthorizedError);
    await expect(
      resolveWebsitePublicContext("no-such-org-slug", apiKey),
    ).rejects.toThrow(UnauthorizedError);
    await expect(resolveWebsitePublicContext(org.slug, null)).rejects.toThrow(
      UnauthorizedError,
    );
  });

  it("rejects every request until a key has been generated", async () => {
    const org = await createTestOrganization();
    await expect(
      resolveWebsitePublicContext(org.slug, "wlk_live_anything"),
    ).rejects.toThrow(UnauthorizedError);
  });

  it("stops authenticating with the previous key once regenerated", async () => {
    const org = await createTestOrganization();
    const { apiKey: firstKey } = await generateAndSetKey(org.id);
    await resolveWebsitePublicContext(org.slug, firstKey);

    const { apiKey: secondKey } = await generateAndSetKey(org.id);
    await expect(
      resolveWebsitePublicContext(org.slug, firstKey),
    ).rejects.toThrow(UnauthorizedError);
    const resolved = await resolveWebsitePublicContext(org.slug, secondKey);
    expect(resolved.organizationId).toBe(org.id);
  });

  it("records lastUsedAt only after a successful authentication", async () => {
    const org = await createTestOrganization();
    const { apiKey } = await generateAndSetKey(org.id);

    const before = await integrationService.getWebsiteIntegrationStatus(
      await createTestContext(org.id, "MANAGEMENT", "checker1"),
    );
    expect(before.configured && before.lastUsedAt).toBeNull();

    await resolveWebsitePublicContext(org.slug, apiKey);

    const after = await integrationService.getWebsiteIntegrationStatus(
      await createTestContext(org.id, "MANAGEMENT", "checker2"),
    );
    expect(after.configured && after.lastUsedAt).not.toBeNull();
  });
});

describe("website lead capture: integrationService permissions", () => {
  it("requires configuration.manage to view or regenerate the key", async () => {
    const org = await createTestOrganization();
    const salesCtx = await createTestContext(org.id, "SALES");

    await expect(
      integrationService.getWebsiteIntegrationStatus(salesCtx),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      integrationService.regenerateWebsiteApiKey(salesCtx),
    ).rejects.toThrow(ForbiddenError);
  });
});

const NO_META = { ipAddress: null, origin: null };

describe("website lead capture: submitWebsiteLead (public service entry point)", () => {
  it("validates required fields before touching the database", async () => {
    const org = await createTestOrganization();
    const { apiKey } = await generateAndSetKey(org.id);

    await expect(
      submitWebsiteLead(
        org.slug,
        apiKey,
        JSON.stringify({ email: "no-name@example.test" }),
        NO_META,
      ),
    ).rejects.toThrow(ValidationError);
    await expect(
      submitWebsiteLead(
        org.slug,
        apiKey,
        JSON.stringify({ name: "No Contact Info" }),
        NO_META,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("checks the API key before validating the body", async () => {
    const org = await createTestOrganization();
    await expect(
      submitWebsiteLead(
        org.slug,
        "wlk_live_bad",
        JSON.stringify({ name: "Whoever" }),
        NO_META,
      ),
    ).rejects.toThrow(UnauthorizedError);
  });

  it("captures UTM parameters and referrer without treating them as user-entered fields", async () => {
    const org = await createTestOrganization();
    const { apiKey } = await generateAndSetKey(org.id);

    const result = await submitWebsiteLead(
      org.slug,
      apiKey,
      JSON.stringify({
        name: "UTM Test",
        email: "utm@example.test",
        utm: { utmSource: "google", utmCampaign: "spring-promo" },
        referrer: "https://figbloom.example/contact",
      }),
      NO_META,
    );
    expect(result).not.toBeNull();

    const lead = await adminDb.lead.findUniqueOrThrow({
      where: { id: result!.leadId },
    });
    const qualification = lead.qualificationData as { utm?: Record<string, string> };
    expect(qualification.utm?.utmSource).toBe("google");
    expect(qualification.utm?.utmCampaign).toBe("spring-promo");
    expect(qualification.utm?.referrer).toBe("https://figbloom.example/contact");
  });
});
