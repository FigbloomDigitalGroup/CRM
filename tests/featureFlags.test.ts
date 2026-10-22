import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../src/auth/context";
import { ForbiddenError, ValidationError } from "../src/auth/errors";
import { adminDb } from "../src/db/adminClient";
import { ErrorEnvelopeSchema } from "../src/api/dto/common";
import { FeatureSnapshotSchema } from "../src/api/dto/features";
import { handleRoute } from "../src/app/api/_lib/handleRoute";
import {
  FeatureUnavailableError,
  RELEASE_FLAG_KEYS,
  TOGGLES,
  globalRelease,
  isKnownFeature,
  parseRelease,
  releaseAtLeast,
  resolveFeature,
} from "../src/lib/featureFlags";
import {
  getFeatureSnapshot,
  isFeatureEnabled,
  loadFeatureConfig,
  requireFeature,
  setOrganizationRelease,
  updateFeatureToggles,
} from "../src/services/featureService";
import { createTestContext, createTestOrganization } from "./helpers/fixtures";

const current: { ctx: AuthContext | null } = { ctx: null };
vi.mock("../src/auth/requestContext", () => ({
  resolveRequestContext: async () => {
    if (!current.ctx) throw new Error("no ctx");
    return current.ctx;
  },
}));

import * as featuresRoute from "../src/app/api/orgs/[orgSlug]/features/route";

/**
 * FIG-1015 (B0.07): release flags evaluated server side, organisation
 * toggles with defaults and an audit entry on change, `requireFeature`, and
 * the explained "not available yet" response.
 */

const ORIGINAL_RELEASE = process.env.ACTIVE_RELEASE;
beforeEach(() => {
  delete process.env.ACTIVE_RELEASE;
  current.ctx = null;
});
afterEach(() => {
  if (ORIGINAL_RELEASE === undefined) delete process.env.ACTIVE_RELEASE;
  else process.env.ACTIVE_RELEASE = ORIGINAL_RELEASE;
});

async function setup() {
  const org = await createTestOrganization("Flags");
  const mgmt = await createTestContext(org.id, "MANAGEMENT", "ff.mgmt");
  const sales = await createTestContext(org.id, "SALES", "ff.sales");
  return { org, mgmt, sales };
}

describe("flag resolution (pure)", () => {
  const config = (release: "v1" | "v1.1" | "v2", toggles = {}) => ({ release, toggles });

  it("orders the releases", () => {
    expect(releaseAtLeast("v1", "v1")).toBe(true);
    expect(releaseAtLeast("v1", "v1.1")).toBe(false);
    expect(releaseAtLeast("v1.1", "v1")).toBe(true);
    expect(releaseAtLeast("v2", "v1.1")).toBe(true);
  });

  it("turns release flags on cumulatively", () => {
    expect(resolveFeature("release.v1", config("v1")).enabled).toBe(true);
    expect(resolveFeature("release.v11", config("v1"))).toEqual({
      enabled: false,
      reason: "release",
      availableIn: "v1.1",
    });
    expect(resolveFeature("release.v11", config("v1.1")).enabled).toBe(true);
    expect(resolveFeature("release.v2", config("v1.1")).enabled).toBe(false);
    for (const key of Object.keys(RELEASE_FLAG_KEYS)) {
      expect(resolveFeature(key, config("v2")).enabled).toBe(true);
    }
  });

  it("keeps a later-release toggle off whatever its saved value says", () => {
    const toggles = { "assistant.enabled": true };
    expect(resolveFeature("assistant.enabled", config("v1", toggles))).toEqual({
      enabled: false,
      reason: "release",
      availableIn: "v1.1",
    });
    expect(resolveFeature("assistant.enabled", config("v1.1", toggles)).enabled).toBe(true);
  });

  it("uses the default until the organization saves a value, then the saved value", () => {
    expect(resolveFeature("integrations.enabled", config("v1")).enabled).toBe(true);
    expect(resolveFeature("integrations.enabled", config("v1", { "integrations.enabled": false }))).toEqual({
      enabled: false,
      reason: "toggle",
    });
    // Default-off toggle in a release that has reached it.
    expect(resolveFeature("assistant.enabled", config("v1.1")).enabled).toBe(false);
  });

  it("fails closed on an unknown key", () => {
    expect(resolveFeature("nonsense.key", config("v2")).enabled).toBe(false);
    expect(isKnownFeature("nonsense.key")).toBe(false);
    expect(isKnownFeature("release.v11")).toBe(true);
    expect(isKnownFeature("assistant.enabled")).toBe(true);
  });

  it("reads the active release from the environment and falls back to v1", () => {
    expect(globalRelease({} as NodeJS.ProcessEnv)).toBe("v1");
    expect(globalRelease({ ACTIVE_RELEASE: "v1.1" } as unknown as NodeJS.ProcessEnv)).toBe("v1.1");
    expect(globalRelease({ ACTIVE_RELEASE: " V2 " } as unknown as NodeJS.ProcessEnv)).toBe("v2");
    expect(globalRelease({ ACTIVE_RELEASE: "v9" } as unknown as NodeJS.ProcessEnv)).toBe("v1");
    expect(parseRelease(undefined)).toBeUndefined();
  });

  it("has unique toggle keys with a default and a first release", () => {
    expect(new Set(TOGGLES.map((t) => t.key)).size).toBe(TOGGLES.length);
    expect(TOGGLES.every((t) => t.description && ["v1", "v1.1", "v2"].includes(t.minRelease))).toBe(true);
  });
});

