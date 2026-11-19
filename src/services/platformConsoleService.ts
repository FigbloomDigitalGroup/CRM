import { timingSafeEqual } from "node:crypto";
import type { Organization } from "@prisma/client";
import { NotFoundError, ValidationError } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import { ApiError } from "../lib/apiErrors";
import { getOrganizationBySlug } from "../repositories/organizations";
import { provisionOrganization } from "./organizationProvisioningService";
import { ORGANIZATION } from "./platformLinkService";

/**
 * What Figbloom's console sees of CRM (ERP/CRM_PLATFORM_CONTRACT.md section 2, "For the console"): one summary per
 * organisation, and creating one for a customer. Server to server only, behind `x-platform-secret`. A summary carries
 * counts and the first admin's contact, never deal values, customer or contact data, or anything a role would mask.
 */

type Env = Record<string, string | undefined>;

/** The console's shared secret, compared in constant time; no secret configured means nobody gets in. */
export function consoleSecretMatches(given: string | null, env: Env = process.env): boolean {
  const expected = env.PLATFORM_CONSOLE_SECRET ?? "";
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended" | "inactive";
  createdAt: string;
  admin: { name: string; email: string } | null;
  counts: { activeMembers: number; pendingInvitations: number; leads: number; openDeals: number; companies: number };
  lastActivityAt: string | null;
  platformOrganizationId: string | null;
}

const statusOf = (s: Organization["status"]): OrganizationSummary["status"] =>
  s === "ACTIVE" ? "active" : s === "SUSPENDED" ? "suspended" : "inactive";

async function summaryOf(org: Organization): Promise<OrganizationSummary> {
  const where = { organizationId: org.id };
  const [admin, activeMembers, pendingInvitations, leads, openDeals, companies, lastAudit, link] = await Promise.all([
    adminDb.membership.findFirst({
      where: { ...where, role: { key: "MANAGEMENT" }, status: { in: ["ACTIVE", "PENDING"] } },
      orderBy: { createdAt: "asc" },
      select: { user: { select: { name: true, email: true } } },
    }),
    adminDb.membership.count({ where: { ...where, status: "ACTIVE" } }),
    adminDb.membership.count({ where: { ...where, status: "PENDING" } }),
    adminDb.lead.count({ where: { ...where, archivedAt: null } }),
    adminDb.deal.count({ where: { ...where, archivedAt: null, wonAt: null, lostAt: null } }),
    adminDb.company.count({ where: { ...where, archivedAt: null } }),
    adminDb.auditEvent.aggregate({ where, _max: { createdAt: true } }),
    adminDb.platformLink.findUnique({ where: { entityKind_localId: { entityKind: ORGANIZATION, localId: org.id } } }),
  ]);
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    status: statusOf(org.status),
    createdAt: org.createdAt.toISOString(),
    admin: admin ? { name: admin.user.name, email: admin.user.email } : null,
    counts: { activeMembers, pendingInvitations, leads, openDeals, companies },
    lastActivityAt: lastAudit._max.createdAt?.toISOString() ?? null,
    platformOrganizationId: link?.platformId ?? null,
  };
}

export async function listOrganizationSummaries(): Promise<OrganizationSummary[]> {
  const orgs = await adminDb.organization.findMany({ orderBy: { createdAt: "asc" } });
  const out: OrganizationSummary[] = [];
  for (const org of orgs) out.push(await summaryOf(org));
  return out;
}

export async function getOrganizationSummary(id: string): Promise<OrganizationSummary> {
  const org = await adminDb.organization.findUnique({ where: { id } });
  if (!org) throw new NotFoundError("Organization", id);
  return summaryOf(org);
}

/** The slug CRM would give a name: lowercase letters, digits and single hyphens. */
export function slugFor(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
}

/** 409 SLUG_TAKEN for the console. */
export class SlugTakenError extends ApiError {
  constructor(slug: string) {
    super(409, "SLUG_TAKEN", `The address "${slug}" is already used by another organisation.`);
    this.name = "SlugTakenError";
  }
}

/**
 * A new organisation for a customer, from the console: CRM's own provisioning (default catalogues, the first admin
 * invited as Management with the normal accept-invite email), audited with the staff member who asked; then
 * registered with the platform.
 */
export async function createOrganizationFromConsole(input: {
  name: string;
  slug?: string;
  adminName: string;
  adminEmail: string;
  staffEmail: string;
}): Promise<OrganizationSummary> {
  const name = (input.name ?? "").trim();
  if (!name) throw new ValidationError("The organisation's name is required.", [{ path: "name", message: "Required." }]);
  if (!(input.adminName ?? "").trim()) {
    throw new ValidationError("The admin's name is required.", [{ path: "adminName", message: "Required." }]);
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test((input.adminEmail ?? "").trim())) {
    throw new ValidationError("The admin's email is not valid.", [{ path: "adminEmail", message: "Not a valid email address." }]);
  }
  if (!(input.staffEmail ?? "").trim()) {
    throw new ValidationError("staffEmail (who asked) is required.", [{ path: "staffEmail", message: "Required." }]);
  }
  const slug = (input.slug ?? "").trim().toLowerCase() || slugFor(name);
  if (!slug) throw new ValidationError("Choose an address for the organisation.", [{ path: "slug", message: "Required." }]);
  if (await getOrganizationBySlug(slug)) throw new SlugTakenError(slug);

  const result = await provisionOrganization({
    name,
    slug,
    adminEmail: input.adminEmail,
    adminName: input.adminName,
    adminRoleKey: "MANAGEMENT",
    requestedBy: { via: "figbloom-console", by: input.staffEmail.trim().toLowerCase() },
  });
  return getOrganizationSummary(result.organizationId);
}
