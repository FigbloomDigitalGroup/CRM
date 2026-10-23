import { invalidateMeContext } from "./meContextCache";
import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { NotFoundError, ValidationError, type ValidationIssue } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import { withOrgContext } from "../db/orgScopedClient";
import { loadFeatureConfig } from "../lib/featureConfig";
import { resolveFeature } from "../lib/featureFlags";
import { recordAuditEvent } from "../repositories/auditEvents";
import { getFileById, updateFileRecord } from "../repositories/files";
import { getStorageDriver } from "../storage";
import { PAGE_COLOUR_KEYS, THEME_KEYS, findPageColour, lookColours, type LookColours } from "../preferences/catalogue";
import { diffAuditedFields } from "./auditDiff";
import { updateFeatureToggles } from "./featureService";

/**
 * How the organisation looks (FIG-1025, B1.09): the name people see, the logo,
 * the default theme and page colour, whether the logo appears on pages the
 * organisation's clients see, and whether members may personalise at all.
 *
 * Everyone in the organisation reads it (the shell needs the name and logo);
 * only Management (`organization.manage_settings`) changes it. Whether members
 * may personalise is the existing `personalisation.allowed` toggle, so there is
 * one switch and one audit trail for it.
 */

export const PERSONALISATION_TOGGLE = "personalisation.allowed";
export const DISPLAY_NAME_MAX = 80;
/** A logo link is re-signed on every response. */
export const LOGO_LINK_SECONDS = 300;

export interface OrganizationLook {
  name: string;
  /** What the shell shows: the display name when set, else the organisation's name. */
  shownName: string;
  displayName: string | null;
  logoUrl: string | null;
  defaultTheme: string;
  defaultPageColour: string;
  /** The default look spelled out in colours. */
  colours: LookColours;
  showLogoOnClientPages: boolean;
  allowPersonalisation: boolean;
}

export interface UpdateOrganizationLookInput {
  displayName?: string | null;
  logoFileId?: string | null;
  defaultTheme?: string;
  defaultPageColour?: string;
  showLogoOnClientPages?: boolean;
  allowPersonalisation?: boolean;
}

const AUDITED = ["displayName", "logoFileId", "defaultTheme", "defaultPageColour", "showLogoOnClientPages"] as const;

export async function allowsPersonalisation(organizationId: string): Promise<boolean> {
  return resolveFeature(PERSONALISATION_TOGGLE, await loadFeatureConfig(organizationId)).enabled;
}

/** Signed link to the organisation logo, or null. Only a READY, undeleted LOGO file of this organisation is ever served. */
async function logoUrlFor(organizationId: string, logoFileId: string | null): Promise<string | null> {
  if (!logoFileId) return null;
  const file = await getFileById(organizationId, logoFileId);
  if (!file || file.status !== "READY" || file.purpose !== "LOGO") return null;
  const link = await getStorageDriver().signDownload(file.storageKey, {
    expiresInSeconds: LOGO_LINK_SECONDS,
    fileName: file.name,
    contentType: file.mimeType,
    disposition: "inline",
  });
  return link.url;
}

/** Reads the look for an organisation id (the caller has already established membership). */
export async function readOrganizationLook(organizationId: string): Promise<OrganizationLook> {
  const org = await adminDb.organization.findUnique({ where: { id: organizationId } });
  if (!org) throw new NotFoundError("Organization", organizationId);
  const [logoUrl, allowPersonalisation] = await Promise.all([
    logoUrlFor(organizationId, org.logoFileId),
    allowsPersonalisation(organizationId),
  ]);
  return {
    name: org.name,
    shownName: org.displayName?.trim() ? org.displayName : org.name,
    displayName: org.displayName,
    logoUrl,
    defaultTheme: org.defaultTheme,
    defaultPageColour: org.defaultPageColour,
    colours: lookColours(org.defaultTheme, org.defaultPageColour),
    showLogoOnClientPages: org.showLogoOnClientPages,
    allowPersonalisation,
  };
}

export async function getOrganizationLook(ctx: AuthContext): Promise<OrganizationLook> {
  return readOrganizationLook(ctx.organizationId);
}