describe("requireFeature and the explained response", () => {
  it("lets a V1 feature through and refuses a V1.1 feature while the release is V1", async () => {
    const { org } = await setup();
    await expect(requireFeature(org.id, "integrations.enabled")).resolves.toBeUndefined();
    await expect(requireFeature(org.id, "quotes.enabled")).rejects.toMatchObject({
      name: "FeatureUnavailableError",
      reason: "release",
      availableIn: "v1.1",
    });
  });

  it("opens the V1.1 feature once the release is raised, for the deployment", async () => {
    const { org } = await setup();
    process.env.ACTIVE_RELEASE = "v1.1";
    await expect(requireFeature(org.id, "quotes.enabled")).resolves.toBeUndefined();
    expect(await isFeatureEnabled(org.id, "release.v11")).toBe(true);
    expect(await isFeatureEnabled(org.id, "release.v2")).toBe(false);
  });

  // A stand-in for a V1.1 route: handleRoute plus requireFeature, exactly how a real one is built.
  const v11Route = (organizationId: string) =>
    handleRoute(async () => {
      await requireFeature(organizationId, "quotes.enabled");
      return { quotes: [] };
    });

  it("returns the explained 'not available yet' response from a route when the release flag is off", async () => {
    const { org } = await setup();
    const res = await v11Route(org.id);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(ErrorEnvelopeSchema.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({
      code: "FEATURE_UNAVAILABLE",
      feature: { key: "quotes.enabled", reason: "release", availableIn: "V1.1" },
    });
    expect(body.message).toBe("This feature is not available yet. It is planned for V1.1.");
  });

  it("serves the same route once the flag is on", async () => {
    const { org } = await setup();
    process.env.ACTIVE_RELEASE = "v1.1";
    const res = await v11Route(org.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ quotes: [] });
  });

  it("tells the organization to ask Management when the feature is switched off for them", async () => {
    const { org, mgmt } = await setup();
    await updateFeatureToggles(mgmt, { "integrations.enabled": false });
    const res = await handleRoute(async () => {
      await requireFeature(org.id, "integrations.enabled");
      return {};
    });
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.feature).toEqual({ key: "integrations.enabled", reason: "toggle", availableIn: null });
    expect(body.message).toContain("switched off for your organisation");
    expect(body.message).toContain("Management");
  });

  it("is a typed error services can catch", async () => {
    const { org } = await setup();
    await expect(requireFeature(org.id, "quotes.enabled")).rejects.toBeInstanceOf(FeatureUnavailableError);
  });
});

