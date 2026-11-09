import type { Prisma } from "@prisma/client";
import { NotFoundError, ValidationError } from "../auth/errors";
import type { PlatformContext } from "../auth/platformSession";
import { adminDb } from "../db/adminClient";
import { getPlatformDb } from "../db/platformClient";
import { PLATFORM_FLAGS_KEY, loadFeatureConfig } from "../lib/featureConfig";
import { RELEASE_LABEL, TOGGLES, findToggle, resolveFeature } from "../lib/featureFlags";
import { recordAuditEvent } from "../repositories/auditEvents";
import { invalidateMeContext } from "./meContextCache";
import { LIMITS_SETTING_KEY, LIMIT_KEYS, getUsage, loadLimits, validateLimitChanges, type LimitKey, type OrgLimits } from "./orgLimitService";
import { cleanReason } from "./organizationLifecycleService";
import { listAuditEvents, recordPlatformAudit } from "./platformAuditService";

/**
 * Flags and limits for one organisation, as the platform console sees and changes them (FIG-1184, B7.02, screen PL12).
 *
 * A flag here is a *platform override* of one of the organisation toggles (`TOGGLES`): the platform fixes it on or off and the
 * organisation can no longer change it from Settings (`updateFeatureToggles` answers "managed by Figbloom"). Removing the override gives
 * the toggle back to the organisation. An override never beats the release: a V2 feature stays off in a V1 organisation.
 *
 * Limits (seats, storage, API calls) are in `orgLimitService`. Reading goes through the schema-owner client for the settings rows and the
 * counts, and returns numbers and switches only: no customer record, name or value. Every change needs a written reason, a fresh
 * second-step proof (the route checks it) and writes one platform audit entry per flag or limit changed, plus a line in the organisation's
 * own history that names no reason.
 */

export const FLAGS_AUDIT_ACTION = "organization.flags.changed";
export const LIMITS_AUDIT_ACTION = "organization.limits.changed";

async function requireOrganization(organizationId: string) {
  const row = await getPlatformDb().$queryRaw<{ organization_id: string; slug: string; name: string; status: string }[]>`
    SELECT organization_id, slug, name, status FROM platform_organization_counts WHERE organization_id = ${organizationId}`;
  const org = row[0];
  if (!org) throw new NotFoundError("Organization", organizationId);
  return org;
}

async function loadOverrides(organizationId: string): Promise<Record<string, boolean>> {
  return (await loadFeatureConfig(organizationId)).platformOverrides ?? {};
}

export interface FlagRow {
  key: string;
  description: string;
  minRelease: string;
  /** False while the organisation's release has not reached the toggle's release. */
  available: boolean;
  defaultValue: boolean;
  /** What the organisation saved for itself, or null while it uses the default. */
  organizationValue: boolean | null;
  /** What the platform fixed, or null while the organisation decides. */
  platformValue: boolean | null;
  /** What is actually in force. */
  effective: boolean;
}

export async function getOrganizationFlags(organizationId: string) {
  const org = await requireOrganization(organizationId);
  const config = await loadFeatureConfig(organizationId);
  const flags: FlagRow[] = TOGGLES.map((t) => {
    const resolution = resolveFeature(t.key, config);
    return {
      key: t.key,
      description: t.description,
      minRelease: RELEASE_LABEL[t.minRelease],
      available: resolution.reason !== "release",
      defaultValue: t.defaultValue,
      organizationValue: config.toggles[t.key] ?? null,
      platformValue: config.platformOverrides?.[t.key] ?? null,
      effective: resolution.enabled,
    };
  });
  const { limits, usage } = await getUsage(organizationId);
  const [flagEvents, limitEvents] = await Promise.all([
    listAuditEvents({ organizationId, action: FLAGS_AUDIT_ACTION, limit: 25 }),
    listAuditEvents({ organizationId, action: LIMITS_AUDIT_ACTION, limit: 25 }),
  ]);
  const history = [...flagEvents.items, ...limitEvents.items]
    .sort((a, b) => b.seq - a.seq)
    .slice(0, 25)
    .map((e) => ({
      at: e.occurredAt,
      by: e.actorLabel,
      kind: e.action === FLAGS_AUDIT_ACTION ? ("flag" as const) : ("limit" as const),
      key: String(e.metadata.key ?? ""),
      from: (e.metadata.from ?? null) as boolean | number | null,
      to: (e.metadata.to ?? null) as boolean | number | null,
      reason: e.reason,
    }));
  return {
    organization: { id: org.organization_id, slug: org.slug, name: org.name, status: org.status },
    release: config.release,
    releaseLabel: RELEASE_LABEL[config.release],
    flags,
    limits,
    usage,
    history,
  };
}

