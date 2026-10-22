import type { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { ValidationError } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import { recordAuditEvent } from "../repositories/auditEvents";
import {
  FeatureUnavailableError,
  RELEASE_FLAG_KEYS,
  RELEASES,
  TOGGLES,
  findToggle,
  globalRelease,
  parseRelease,
  resolveFeature,
  type FeatureConfig,
  type Release,
} from "../lib/featureFlags";

const TOGGLES_KEY = "feature_toggles";
const RELEASE_KEY = "release_override";

/** The organization's effective release and saved toggle values. */
export async function loadFeatureConfig(organizationId: string): Promise<FeatureConfig> {
  const rows = await adminDb.organizationSetting.findMany({
    where: { organizationId, key: { in: [TOGGLES_KEY, RELEASE_KEY] } },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));

  const rawToggles = byKey.get(TOGGLES_KEY);
  const toggles: Record<string, boolean> = {};
  if (rawToggles && typeof rawToggles === "object" && !Array.isArray(rawToggles)) {
    for (const [key, value] of Object.entries(rawToggles)) {
      if (typeof value === "boolean") toggles[key] = value;
    }
  }
  const override = byKey.get(RELEASE_KEY) as { release?: string } | null | undefined;
  return {
    release: parseRelease(override?.release) ?? globalRelease(),
    toggles,
  };
}

export async function isFeatureEnabled(organizationId: string, key: string) {
  return resolveFeature(key, await loadFeatureConfig(organizationId)).enabled;
}

/**
 * Gate for routes and services: returns when the feature is on for the
 * caller's organization, otherwise throws `FeatureUnavailableError`, which
 * the route wrapper returns as the explained "not available yet" response
 * (403, code `FEATURE_UNAVAILABLE`).
 *
 *   const ctx = await resolveRequestContext(orgSlug);
 *   await requireFeature(ctx.organizationId, "quotes.enabled");
 */
export async function requireFeature(organizationId: string, key: string) {
  const resolution = resolveFeature(key, await loadFeatureConfig(organizationId));
  if (!resolution.enabled) {
    throw new FeatureUnavailableError(
      key,
      resolution.reason ?? "toggle",
      resolution.availableIn ?? null,
    );
  }
}

/**
 * Everything a client needs to show or hide a feature: the organization's
 * release, every flag resolved to on/off, and the toggle list with defaults.
 * Readable by any member (the navigation needs it).
 */
export async function getFeatureSnapshot(ctx: AuthContext) {
  const config = await loadFeatureConfig(ctx.organizationId);
  const flags: Record<string, boolean> = {};
  for (const key of Object.keys(RELEASE_FLAG_KEYS)) {
    flags[key] = resolveFeature(key, config).enabled;
  }
  for (const toggle of TOGGLES) {
    flags[toggle.key] = resolveFeature(toggle.key, config).enabled;
  }
  return {
    release: config.release,
    flags,
    toggles: TOGGLES.map((t) => {
      const resolution = resolveFeature(t.key, config);
      return {
        key: t.key,
        description: t.description,
        defaultValue: t.defaultValue,
        minRelease: t.minRelease,
        /** The value the organization saved, or null while it uses the default. */
        savedValue: config.toggles[t.key] ?? null,
        enabled: resolution.enabled,
        /** False while the active release has not reached `minRelease`. */
        available: resolution.reason !== "release",
      };
    }),
  };
}

/**
 * Switches toggles for the caller's organization. Management only
 * (`organization.manage_settings`). A toggle whose release has not arrived
 * cannot be changed yet, and every change is audited with its old and new
 * value.
 */
export async function updateFeatureToggles(
  ctx: AuthContext,
  changes: Record<string, boolean>,
) {
  requirePermission(ctx, "organization.manage_settings");
  const entries = Object.entries(changes);
  if (entries.length === 0) {
    throw new ValidationError("Send at least one toggle to change.");
  }
  const config = await loadFeatureConfig(ctx.organizationId);

  for (const [key, value] of entries) {
    const toggle = findToggle(key);
    if (!toggle) {
      throw new ValidationError(`Unknown feature toggle "${key}".`, [
        { path: key, message: "Unknown feature toggle." },
      ]);
    }
    if (typeof value !== "boolean") {
      throw new ValidationError(`Toggle "${key}" must be true or false.`, [
        { path: key, message: "Must be true or false." },
      ]);
    }
    const resolution = resolveFeature(key, config);
    if (resolution.reason === "release") {
      throw new ValidationError(
        `"${key}" cannot be changed yet: it arrives in ${toggle.minRelease}.`,
        [{ path: key, message: `Not available until ${toggle.minRelease}.` }],
      );
    }
  }

  const next = { ...config.toggles };
  const audits: { key: string; previous: boolean; value: boolean }[] = [];
  for (const [key, value] of entries) {
    const previous = config.toggles[key] ?? findToggle(key)!.defaultValue;
    next[key] = value;
    if (previous !== value) audits.push({ key, previous, value });
  }

  await adminDb.organizationSetting.upsert({
    where: {
      organizationId_key: { organizationId: ctx.organizationId, key: TOGGLES_KEY },
    },
    update: { value: next as unknown as Prisma.InputJsonValue },
    create: {
      organizationId: ctx.organizationId,
      key: TOGGLES_KEY,
      value: next as unknown as Prisma.InputJsonValue,
    },
  });
  for (const a of audits) {
    await recordAuditEvent({
      organizationId: ctx.organizationId,
      actorMembershipId: ctx.membershipId,
      action: "feature_toggle.changed",
      entityType: "FeatureToggle",
      entityId: a.key,
      previousValue: { enabled: a.previous },
      newValue: { enabled: a.value },
    });
  }
  return getFeatureSnapshot(ctx);
}

/**
 * Moves one organization to a different release than the deployment's (a
 * pilot customer ahead of the rest), or back to the deployment's with
 * `null`. Not exposed over HTTP: it belongs to the platform console (B6), so
 * for now it is for scripts and tests. Audited.
 */
export async function setOrganizationRelease(
  organizationId: string,
  release: Release | null,
  actor: { userId?: string } = {},
) {
  if (release !== null && !(RELEASES as readonly string[]).includes(release)) {
    throw new ValidationError(`Release must be one of ${RELEASES.join(", ")}.`);
  }
  const previous = (await loadFeatureConfig(organizationId)).release;
  if (release === null) {
    await adminDb.organizationSetting.deleteMany({
      where: { organizationId, key: RELEASE_KEY },
    });
  } else {
    await adminDb.organizationSetting.upsert({
      where: { organizationId_key: { organizationId, key: RELEASE_KEY } },
      update: { value: { release } },
      create: { organizationId, key: RELEASE_KEY, value: { release } },
    });
  }
  const effective = (await loadFeatureConfig(organizationId)).release;
  await recordAuditEvent({
    organizationId,
    actorUserId: actor.userId,
    action: "release_override.changed",
    entityType: "Release",
    previousValue: { release: previous },
    newValue: { release: effective, override: release },
  });
  return effective;
}