describe("organisation toggles", () => {
  it("shows every toggle with its default before anything is saved", async () => {
    const { mgmt } = await setup();
    const snap = await getFeatureSnapshot(mgmt);
    expect(snap.release).toBe("v1");
    expect(snap.flags).toMatchObject({
      "release.v1": true,
      "release.v11": false,
      "release.v2": false,
      "integrations.enabled": true,
      "permissions.provisional_departures": true,
      "assistant.enabled": false,
    });
    expect(snap.toggles).toHaveLength(TOGGLES.length);
    const assistant = snap.toggles.find((t) => t.key === "assistant.enabled")!;
    expect(assistant).toMatchObject({ savedValue: null, enabled: false, available: false, minRelease: "v1.1" });
    expect(FeatureSnapshotSchema.safeParse(snap).success).toBe(true);
  });

  it("saves a change, resolves it, and writes an audit entry with the old and new value", async () => {
    const { org, mgmt } = await setup();
    const snap = await updateFeatureToggles(mgmt, {
      "integrations.enabled": false,
      "personalisation.allowed": true, // unchanged from its default: not audited
    });
    expect(snap.flags["integrations.enabled"]).toBe(false);
    expect(snap.toggles.find((t) => t.key === "integrations.enabled")).toMatchObject({
      savedValue: false,
      enabled: false,
    });
    expect(await isFeatureEnabled(org.id, "integrations.enabled")).toBe(false);

    const audit = await adminDb.auditEvent.findMany({
      where: { organizationId: org.id, action: "feature_toggle.changed" },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      entityId: "integrations.enabled",
      actorMembershipId: mgmt.membershipId,
      previousValue: { enabled: true },
      newValue: { enabled: false },
    });

    await updateFeatureToggles(mgmt, { "integrations.enabled": true });
    const again = await adminDb.auditEvent.findMany({
      where: { organizationId: org.id, action: "feature_toggle.changed" },
      orderBy: { createdAt: "asc" },
    });
    expect(again).toHaveLength(2);
    expect(again[1]!.previousValue).toEqual({ enabled: false });
  });

  it("is Management only, validates the keys and refuses a toggle from a release that has not arrived", async () => {
    const { mgmt, sales } = await setup();
    await expect(updateFeatureToggles(sales, { "integrations.enabled": false })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(updateFeatureToggles(mgmt, {})).rejects.toBeInstanceOf(ValidationError);
    await expect(updateFeatureToggles(mgmt, { "made.up": true })).rejects.toBeInstanceOf(ValidationError);
    await expect(updateFeatureToggles(mgmt, { "assistant.enabled": true })).rejects.toThrow(
      /arrives in v1\.1/,
    );
    process.env.ACTIVE_RELEASE = "v1.1";
    const snap = await updateFeatureToggles(mgmt, { "assistant.enabled": true });
    expect(snap.flags["assistant.enabled"]).toBe(true);
  });

  it("keeps each organization's toggles to itself", async () => {
    const a = await setup();
    const b = await setup();
    await updateFeatureToggles(a.mgmt, { "integrations.enabled": false });
    expect(await isFeatureEnabled(a.org.id, "integrations.enabled")).toBe(false);
    expect(await isFeatureEnabled(b.org.id, "integrations.enabled")).toBe(true);
    expect((await getFeatureSnapshot(b.sales)).flags["integrations.enabled"]).toBe(true);
  });
});

describe("per-organization release override", () => {
  it("moves one organization ahead of the deployment and back, with an audit entry each time", async () => {
    const a = await setup();
    const b = await setup();

    expect(await setOrganizationRelease(a.org.id, "v1.1", { userId: a.mgmt.userId })).toBe("v1.1");
    expect(await isFeatureEnabled(a.org.id, "quotes.enabled")).toBe(true);
    expect(await isFeatureEnabled(b.org.id, "quotes.enabled")).toBe(false);
    expect((await loadFeatureConfig(a.org.id)).release).toBe("v1.1");

    expect(await setOrganizationRelease(a.org.id, null)).toBe("v1");
    expect(await isFeatureEnabled(a.org.id, "quotes.enabled")).toBe(false);

    const audit = await adminDb.auditEvent.findMany({
      where: { organizationId: a.org.id, action: "release_override.changed" },
      orderBy: { createdAt: "asc" },
    });
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({
      actorUserId: a.mgmt.userId,
      previousValue: { release: "v1" },
      newValue: { release: "v1.1", override: "v1.1" },
    });
  });

  it("rejects a release that does not exist", async () => {
    const { org } = await setup();
    await expect(setOrganizationRelease(org.id, "v9" as never)).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("features API", () => {
  const get = () =>
    featuresRoute.GET(new Request("http://localhost/api/orgs/x/features"), {
      params: Promise.resolve({ orgSlug: "x" }),
    });
  const patch = (body: unknown) =>
    featuresRoute.PATCH(
      new Request("http://localhost/api/orgs/x/features", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ orgSlug: "x" }) },
    );

  it("lets any member read the flags and only Management change them (flag on and off)", async () => {
    const { mgmt, sales } = await setup();

    current.ctx = sales;
    const read = await get();
    expect(read.status).toBe(200);
    expect(FeatureSnapshotSchema.safeParse(await read.json()).success).toBe(true);
    const denied = await patch({ toggles: { "integrations.enabled": false } });
    expect(denied.status).toBe(403);
    expect((await denied.json()).denial.requiredRoles).toContain("Management");

    current.ctx = mgmt;
    const changed = await patch({ toggles: { "integrations.enabled": false } });
    expect(changed.status).toBe(200);
    expect((await changed.json()).flags["integrations.enabled"]).toBe(false);

    current.ctx = sales;
    expect((await (await get()).json()).flags["integrations.enabled"]).toBe(false);

    current.ctx = mgmt;
    const bad = await patch({ toggles: { "made.up": true } });
    expect(bad.status).toBe(400);
    expect((await bad.json()).fieldErrors[0].path).toBe("made.up");
    expect((await patch({ toggles: { "integrations.enabled": "yes" } })).status).toBe(400);
  });

  it("reflects a raised release in the snapshot clients use to hide navigation", async () => {
    const { mgmt } = await setup();
    current.ctx = mgmt;
    expect((await (await get()).json()).flags["release.v11"]).toBe(false);
    process.env.ACTIVE_RELEASE = "v1.1";
    const body = await (await get()).json();
    expect(body.release).toBe("v1.1");
    expect(body.flags["release.v11"]).toBe(true);
    expect(body.toggles.find((t: { key: string }) => t.key === "quotes.enabled").available).toBe(true);
  });
});
