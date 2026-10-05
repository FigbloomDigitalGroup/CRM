import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { ValidationError } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import { recordAuditEvent } from "../repositories/auditEvents";
import { diffAuditedFields } from "./auditDiff";

/** Closed set -- a working-day value outside this list is rejected rather than stored as free text. */
export const WORKING_DAY_KEYS = [
  "MON",
  "TUE",
  "WED",
  "THU",
  "FRI",
  "SAT",
  "SUN",
] as const;
export type WorkingDayKey = (typeof WORKING_DAY_KEYS)[number];

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const CURRENCY_PATTERN = /^[A-Za-z]{3}$/;

const PROFILE_FIELDS = [
  "name",
  "timezone",
  "defaultCurrency",
  "phone",
  "website",
  "address",
  "workingDays",
  "workingHoursStart",
  "workingHoursEnd",
] as const;

export interface OrganizationProfile {
  name: string;
  timezone: string;
  defaultCurrency: string;
  phone: string | null;
  website: string | null;
  address: string | null;
  workingDays: string[];
  workingHoursStart: string | null;
  workingHoursEnd: string | null;
}

export interface UpdateOrganizationProfileInput {
  name?: string;
  timezone?: string;
  defaultCurrency?: string;
  phone?: string | null;
  website?: string | null;
  address?: string | null;
  workingDays?: string[];
  workingHoursStart?: string | null;
  workingHoursEnd?: string | null;
}

function toProfile(org: {
  name: string;
  timezone: string;
  defaultCurrency: string;
  phone: string | null;
  website: string | null;
  address: string | null;
  workingDays: string[];
  workingHoursStart: string | null;
  workingHoursEnd: string | null;
}): OrganizationProfile {
  return {
    name: org.name,
    timezone: org.timezone,
    defaultCurrency: org.defaultCurrency,
    phone: org.phone,
    website: org.website,
    address: org.address,
    workingDays: org.workingDays,
    workingHoursStart: org.workingHoursStart,
    workingHoursEnd: org.workingHoursEnd,
  };
}

/** Org-level profile/defaults/working-hours (FIG-604). Management only -- same gate as every other tenant-configuration setting on the Settings page. */
export async function getOrganizationProfile(
  ctx: AuthContext,
): Promise<OrganizationProfile> {
  requirePermission(ctx, "organization.manage_settings");
  const org = await adminDb.organization.findUniqueOrThrow({
    where: { id: ctx.organizationId },
  });
  return toProfile(org);
}

/** Trims a free-text field to null if blank, undefined if not part of this edit (distinct from "clear it"). */
function cleanOptionalText(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function validate(input: UpdateOrganizationProfileInput): void {
  if (input.name !== undefined && input.name.trim() === "") {
    throw new ValidationError("Organization name cannot be blank.");
  }
  if (input.timezone !== undefined) {
    if (!Intl.supportedValuesOf("timeZone").includes(input.timezone)) {
      throw new ValidationError(`"${input.timezone}" is not a recognized IANA timezone.`);
    }
  }
  if (input.defaultCurrency !== undefined) {
    if (!CURRENCY_PATTERN.test(input.defaultCurrency)) {
      throw new ValidationError(
        "Default currency must be a 3-letter code (e.g. KES, USD).",
      );
    }
  }
  if (input.workingDays !== undefined) {
    const invalid = input.workingDays.filter(
      (d) => !WORKING_DAY_KEYS.includes(d as WorkingDayKey),
    );
    if (invalid.length > 0) {
      throw new ValidationError(`Unknown working day(s): ${invalid.join(", ")}.`);
    }
  }
  for (const [field, value] of [
    ["workingHoursStart", input.workingHoursStart],
    ["workingHoursEnd", input.workingHoursEnd],
  ] as const) {
    if (value !== undefined && value !== null && !TIME_PATTERN.test(value)) {
      throw new ValidationError(`${field} must be a 24-hour "HH:MM" time, e.g. "08:00".`);
    }
  }
  if (
    input.workingHoursStart &&
    input.workingHoursEnd &&
    input.workingHoursStart >= input.workingHoursEnd
  ) {
    throw new ValidationError("Working hours start must be before the end time.");
  }
}

export async function updateOrganizationProfile(
  ctx: AuthContext,
  input: UpdateOrganizationProfileInput,
): Promise<OrganizationProfile> {
  requirePermission(ctx, "organization.manage_settings");
  validate(input);

  const before = await adminDb.organization.findUniqueOrThrow({
    where: { id: ctx.organizationId },
  });

  const patch = {
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
    ...(input.defaultCurrency !== undefined
      ? { defaultCurrency: input.defaultCurrency.toUpperCase() }
      : {}),
    phone: cleanOptionalText(input.phone),
    website: cleanOptionalText(input.website),
    address: cleanOptionalText(input.address),
    ...(input.workingDays !== undefined ? { workingDays: input.workingDays } : {}),
    ...(input.workingHoursStart !== undefined
      ? { workingHoursStart: input.workingHoursStart }
      : {}),
    ...(input.workingHoursEnd !== undefined
      ? { workingHoursEnd: input.workingHoursEnd }
      : {}),
  };
  // cleanOptionalText returns `undefined` for fields the caller didn't send
  // at all -- strip those back out so Prisma's update doesn't touch them.
  for (const key of ["phone", "website", "address"] as const) {
    if (patch[key] === undefined) delete patch[key];
  }

  const updated = await adminDb.organization.update({
    where: { id: ctx.organizationId },
    data: patch,
  });

  const diff = diffAuditedFields(before, patch, PROFILE_FIELDS);
  if (diff) {
    await recordAuditEvent({
      organizationId: ctx.organizationId,
      actorMembershipId: ctx.membershipId,
      action: "organization.profile_updated",
      entityType: "Organization",
      entityId: ctx.organizationId,
      previousValue: diff.previousValue,
      newValue: diff.newValue,
    });
  }

  return toProfile(updated);
}
