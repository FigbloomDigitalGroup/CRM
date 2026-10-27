import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { NotFoundError, ValidationError } from "../auth/errors";
import { generateInboundEmailKey } from "../auth/inboundEmailKey";
import { generateWebsiteApiKey } from "../auth/websiteApiKey";
import { adminDb } from "../db/adminClient";
import {
  WEBSITE_LEAD_ASSIGNMENT_MODE_SETTING_KEY,
  type WebsiteLeadAssignmentMode,
} from "../repositories/leadIngestion";
import { recordAuditEvent } from "../repositories/auditEvents";
import {
  getInboundEmailKeyRecord,
  revokeInboundEmailKey as revokeInboundEmailKeyRow,
  setInboundEmailKey,
} from "../repositories/inboundEmailKeys";
import {
  getWebsiteApiKeyRecord,
  revokeWebsiteApiKey as revokeWebsiteApiKeyRow,
  setWebsiteApiKey,
  updateWebsiteApiKeySecurity,
  type WebsiteApiKeySecuritySettings,
} from "../repositories/websiteApiKeys";
import {
  latestRejectedWebsiteLeadRequest,
  listRecentWebsiteLeadRequests,
  listRejectedWebsiteLeadRequests,
} from "../repositories/websiteLeadRequestLog";
import { buildPage, resolvePaging, type PageRequest } from "../lib/pagination";

/** B4.01: how long the old website key keeps working after a rotation unless the caller says otherwise. */
export const DEFAULT_KEY_GRACE_HOURS = 24;
export const MAX_KEY_GRACE_HOURS = 72;

/** What each rejection outcome means, in words a person can act on (B4.01 rejected submissions list). */
export const REJECTION_EXPLANATIONS: Record<string, string> = {
  RATE_LIMITED: "Too many requests from one address or key in a short time.",
  INVALID_KEY: "The request used a missing, wrong, revoked or expired website key.",
  ORIGIN_NOT_ALLOWED: "The request came from a website that is not on the allowed list.",
  PAYLOAD_TOO_LARGE: "The submission was larger than the limit.",
  VALIDATION_FAILED: "The submission was missing a required field or was not valid.",
  HONEYPOT_TRIGGERED: "A hidden field was filled in, which is what a bot does. It was discarded.",
  CAPTCHA_FAILED: "The captcha check failed or was missing.",
};

/**
 * Reuses `configuration.manage` (Management-only) rather than inventing a
 * new permission -- this is the same "who's allowed to change how the org
 * is set up" bucket as pipeline stages and lead sources.
 */
const PERMISSION = "configuration.manage";

export async function getWebsiteIntegrationStatus(ctx: AuthContext) {
  requirePermission(ctx, PERMISSION);
  const record = await getWebsiteApiKeyRecord(ctx.organizationId);
  if (!record) {
    return { configured: false as const };
  }
  const lastRejected = await latestRejectedWebsiteLeadRequest(ctx.organizationId);
  const graceActive =
    record.previousKeyHash !== null && record.previousKeyExpiresAt !== null && record.previousKeyExpiresAt.getTime() > Date.now();
  return {
    configured: true as const,
    keyPrefix: record.keyPrefix,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
    /** B4.01: when the key was last rotated, and whether the key it replaced still works. */
    rotatedAt: record.rotatedAt,
    previousKey: graceActive
      ? { keyPrefix: record.previousKeyPrefix, validUntil: record.previousKeyExpiresAt }
      : null,
    lastAcceptedAt: record.lastAcceptedAt,
    lastRejectedAt: record.lastRejectedAt,
    lastRejection: lastRejected
      ? {
          at: lastRejected.createdAt,
          outcome: lastRejected.outcome,
          reason: lastRejected.reason,
          explanation: REJECTION_EXPLANATIONS[lastRejected.outcome] ?? null,
        }
      : null,
    revoked: record.revokedAt !== null,
    // The captcha secret itself is never returned to the client -- only
    // whether one is set, so the UI can show "configured" without being
    // able to leak it back out.
    allowedOrigins: record.allowedOrigins,
    honeypotFieldName: record.honeypotFieldName,
    captchaConfigured: record.captchaSecret !== null,
  };
}

/**
 * Returns the new key's plaintext exactly once -- it is never retrievable
 * again, only its hash is stored (see src/auth/websiteApiKey.ts). Rotating
 * replaces the previous key immediately; there is no overlap window (see
 * the WebsiteApiKey model's doc comment in prisma/schema.prisma for why).
 */
