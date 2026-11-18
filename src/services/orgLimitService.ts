import { Prisma } from "@prisma/client";
import { ValidationError } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import { ApiError } from "../lib/apiErrors";

/**
 * Limits per organisation and what is counted against them (FIG-1184, B7.02, screen PL12).
 *
 * The platform sets three limits for an organisation; an empty one means "no limit":
 *
 *   seats             members who are ACTIVE or invited and not yet accepted (PENDING). Deactivated and removed members use no seat.
 *   storageMb         the size of the organisation's stored files (uploading or ready; deleted and quarantined files do not count).
 *   apiCallsPerMonth  calls made with the organisation's API tokens (FIG-805), counted per calendar month (UTC).
 *
 * They are saved as one `organization_settings` row (`platform_limits`), so they travel with the organisation and need no extra table.
 * Everything counted is a number: no record, name or value of the organisation is read to produce a usage figure.
 *
 * Enforcement is a plain check at the place the thing is created (`inviteMember`, `reactivateMember`, `createUpload`, the API token
 * guard calling `recordApiCall`). A limit set below what is already used does not remove anything; it only stops more being added.
 */

export const LIMIT_KEYS = ["seats", "storageMb", "apiCallsPerMonth"] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];
export type OrgLimits = Record<LimitKey, number | null>;

export const LIMITS_SETTING_KEY = "platform_limits";
export const API_CALLS_METRIC = "API_CALLS";

export const LIMIT_BOUNDS: Record<LimitKey, { min: number; max: number; label: string }> = {
  seats: { min: 1, max: 100_000, label: "Seats" },
  storageMb: { min: 1, max: 10_000_000, label: "Storage (MB)" },
  apiCallsPerMonth: { min: 1, max: 1_000_000_000, label: "API calls per month" },
};

const MB = 1024 * 1024;

/** 403 with a friendly message and a stable field code (`LIMIT_REACHED`) the screens can react to. */
export class LimitReachedError extends ApiError {
  constructor(
    readonly limit: LimitKey,
    message: string,
    status = 403,
  ) {
    super(status, status === 429 ? "RATE_LIMITED" : "FORBIDDEN", message);
    this.name = "LimitReachedError";
  }
}

export function emptyLimits(): OrgLimits {
  return { seats: null, storageMb: null, apiCallsPerMonth: null };
}

/** What a value read from the settings row means; anything that is not a whole number in range is ignored. */
export function parseLimits(raw: unknown): OrgLimits {
  const limits = emptyLimits();
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const key of LIMIT_KEYS) {
      const value = (raw as Record<string, unknown>)[key];
      const b = LIMIT_BOUNDS[key];
      if (typeof value === "number" && Number.isInteger(value) && value >= b.min && value <= b.max) limits[key] = value;
    }
  }
  return limits;
}

/** Checks a requested change (`null` clears a limit). Throws a ValidationError naming each bad field. */
export function validateLimitChanges(changes: Partial<Record<string, unknown>>): Partial<OrgLimits> {
  const out: Partial<OrgLimits> = {};
  const problems: { path: string; message: string }[] = [];
  for (const [key, value] of Object.entries(changes)) {
    if (!(LIMIT_KEYS as readonly string[]).includes(key)) {
      problems.push({ path: `limits.${key}`, message: "Unknown limit." });
      continue;
    }
    const b = LIMIT_BOUNDS[key as LimitKey];
    if (value === null) {
      out[key as LimitKey] = null;
    } else if (typeof value !== "number" || !Number.isInteger(value) || value < b.min || value > b.max) {
      problems.push({ path: `limits.${key}`, message: `${b.label} must be a whole number from ${b.min} to ${b.max}, or empty for no limit.` });
    } else {
      out[key as LimitKey] = value;
    }
  }
  if (problems.length > 0) throw new ValidationError("Check the limits.", problems);
  return out;
}

export async function loadLimits(organizationId: string): Promise<OrgLimits> {
  const row = await adminDb.organizationSetting.findUnique({
    where: { organizationId_key: { organizationId, key: LIMITS_SETTING_KEY } },
  });
  return parseLimits(row?.value);
}

export async function saveLimits(organizationId: string, limits: OrgLimits): Promise<void> {
  const value = limits as unknown as Prisma.InputJsonValue;
  await adminDb.organizationSetting.upsert({
    where: { organizationId_key: { organizationId, key: LIMITS_SETTING_KEY } },
    update: { value },
    create: { organizationId, key: LIMITS_SETTING_KEY, value },
  });
}

/** The first day of the month in UTC, the period an API-call count belongs to. */
export function usagePeriodStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function countSeatsUsed(organizationId: string): Promise<number> {
  return adminDb.membership.count({ where: { organizationId, status: { in: ["ACTIVE", "PENDING"] } } });
}

