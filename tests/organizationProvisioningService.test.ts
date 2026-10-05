import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { provisionOrganization } from "../src/services/organizationProvisioningService";

function uniqueSlug(prefix = "provtest") {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

describe("organizationProvisioningService: provisionOrganization", () => {
  it("creates the organization, seeds default reference-data catalogs, and invites the first admin", async () => {
    const slug = uniqueSlug();
    const result = await provisionOrganization({
      name: "Acme Ltd",
      slug,
      adminEmail: `admin.${slug}@example.test`,
      adminName: "Jane Admin",
    });

    const org = await adminDb.organization.findUniqueOrThrow({
      where: { id: result.organizationId },
    });
    expect(org.slug).toBe(slug);
    expect(org.name).toBe("Acme Ltd");

    const [leadSources, pipelineStages, services, lostReasons, lifecycleStates] =
      await Promise.all([
        adminDb.leadSource.count({ where: { organizationId: org.id } }),
        adminDb.pipelineStage.count({ where: { organizationId: org.id } }),
        adminDb.service.count({ where: { organizationId: org.id } }),
        adminDb.lostReason.count({ where: { organizationId: org.id } }),
        adminDb.customerLifecycleState.count({ where: { organizationId: org.id } }),
      ]);
    expect(leadSources).toBeGreaterThan(0);
    expect(pipelineStages).toBeGreaterThan(0);
    expect(services).toBeGreaterThan(0);
    expect(lostReasons).toBeGreaterThan(0);
    expect(lifecycleStates).toBeGreaterThan(0);

    const membership = await adminDb.membership.findUniqueOrThrow({
      where: { id: result.adminMembershipId },
      include: { role: true, user: true },
    });
    expect(membership.status).toBe("PENDING");
    expect(membership.role.key).toBe("MANAGEMENT");
    expect(membership.user.email).toBe(`admin.${slug}@example.test`);
    expect(membership.inviteTokenHash).not.toBeNull();

    expect(result.acceptUrl).toContain("/accept-invite?token=");

    const auditEvents = await adminDb.auditEvent.findMany({
      where: { organizationId: org.id, action: "organization.provisioned" },
    });
    expect(auditEvents).toHaveLength(1);
  });

  it("provisions the admin with a non-default role when requested", async () => {
    const slug = uniqueSlug();
    const result = await provisionOrganization({
      name: "Sales-Only Co",
      slug,
      adminEmail: `admin.${slug}@example.test`,
      adminName: "Sam Sales",
      adminRoleKey: "SALES",
    });

    const membership = await adminDb.membership.findUniqueOrThrow({
      where: { id: result.adminMembershipId },
      include: { role: true },
    });
    expect(membership.role.key).toBe("SALES");
  });

  it("reuses an existing User row for the admin email rather than erroring", async () => {
    const email = `shared.${randomUUID().slice(0, 8)}@example.test`;
    await adminDb.user.create({ data: { email, name: "Already Exists" } });

    const slug = uniqueSlug();
    const result = await provisionOrganization({
      name: "Second Org",
      slug,
      adminEmail: email,
      adminName: "Already Exists",
    });

    const users = await adminDb.user.findMany({ where: { email } });
    expect(users).toHaveLength(1);

    const membership = await adminDb.membership.findUniqueOrThrow({
      where: { id: result.adminMembershipId },
      include: { user: true },
    });
    expect(membership.user.email).toBe(email);
  });

  it("rejects a slug that already exists", async () => {
    const slug = uniqueSlug();
    await provisionOrganization({
      name: "First",
      slug,
      adminEmail: `one.${slug}@example.test`,
      adminName: "One",
    });

    await expect(
      provisionOrganization({
        name: "Duplicate",
        slug,
        adminEmail: `two.${slug}@example.test`,
        adminName: "Two",
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects an invalid slug", async () => {
    await expect(
      provisionOrganization({
        name: "Bad Slug Co",
        slug: "Not A Valid Slug!",
        adminEmail: "x@example.test",
        adminName: "X",
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects an unknown role key", async () => {
    await expect(
      provisionOrganization({
        name: "Bad Role Co",
        slug: uniqueSlug(),
        adminEmail: "x@example.test",
        adminName: "X",
        adminRoleKey: "SUPERUSER",
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects missing required fields", async () => {
    await expect(
      provisionOrganization({
        name: "",
        slug: uniqueSlug(),
        adminEmail: "x@example.test",
        adminName: "X",
      }),
    ).rejects.toThrow(ValidationError);

    await expect(
      provisionOrganization({
        name: "No Email Co",
        slug: uniqueSlug(),
        adminEmail: "not-an-email",
        adminName: "X",
      }),
    ).rejects.toThrow(ValidationError);
  });
});