export async function regenerateWebsiteApiKey(ctx: AuthContext, options: { graceHours?: number } = {}) {
  requirePermission(ctx, PERMISSION);

  const graceHours = options.graceHours ?? DEFAULT_KEY_GRACE_HOURS;
  if (!Number.isFinite(graceHours) || graceHours < 0 || graceHours > MAX_KEY_GRACE_HOURS) {
    throw new ValidationError(`graceHours must be between 0 and ${MAX_KEY_GRACE_HOURS}.`, [
      { path: "graceHours", message: `Choose 0 to switch the old key off at once, or up to ${MAX_KEY_GRACE_HOURS} hours.` },
    ]);
  }

  const { plaintext, keyHash, keyPrefix } = generateWebsiteApiKey();
  await setWebsiteApiKey(ctx.organizationId, {
    keyHash,
    keyPrefix,
    createdByMembershipId: ctx.membershipId,
    graceMs: Math.round(graceHours * 3_600_000),
  });

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "website_api_key.regenerated",
    entityType: "WebsiteApiKey",
    entityId: ctx.organizationId,
    metadata: { keyPrefix, graceHours },
  });

  const validUntil = graceHours > 0 ? new Date(Date.now() + graceHours * 3_600_000) : null;
  return { apiKey: plaintext, keyPrefix, previousKeyValidUntil: validUntil };
}

/**
 * Disables the integration outright, distinct from rotating (FIG-594):
 * rotation always leaves a new working key behind, revoke leaves none.
 * The key row (and its settings) are kept, not deleted -- regenerating
 * later clears `revokedAt` and re-enables it with a fresh key.
 */
export async function revokeWebsiteApiKey(ctx: AuthContext) {
  requirePermission(ctx, PERMISSION);

  const record = await getWebsiteApiKeyRecord(ctx.organizationId);
  if (!record) {
    throw new ValidationError("No website API key exists to revoke.");
  }

  await revokeWebsiteApiKeyRow(ctx.organizationId);

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "website_api_key.revoked",
    entityType: "WebsiteApiKey",
    entityId: ctx.organizationId,
    metadata: { keyPrefix: record.keyPrefix },
  });
}

/**
 * Updates the optional abuse-protection settings (FIG-594) -- all three
 * are optional per the ticket, so `undefined` here means "leave unchanged,"
 * not "clear it" (see `updateWebsiteApiKeySecurity`'s repository-level
 * distinction).
 */
export async function updateWebsiteApiKeySettings(
  ctx: AuthContext,
  settings: WebsiteApiKeySecuritySettings,
) {
  requirePermission(ctx, PERMISSION);

  // Settings belong to an existing key; with none yet there is nothing to update (this was a 500 from the missing row).
  if (!(await getWebsiteApiKeyRecord(ctx.organizationId))) throw new NotFoundError("Website API key", ctx.organizationId);
  const updated = await updateWebsiteApiKeySecurity(ctx.organizationId, settings);

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "website_api_key.settings_updated",
    entityType: "WebsiteApiKey",
    entityId: ctx.organizationId,
    metadata: {
      allowedOrigins: settings.allowedOrigins,
      honeypotFieldName: settings.honeypotFieldName,
      captchaConfigured:
        settings.captchaSecret !== undefined
          ? settings.captchaSecret !== null
          : undefined,
    },
  });

  return {
    allowedOrigins: updated.allowedOrigins,
    honeypotFieldName: updated.honeypotFieldName,
    captchaConfigured: updated.captchaSecret !== null,
  };
}

/**
 * Submissions the website endpoint turned away, newest first, each with the reason in plain words (B4.01).
 * Management only: the rows carry the sender address.
 */
export async function listRejectedWebsiteSubmissions(
  ctx: AuthContext,
  query: { outcome?: string; paging?: PageRequest } = {},
) {
  requirePermission(ctx, PERMISSION);
  if (query.outcome !== undefined && !(query.outcome in REJECTION_EXPLANATIONS)) {
    throw new ValidationError(`"${query.outcome}" is not a rejection reason.`, [
      { path: "outcome", message: `Use one of: ${Object.keys(REJECTION_EXPLANATIONS).join(", ")}.` },
    ]);
  }
  const paging = resolvePaging(query.paging);
  const { rows, total } = await listRejectedWebsiteLeadRequests(ctx.organizationId, {
    outcome: query.outcome,
    skip: paging.skip,
    take: paging.take,
  });
  const items = rows.map((r) => ({
    id: r.id,
    at: r.createdAt,
    outcome: r.outcome,
    reason: r.reason,
    explanation: REJECTION_EXPLANATIONS[r.outcome] ?? null,
    origin: r.origin,
    ipAddress: r.ipAddress,
  }));
  return buildPage(items, total, paging);
}