export async function storageUsedBytes(organizationId: string): Promise<number> {
  const rows = await adminDb.$queryRaw<{ total: bigint | null }[]>`
    SELECT COALESCE(SUM(size_bytes), 0)::bigint AS total FROM files
    WHERE organization_id = ${organizationId} AND status IN ('UPLOADING', 'READY')`;
  return Number(rows[0]?.total ?? 0);
}

export async function apiCallsUsed(organizationId: string, now: Date = new Date()): Promise<number> {
  const rows = await adminDb.$queryRaw<{ count: bigint }[]>`
    SELECT count FROM organization_usage_counters
    WHERE organization_id = ${organizationId} AND metric = ${API_CALLS_METRIC} AND period_start = ${usagePeriodStart(now).toISOString().slice(0, 10)}::date`;
  return Number(rows[0]?.count ?? 0);
}

export interface UsageLine {
  limit: number | null;
  used: number;
  /** True when the organisation is at or over a limit. */
  atLimit: boolean;
}

export interface OrgUsage {
  seats: UsageLine;
  storageMb: UsageLine;
  apiCallsPerMonth: UsageLine & { periodStart: string };
}

const line = (limit: number | null, used: number): UsageLine => ({ limit, used, atLimit: limit !== null && used >= limit });

/** Numbers only: what is used against each limit, for the platform console and for the organisation's own Management. */
export async function getUsage(organizationId: string, now: Date = new Date()): Promise<{ limits: OrgLimits; usage: OrgUsage }> {
  const [limits, seats, bytes, calls] = await Promise.all([
    loadLimits(organizationId),
    countSeatsUsed(organizationId),
    storageUsedBytes(organizationId),
    apiCallsUsed(organizationId, now),
  ]);
  const usedMb = Math.ceil(bytes / MB);
  return {
    limits,
    usage: {
      seats: line(limits.seats, seats),
      storageMb: line(limits.storageMb, usedMb),
      apiCallsPerMonth: { ...line(limits.apiCallsPerMonth, calls), periodStart: usagePeriodStart(now).toISOString().slice(0, 10) },
    },
  };
}

function formatMb(mb: number): string {
  return mb >= 1024 ? `${Math.round((mb / 1024) * 10) / 10} GB` : `${mb} MB`;
}

/** Called before a person is invited or reactivated. */
export async function assertSeatAvailable(organizationId: string, adding = 1): Promise<void> {
  const { seats } = await loadLimits(organizationId);
  if (seats === null) return;
  const used = await countSeatsUsed(organizationId);
  if (used + adding > seats) {
    throw new LimitReachedError(
      "seats",
      `Your organisation is using all ${seats} of its seats. Deactivate a member you no longer need, or ask Figbloom to add seats.`,
    );
  }
}

/** Called before a file is accepted, with the size the client declared. */
export async function assertStorageAvailable(organizationId: string, addBytes: number): Promise<void> {
  const { storageMb } = await loadLimits(organizationId);
  if (storageMb === null) return;
  const used = await storageUsedBytes(organizationId);
  if (used + addBytes > storageMb * MB) {
    throw new LimitReachedError(
      "storageMb",
      `Your organisation has reached its ${formatMb(storageMb)} storage limit. Delete files you no longer need, or ask Figbloom to raise the limit.`,
    );
  }
}

/**
 * Counts one API call for the organisation and refuses it once the month's limit is used (429). The increment and the limit check are one
 * statement, so two calls at the limit cannot both get through. Without a limit it only counts, so the console shows real usage.
 */
export async function recordApiCall(organizationId: string, now: Date = new Date()): Promise<{ used: number; limit: number | null }> {
  const { apiCallsPerMonth: limit } = await loadLimits(organizationId);
  const period = usagePeriodStart(now);
  const rows = await adminDb.$queryRaw<{ count: bigint }[]>`
    INSERT INTO organization_usage_counters (organization_id, metric, period_start, count, updated_at)
    VALUES (${organizationId}, ${API_CALLS_METRIC}, ${period.toISOString().slice(0, 10)}::date, 1, now())
    ON CONFLICT (organization_id, metric, period_start) DO UPDATE
      SET count = organization_usage_counters.count + 1, updated_at = now()
      WHERE ${limit}::bigint IS NULL OR organization_usage_counters.count < ${limit}::bigint
    RETURNING count`;
  if (rows.length === 0) {
    const next = new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 1, 1));
    const when = next.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
    throw new LimitReachedError(
      "apiCallsPerMonth",
      `Your organisation has used all ${limit} API calls for this month. The count starts again on ${when}. Ask Figbloom if you need more.`,
      429,
    );
  }
  return { used: Number(rows[0]!.count), limit };
}