function validateLook(input: UpdateOrganizationLookInput) {
  const issues: ValidationIssue[] = [];
  const clean: UpdateOrganizationLookInput = {};

  if (input.displayName !== undefined) {
    if (input.displayName === null || input.displayName.trim() === "") clean.displayName = null;
    else {
      const name = input.displayName.normalize("NFC").replace(/\s+/g, " ").trim();
      // eslint-disable-next-line no-control-regex
      if (/[\u0000-\u001f\u007f]/.test(name)) issues.push({ path: "displayName", message: "The display name contains characters that are not allowed." });
      else if (name.length > DISPLAY_NAME_MAX) issues.push({ path: "displayName", message: `The display name must be at most ${DISPLAY_NAME_MAX} characters.` });
      else clean.displayName = name;
    }
  }
  if (input.defaultTheme !== undefined) {
    if (!THEME_KEYS.includes(input.defaultTheme)) {
      issues.push({ path: "defaultTheme", message: `"${input.defaultTheme}" is not a theme. Choose one of: ${THEME_KEYS.join(", ")}.` });
    } else clean.defaultTheme = input.defaultTheme;
  }
  if (input.defaultPageColour !== undefined) {
    const page = findPageColour(input.defaultPageColour);
    if (!page) {
      issues.push({ path: "defaultPageColour", message: `"${input.defaultPageColour}" is not a page colour. Choose one of: ${PAGE_COLOUR_KEYS.join(", ")}.` });
    } else if (page.hex === null) {
      issues.push({
        path: "defaultPageColour",
        message: "\"Match my device\" is a personal choice; the organisation's default must be a specific page colour.",
      });
    } else clean.defaultPageColour = page.key;
  }
  if (input.showLogoOnClientPages !== undefined) clean.showLogoOnClientPages = input.showLogoOnClientPages;
  if (input.logoFileId !== undefined) clean.logoFileId = input.logoFileId;
  if (input.allowPersonalisation !== undefined) clean.allowPersonalisation = input.allowPersonalisation;

  if (issues.length > 0) {
    throw new ValidationError(issues.length === 1 ? issues[0]!.message : "Some of the organisation's look settings are not valid.", issues);
  }
  return clean;
}

export async function updateOrganizationLook(
  ctx: AuthContext,
  input: UpdateOrganizationLookInput,
): Promise<OrganizationLook> {
  requirePermission(ctx, "organization.manage_settings");
  const { allowPersonalisation, ...rest } = validateLook(input);
  if (Object.keys(rest).length === 0 && allowPersonalisation === undefined) {
    throw new ValidationError("Send at least one setting to change.");
  }

  const before = await adminDb.organization.findUniqueOrThrow({ where: { id: ctx.organizationId } });

  if (rest.logoFileId) {
    const file = await getFileById(ctx.organizationId, rest.logoFileId);
    if (!file || file.status === "DELETED" || file.purpose !== "LOGO") {
      throw new NotFoundError("File", rest.logoFileId);
    }
    if (file.status !== "READY") {
      throw new ValidationError("Finish uploading the logo first.", [{ path: "logoFileId", message: "Finish uploading the logo first." }]);
    }
  }

  const diff = diffAuditedFields(before, rest, AUDITED);
  if (diff) {
    await withOrgContext(ctx.organizationId, (tx) =>
      tx.organization.update({ where: { id: ctx.organizationId }, data: rest }),
    );
    if (rest.logoFileId !== undefined && before.logoFileId && before.logoFileId !== rest.logoFileId) {
      await updateFileRecord(ctx.organizationId, before.logoFileId, { status: "DELETED", deletedAt: new Date() });
    }
    await recordAuditEvent({
      organizationId: ctx.organizationId,
      actorMembershipId: ctx.membershipId,
      action: "organization.look_updated",
      entityType: "Organization",
      entityId: ctx.organizationId,
      previousValue: diff.previousValue,
      newValue: diff.newValue,
    });
  }

  if (allowPersonalisation !== undefined) {
    // Same switch, same audit trail as every other toggle.
    await updateFeatureToggles(ctx, { [PERSONALISATION_TOGGLE]: allowPersonalisation });
  }
  invalidateMeContext({ organizationId: ctx.organizationId });
  return readOrganizationLook(ctx.organizationId);
}