/** Recent accepted/rejected requests to the public endpoint, for monitoring (FIG-594). */
export async function listRecentWebsiteActivity(ctx: AuthContext, limit = 25) {
  requirePermission(ctx, PERMISSION);
  return listRecentWebsiteLeadRequests(ctx.organizationId, limit);
}

// ---------------------------------------------------------------------------
// Inbound email webhook (FIG-598) -- same generate/revoke shape as the
// website key above, a separate credential/trust boundary (see
// src/auth/inboundEmailKey.ts's header comment).
// ---------------------------------------------------------------------------

export async function getInboundEmailIntegrationStatus(ctx: AuthContext) {
  requirePermission(ctx, PERMISSION);
  const record = await getInboundEmailKeyRecord(ctx.organizationId);
  if (!record) {
    return { configured: false as const };
  }
  return {
    configured: true as const,
    keyPrefix: record.keyPrefix,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
    /** B4.01: when mail last arrived, and the last message that could not be processed (cleared by the next good one). */
    lastReceivedAt: record.lastUsedAt,
    lastError: record.lastError ? { at: record.lastErrorAt, message: record.lastError } : null,
    revoked: record.revokedAt !== null,
  };
}

export async function regenerateInboundEmailKey(ctx: AuthContext) {
  requirePermission(ctx, PERMISSION);

  const { plaintext, keyHash, keyPrefix } = generateInboundEmailKey();
  await setInboundEmailKey(ctx.organizationId, {
    keyHash,
    keyPrefix,
    createdByMembershipId: ctx.membershipId,
  });

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "inbound_email_key.regenerated",
    entityType: "InboundEmailKey",
    entityId: ctx.organizationId,
    metadata: { keyPrefix },
  });

  return { token: plaintext, keyPrefix };
}

export async function revokeInboundEmailKey(ctx: AuthContext) {
  requirePermission(ctx, PERMISSION);

  const record = await getInboundEmailKeyRecord(ctx.organizationId);
  if (!record) {
    throw new ValidationError("No inbound email token exists to revoke.");
  }

  await revokeInboundEmailKeyRow(ctx.organizationId);

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "inbound_email_key.revoked",
    entityType: "InboundEmailKey",
    entityId: ctx.organizationId,
    metadata: { keyPrefix: record.keyPrefix },
  });
}

// ---------------------------------------------------------------------------
// Website lead assignment rules (FIG-599) -- currently a single on/off
// switch for the fixed round-robin in src/repositories/leadIngestion.ts, not
// a full rules engine (still FIG-436, not built here). "Unassigned" simply
// leaves every new website lead unowned for someone to triage manually.
// ---------------------------------------------------------------------------

export async function getWebsiteAssignmentSetting(
  ctx: AuthContext,
): Promise<{ mode: WebsiteLeadAssignmentMode }> {
  requirePermission(ctx, PERMISSION);
  const setting = await adminDb.organizationSetting.findUnique({
    where: {
      organizationId_key: {
        organizationId: ctx.organizationId,
        key: WEBSITE_LEAD_ASSIGNMENT_MODE_SETTING_KEY,
      },
    },
  });
  const mode = (setting?.value as { mode?: string } | null)?.mode;
  return { mode: mode === "UNASSIGNED" ? "UNASSIGNED" : "ROUND_ROBIN" };
}

export async function setWebsiteAssignmentSetting(
  ctx: AuthContext,
  mode: WebsiteLeadAssignmentMode,
): Promise<{ mode: WebsiteLeadAssignmentMode }> {
  requirePermission(ctx, PERMISSION);

  await adminDb.organizationSetting.upsert({
    where: {
      organizationId_key: {
        organizationId: ctx.organizationId,
        key: WEBSITE_LEAD_ASSIGNMENT_MODE_SETTING_KEY,
      },
    },
    update: { value: { mode } },
    create: {
      organizationId: ctx.organizationId,
      key: WEBSITE_LEAD_ASSIGNMENT_MODE_SETTING_KEY,
      value: { mode },
    },
  });

  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "website_lead_assignment.updated",
    entityType: "OrganizationSetting",
    entityId: ctx.organizationId,
    metadata: { mode },
  });

  return { mode };
}