export interface FlagsChange {
  /** `true` or `false` fixes the toggle; `null` gives it back to the organisation. */
  flags?: Record<string, boolean | null>;
  /** A number sets a limit; `null` removes it. */
  limits?: Record<string, number | null>;
  reason?: string;
}

export async function updateOrganizationFlags(
  actor: Pick<PlatformContext, "identityId" | "email">,
  organizationId: string,
  change: FlagsChange,
  options: { requestId?: string | null } = {},
) {
  const reason = cleanReason(change.reason);
  const flagEntries = Object.entries(change.flags ?? {});
  const limitEntries = Object.entries(change.limits ?? {});
  if (flagEntries.length === 0 && limitEntries.length === 0) {
    throw new ValidationError("Send at least one flag or limit to change.");
  }
  const org = await requireOrganization(organizationId);
  if (org.status === "OFFBOARDED") {
    throw new ValidationError("This organisation has been offboarded; its flags and limits cannot be changed.");
  }

  const problems: { path: string; message: string }[] = [];
  for (const [key, value] of flagEntries) {
    if (!findToggle(key)) problems.push({ path: `flags.${key}`, message: "Unknown flag." });
    else if (value !== null && typeof value !== "boolean") problems.push({ path: `flags.${key}`, message: "Use true, false or null." });
  }
  if (problems.length > 0) throw new ValidationError("Check the flags.", problems);
  const limitChanges = validateLimitChanges(Object.fromEntries(limitEntries));

  const overrides = { ...(await loadOverrides(organizationId)) };
  const previousLimits = await loadLimits(organizationId);
  const nextLimits: OrgLimits = { ...previousLimits };

  const flagAudits: { key: string; from: boolean | null; to: boolean | null }[] = [];
  for (const [key, value] of flagEntries) {
    const from = overrides[key] ?? null;
    if (value === null) delete overrides[key];
    else overrides[key] = value as boolean;
    if (from !== value) flagAudits.push({ key, from, to: value as boolean | null });
  }
  const limitAudits: { key: LimitKey; from: number | null; to: number | null }[] = [];
  for (const key of LIMIT_KEYS) {
    if (!(key in limitChanges)) continue;
    const to = limitChanges[key] ?? null;
    if (previousLimits[key] !== to) limitAudits.push({ key, from: previousLimits[key], to });
    nextLimits[key] = to;
  }
  if (flagAudits.length === 0 && limitAudits.length === 0) {
    return getOrganizationFlags(organizationId);
  }

  await adminDb.$transaction(async (tx) => {
    if (flagAudits.length > 0) {
      const value = overrides as unknown as Prisma.InputJsonValue;
      await tx.organizationSetting.upsert({
        where: { organizationId_key: { organizationId, key: PLATFORM_FLAGS_KEY } },
        update: { value },
        create: { organizationId, key: PLATFORM_FLAGS_KEY, value },
      });
    }
    if (limitAudits.length > 0) {
      const value = nextLimits as unknown as Prisma.InputJsonValue;
      await tx.organizationSetting.upsert({
        where: { organizationId_key: { organizationId, key: LIMITS_SETTING_KEY } },
        update: { value },
        create: { organizationId, key: LIMITS_SETTING_KEY, value },
      });
    }
    for (const a of flagAudits) {
      await recordPlatformAudit(tx, {
        actorIdentityId: actor.identityId,
        actorLabel: actor.email,
        action: FLAGS_AUDIT_ACTION,
        targetType: "FeatureFlag",
        targetId: a.key,
        organizationId,
        organizationSlug: org.slug,
        reason,
        metadata: { key: a.key, from: a.from, to: a.to },
        requestId: options.requestId ?? null,
      });
    }
    for (const a of limitAudits) {
      await recordPlatformAudit(tx, {
        actorIdentityId: actor.identityId,
        actorLabel: actor.email,
        action: LIMITS_AUDIT_ACTION,
        targetType: "OrganizationLimit",
        targetId: a.key,
        organizationId,
        organizationSlug: org.slug,
        reason,
        metadata: { key: a.key, from: a.from, to: a.to },
        requestId: options.requestId ?? null,
      });
    }
  });

  // The organisation's own history shows that Figbloom changed something (not why: that is between the platform and the organisation's contact).
  for (const a of flagAudits) {
    await recordAuditEvent({
      organizationId,
      action: "platform_flag.changed",
      entityType: "FeatureToggle",
      entityId: a.key,
      previousValue: { platformValue: a.from },
      newValue: { platformValue: a.to },
    });
  }
  for (const a of limitAudits) {
    await recordAuditEvent({
      organizationId,
      action: "platform_limit.changed",
      entityType: "OrganizationLimit",
      entityId: a.key,
      previousValue: { limit: a.from },
      newValue: { limit: a.to },
    });
  }
  invalidateMeContext({ organizationId });
  return getOrganizationFlags(organizationId);
}
