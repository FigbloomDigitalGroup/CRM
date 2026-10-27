import type { Prisma } from "@prisma/client";
import { adminDb } from "../db/adminClient";

/**
 * The organisation's data-protection settings (FIG-1062, B4.05): who may export in bulk and when a bulk export needs approval, how
 * long each kind of data is kept, and the legal hold. Read from one place by the export checks, the retention job and the screens.
 * Storage is `organization_settings`, one JSON value per key.
 */

export const EXPORT_RIGHTS_KEY = "privacy.export";
export const RETENTION_KEY = "privacy.retention";
export const LEGAL_HOLD_KEY = "privacy.legal_hold";
export const ORG_REQUESTS_KEY = "privacy.organisation_requests";

export interface ExportRights {
  /** Roles that may export above the threshold without asking (Management always may). */
  allowedRoleKeys: string[];
  /** An export of more rows than this needs approval, from anyone not in `allowedRoleKeys`. */
  approvalThreshold: number;
  /** How long an approval stays usable. */
  approvalExpiryHours: number;
}

export const DEFAULT_EXPORT_RIGHTS: ExportRights = { allowedRoleKeys: ["MANAGEMENT"], approvalThreshold: 500, approvalExpiryHours: 72 };
export const THRESHOLD_RANGE = { min: 1, max: 100_000 } as const;
export const EXPIRY_RANGE = { min: 1, max: 720 } as const;

export interface RetentionType {
  key: string;
  label: string;
  unit: "days" | "months";
  /** The documented default; null means kept until someone decides otherwise. */
  default: number | null;
  min: number;
  max: number;
  description: string;
}

/** Each kind of data an organisation can set a retention period for, with the documented default. */
export const RETENTION_TYPES: readonly RetentionType[] = [
  { key: "signInEvents", label: "Sign-in history", unit: "months", default: 24, min: 3, max: 120, description: "Who signed in, from where. Used for security review." },
  { key: "importFiles", label: "Uploaded import files", unit: "days", default: 90, min: 7, max: 3650, description: "The spreadsheets uploaded for a data migration." },
  { key: "exportFiles", label: "Generated export files", unit: "days", default: 30, min: 1, max: 3650, description: "The files made by exports and reports." },
  { key: "syncQueue", label: "Offline sync history", unit: "days", default: 90, min: 7, max: 3650, description: "What each phone sent from its offline queue." },
  { key: "automationRuns", label: "Automation run log", unit: "days", default: 365, min: 30, max: 3650, description: "What each automation rule did." },
  { key: "archivedLeads", label: "Archived leads", unit: "months", default: null, min: 12, max: 240, description: "Leads someone archived. Kept until you set a period." },
  { key: "archivedTasks", label: "Archived tasks", unit: "months", default: null, min: 6, max: 240, description: "Tasks someone archived. Kept until you set a period." },
];

export type RetentionSettings = Record<string, number | null>;

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

async function readSetting(organizationId: string, key: string): Promise<unknown> {
  return (await adminDb.organizationSetting.findUnique({ where: { organizationId_key: { organizationId, key } } }))?.value;
}

export async function writeSetting(organizationId: string, key: string, value: Prisma.InputJsonValue): Promise<void> {
  await adminDb.organizationSetting.upsert({
    where: { organizationId_key: { organizationId, key } },
    update: { value },
    create: { organizationId, key, value },
  });
}

export async function loadExportRights(organizationId: string): Promise<ExportRights> {
  const v = asObject(await readSetting(organizationId, EXPORT_RIGHTS_KEY));
  const roles = Array.isArray(v.allowedRoleKeys) ? v.allowedRoleKeys.filter((r): r is string => typeof r === "string") : DEFAULT_EXPORT_RIGHTS.allowedRoleKeys;
  const threshold = typeof v.approvalThreshold === "number" && Number.isInteger(v.approvalThreshold) ? v.approvalThreshold : DEFAULT_EXPORT_RIGHTS.approvalThreshold;
  const expiry = typeof v.approvalExpiryHours === "number" && Number.isInteger(v.approvalExpiryHours) ? v.approvalExpiryHours : DEFAULT_EXPORT_RIGHTS.approvalExpiryHours;
  return {
    // Management can always export: it is the role that approves.
    allowedRoleKeys: [...new Set(["MANAGEMENT", ...roles])],
    approvalThreshold: Math.min(Math.max(threshold, THRESHOLD_RANGE.min), THRESHOLD_RANGE.max),
    approvalExpiryHours: Math.min(Math.max(expiry, EXPIRY_RANGE.min), EXPIRY_RANGE.max),
  };
}

export async function loadRetention(organizationId: string): Promise<RetentionSettings> {
  const v = asObject(await readSetting(organizationId, RETENTION_KEY));
  const out: RetentionSettings = {};
  for (const t of RETENTION_TYPES) {
    const set = v[t.key];
    out[t.key] = set === null ? null : typeof set === "number" && Number.isInteger(set) && set >= t.min && set <= t.max ? set : t.default;
  }
  return out;
}

export interface LegalHold {
  active: boolean;
  reason: string | null;
  since: string | null;
  byMembershipId: string | null;
}

export async function loadLegalHold(organizationId: string): Promise<LegalHold> {
  const v = asObject(await readSetting(organizationId, LEGAL_HOLD_KEY));
  return {
    active: v.active === true,
    reason: typeof v.reason === "string" ? v.reason : null,
    since: typeof v.since === "string" ? v.since : null,
    byMembershipId: typeof v.byMembershipId === "string" ? v.byMembershipId : null,
  };
}

// ---------------------------------------------------------------------------
// Export approvals: one use, for one person and one entity, within a window
// ---------------------------------------------------------------------------

import { withOrgContext } from "../db/orgScopedClient";

/**
 * Spends an approved export approval: it must be this person's, for this kind of export, approved, unused, unexpired and at least as
 * big as the export. Returns false if any of that is not so. The update is conditional, so two exports cannot spend one approval.
 */
export async function consumeExportApproval(
  organizationId: string,
  membershipId: string,
  approvalId: string,
  entity: string,
  rowCount: number,
  now = new Date(),
): Promise<boolean> {
  return withOrgContext(organizationId, async (tx) => {
    const spent = await tx.exportApproval.updateMany({
      where: {
        id: approvalId,
        organizationId,
        requestedByMembershipId: membershipId,
        entity,
        status: "APPROVED",
        rowCount: { gte: rowCount },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      data: { status: "USED", usedAt: now },
    });
    return spent.count === 1;
  });
}
