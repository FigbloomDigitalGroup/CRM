import { sendMembershipInviteEmail } from "../auth/email";
import { ValidationError } from "../auth/errors";
import { generateInviteToken } from "../auth/membershipInvite";
import { adminDb } from "../db/adminClient";
import { recordAuditEvent } from "../repositories/auditEvents";
import { upsertPendingInvite } from "../repositories/memberships";
import { createOrganization, getOrganizationBySlug } from "../repositories/organizations";
import { seedOrganizationDefaults } from "./organizationDefaults";

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DEFAULT_ADMIN_ROLE_KEY = "MANAGEMENT";

function appBaseUrl(): string {
  return process.env.APP_BASE_URL ?? "http://localhost:3000";
}

export interface ProvisionOrganizationInput {
  name: string;
  slug: string;
  adminEmail: string;
  adminName: string;
  /** One of the 5 fixed roles (FIG-444 §7: "no new roles are invented per subscriber"). Defaults to MANAGEMENT. */
  adminRoleKey?: string;
}

export interface ProvisionOrganizationResult {
  organizationId: string;
  organizationSlug: string;
  adminMembershipId: string;
  /** The invite's accept-invite link -- also sent by email (or logged, if no SMTP provider is configured; see `src/auth/email.ts`). */
  acceptUrl: string;
}

/**
 * Platform-admin tenant provisioning (FIG-604). Turns the pattern
 * `prisma/seed.ts#seedDevFigBloomOrganization` already demonstrates for the
 * one hard-coded `figbloom` org into a reusable, parameterized operation --
 * exactly the gap FIG-444 §7/§16/§17 flags as a prerequisite before any
 * external subscriber pilot ("a tenant-provisioning process, beyond the
 * hard-coded single-org seed script, does not exist").
 *
 * The new admin is invited through the exact same real accept-invite flow
 * as any other member invite (`membershipService.ts#inviteMember`) -- a
 * PENDING membership with an emailed token, not a pre-set password -- there
 * is deliberately no separate "platform admin" login path.
 *
 * Not transactional/resumable: if this throws partway through (e.g. the
 * invite email fails after the org and its default catalogs already
 * exist), re-running with the same slug will fail on the now-taken slug --
 * inspect what was already created (organization, then its catalogs, then
 * the user/membership) before deciding how to continue. This mirrors
 * `seedDevFigBloomOrganization`'s own non-transactional sequence; V1
 * provisioning is a rare, staff-run operation, not something that needs to
 * tolerate concurrent/retried calls.
 */
export async function provisionOrganization(
  input: ProvisionOrganizationInput,
): Promise<ProvisionOrganizationResult> {
  const name = input.name.trim();
  const slug = input.slug.trim().toLowerCase();
  const adminEmail = input.adminEmail.trim().toLowerCase();
  const adminName = input.adminName.trim();
  const adminRoleKey = input.adminRoleKey ?? DEFAULT_ADMIN_ROLE_KEY;

  if (!name) {
    throw new ValidationError("Organization name is required.");
  }
  if (!SLUG_PATTERN.test(slug)) {
    throw new ValidationError(
      `"${input.slug}" is not a valid slug -- lowercase letters, digits, and single hyphens only (e.g. "acme-ltd").`,
    );
  }
  if (!adminEmail || !adminEmail.includes("@")) {
    throw new ValidationError("A valid admin email is required.");
  }
  if (!adminName) {
    throw new ValidationError("Admin name is required.");
  }

  const existingOrg = await getOrganizationBySlug(slug);
  if (existingOrg) {
    throw new ValidationError(`An organization with slug "${slug}" already exists.`);
  }

  const role = await adminDb.role.findUnique({ where: { key: adminRoleKey } });
  if (!role) {
    throw new ValidationError(`Unknown role "${adminRoleKey}".`);
  }

  const organization = await createOrganization({ name, slug });
  await seedOrganizationDefaults(organization.id);

  let user = await adminDb.user.findUnique({ where: { email: adminEmail } });
  if (!user) {
    user = await adminDb.user.create({ data: { email: adminEmail, name: adminName } });
  }

  const { plaintext, tokenHash, expiresAt } = generateInviteToken();
  const membership = await upsertPendingInvite({
    organizationId: organization.id,
    userId: user.id,
    roleId: role.id,
    tokenHash,
    expiresAt,
  });

  const acceptUrl = `${appBaseUrl()}/accept-invite?token=${plaintext}`;
  await sendMembershipInviteEmail(user.email, acceptUrl);

  // No actorMembershipId/actorUserId -- like `erase-data-subject.ts`'s
  // `data_subject.erased` event, this is a platform/CLI action with no
  // authenticated organization member behind it yet (the invited admin
  // hasn't accepted anything at this point).
  await recordAuditEvent({
    organizationId: organization.id,
    action: "organization.provisioned",
    entityType: "Organization",
    entityId: organization.id,
    metadata: { name, slug, adminEmail, adminRoleKey },
  });

  return {
    organizationId: organization.id,
    organizationSlug: organization.slug,
    adminMembershipId: membership.id,
    acceptUrl,
  };
}
