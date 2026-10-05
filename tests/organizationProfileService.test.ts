import { describe, expect, it } from "vitest";
import { ForbiddenError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import {
  getOrganizationProfile,
  updateOrganizationProfile,
} from "../src/services/organizationProfileService";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";

describe("organizationProfileService", () => {
  it("returns the organization's defaults for a fresh org", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");

    const profile = await getOrganizationProfile(ctx);
    expect(profile.timezone).toBe("Africa/Nairobi");
    expect(profile.defaultCurrency).toBe("KES");
    expect(profile.workingDays).toEqual(["MON", "TUE", "WED", "THU", "FRI"]);
  });

  it("rejects read and write for a role without organization.manage_settings", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "SALES");

    await expect(getOrganizationProfile(ctx)).rejects.toThrow(ForbiddenError);
    await expect(
      updateOrganizationProfile(ctx, { name: "New Name" }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("updates profile fields and records an audit event with before/after values", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");

    const updated = await updateOrganizationProfile(ctx, {
      name: "Renamed Co",
      timezone: "Europe/London",
      defaultCurrency: "usd",
      phone: "+254700000000",
      workingHoursStart: "08:00",
      workingHoursEnd: "17:00",
      workingDays: ["MON", "TUE", "WED", "THU"],
    });

    expect(updated.name).toBe("Renamed Co");
    expect(updated.timezone).toBe("Europe/London");
    expect(updated.defaultCurrency).toBe("USD");
    expect(updated.phone).toBe("+254700000000");
    expect(updated.workingHoursStart).toBe("08:00");
    expect(updated.workingDays).toEqual(["MON", "TUE", "WED", "THU"]);

    const events = await adminDb.auditEvent.findMany({
      where: { organizationId: org.id, action: "organization.profile_updated" },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.newValue).toMatchObject({ name: "Renamed Co" });
  });

  it("does not record an audit event when nothing actually changed", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");

    const before = await getOrganizationProfile(ctx);
    await updateOrganizationProfile(ctx, {
      timezone: before.timezone,
      workingDays: before.workingDays,
    });

    const events = await adminDb.auditEvent.findMany({
      where: { organizationId: org.id, action: "organization.profile_updated" },
    });
    expect(events).toHaveLength(0);
  });

  it("clears an optional field when sent as an empty string", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");

    await updateOrganizationProfile(ctx, { phone: "+254700000000" });
    const cleared = await updateOrganizationProfile(ctx, { phone: "   " });
    expect(cleared.phone).toBeNull();
  });

  it("rejects an unrecognized timezone", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");

    await expect(
      updateOrganizationProfile(ctx, { timezone: "Not/A_Zone" }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a malformed default currency", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");

    await expect(
      updateOrganizationProfile(ctx, { defaultCurrency: "Kenyan Shillings" }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects an unknown working day", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");

    await expect(
      updateOrganizationProfile(ctx, { workingDays: ["MON", "FUNDAY"] }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects working hours where the start is not before the end", async () => {
    const org = await createTestOrganization();
    const ctx = await createTestContext(org.id, "MANAGEMENT");

    await expect(
      updateOrganizationProfile(ctx, {
        workingHoursStart: "17:00",
        workingHoursEnd: "08:00",
      }),
    ).rejects.toThrow(ValidationError);
  });
});
