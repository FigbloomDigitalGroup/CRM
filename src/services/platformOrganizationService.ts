import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { ApiError } from "../lib/apiErrors";
import { ValidationError } from "../auth/errors";
import type { PlatformContext } from "../auth/platformSession";
import { adminDb } from "../db/adminClient";
import { getPlatformDb } from "../db/platformClient";
import { describeOrganizationDefaults } from "./organizationDefaults";
import { provisionOrganization } from "./organizationProvisioningService";
import { listAuditEvents, recordPlatformAudit } from "./platformAuditService";

/**
 * The platform's organisations API (FIG-1136, B6.04; screens PL2, PL3, PL4).
 *
 * Reads go through the platform database role and so can only ever see what the
 * counts views expose: numbers per organisation, settings, and the owner
 * contact. Provisioning is the one write; it is a server-side operation that
 * the platform role is not trusted to do itself (it has no privilege on a
 * tenant table), so it runs through the schema-owner client after the route has
 * checked the `platform.organizations.provision` key, and is audited.
 */

export const ORGANIZATION_STATUSES = ["ACTIVE", "INACTIVE", "SUSPENDED", "OFFBOARDING", "OFFBOARDED"] as const;
export const SLUG_MIN = 3;
export const SLUG_MAX = 40;
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Words that would collide with a route or look like Figbloom itself. */
const RESERVED_SLUGS = new Set([
  "admin", "api", "app", "platform", "figbloom", "login", "logout", "signup", "sign-up", "forgot-password", "reset-password",
  "accept-invite", "o", "orgs", "static", "support", "www", "status", "help", "billing", "root", "system", "internal", "test",
]);

// ---------------------------------------------------------------------------
// Slug check and defaults preview (PL3)
// ---------------------------------------------------------------------------

export type SlugProblem = "TOO_SHORT" | "TOO_LONG" | "INVALID" | "RESERVED" | "TAKEN";

export interface SlugCheck {
  slug: string;
  available: boolean;
  problem: SlugProblem | null;
  message: string | null;
  /** A free alternative when the slug is taken. */
  suggestion: string | null;
}

export function normaliseSlug(raw: string): string {
  return raw.trim().toLowerCase();
}

export function slugProblemOf(slug: string): { problem: SlugProblem; message: string } | null {
  if (slug.length < SLUG_MIN) return { problem: "TOO_SHORT", message: `Use at least ${SLUG_MIN} characters.` };
  if (slug.length > SLUG_MAX) return { problem: "TOO_LONG", message: `Use at most ${SLUG_MAX} characters.` };
  if (!SLUG_PATTERN.test(slug)) return { problem: "INVALID", message: "Use lowercase letters, digits and single hyphens only (for example acme-ltd)." };
  if (RESERVED_SLUGS.has(slug)) return { problem: "RESERVED", message: `"${slug}" is reserved.` };
  return null;
}

async function slugTaken(slug: string): Promise<boolean> {
  // The counts view lists every organisation row, tombstones of offboarded organisations included, so a slug is never reused.
  const rows = await getPlatformDb().$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM platform_organization_counts WHERE slug = ${slug}`;
  return Number(rows[0]?.n ?? 0) > 0;
}

export async function checkSlug(rawSlug: string): Promise<SlugCheck> {
  const slug = normaliseSlug(rawSlug);
  const bad = slugProblemOf(slug);
  if (bad) return { slug, available: false, problem: bad.problem, message: bad.message, suggestion: null };
  if (await slugTaken(slug)) {
    let suggestion: string | null = null;
    for (let i = 2; i < 50 && !suggestion; i++) {
      const candidate = `${slug.slice(0, SLUG_MAX - String(i).length - 1)}-${i}`;
      if (!(await slugTaken(candidate))) suggestion = candidate;
    }
    return { slug, available: false, problem: "TAKEN", message: `"${slug}" is already used by another organisation.`, suggestion };
  }
  return { slug, available: true, problem: null, message: null, suggestion: null };
}

/** What a new organisation starts with, from the same constants the seed uses. */
export function previewProvisioningDefaults() {
  return {
    release: "V1",
    timezone: "Africa/Nairobi",
    defaultCurrency: "KES",
    firstUserRole: "MANAGEMENT",
    catalogues: describeOrganizationDefaults(),
    note: "The first Management user is invited by email and sets their own password. Everything above can be changed by that user afterwards.",
  };
}

// ---------------------------------------------------------------------------
// List and detail (PL2, PL4): counts only
// ---------------------------------------------------------------------------

export interface OrganizationListQuery {
  q?: string;
  status?: string;
  createdFrom?: Date;
  createdTo?: Date;
  sort?: "name" | "createdAt" | "members" | "status";
  direction?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

const SORT_COLUMNS: Record<NonNullable<OrganizationListQuery["sort"]>, string> = {
  name: "name",
  createdAt: "created_at",
  members: "member_count",
  status: "status",
};

interface CountsRow {
  organization_id: string;
  slug: string;
  name: string;
  status: string;
  created_at: Date;
  member_count: bigint;
  active_member_count: bigint;
  company_count: bigint;
  contact_count: bigint;
  lead_count: bigint;
  deal_count: bigint;
}

function presentCounts(r: CountsRow) {
  return {
    id: r.organization_id,
    slug: r.slug,
    name: r.name,
    status: r.status,
    createdAt: r.created_at.toISOString(),
    counts: {
      members: Number(r.member_count),
      activeMembers: Number(r.active_member_count),
      companies: Number(r.company_count),
      contacts: Number(r.contact_count),
      leads: Number(r.lead_count),
      deals: Number(r.deal_count),
    },
  };
}

export async function listOrganizations(query: OrganizationListQuery = {}) {
  if (query.status && !(ORGANIZATION_STATUSES as readonly string[]).includes(query.status)) {
    throw new ValidationError("Unknown status.", [{ path: "status", message: `Use one of ${ORGANIZATION_STATUSES.join(", ")}.` }]);
  }
  const pageSize = Math.min(Math.max(Math.floor(query.pageSize ?? 25), 1), 100);
  const page = Math.max(Math.floor(query.page ?? 1), 1);
  const column = Prisma.raw(SORT_COLUMNS[query.sort ?? "name"] ?? "name");
  const direction = Prisma.raw(query.direction === "desc" ? "DESC" : "ASC");
  const q = query.q?.trim();

  const where = Prisma.sql`WHERE TRUE
    ${q ? Prisma.sql`AND (name ILIKE ${"%" + q.replace(/[%_\\]/g, "\\$&") + "%"} OR slug ILIKE ${"%" + q.replace(/[%_\\]/g, "\\$&") + "%"})` : Prisma.empty}
    ${query.status ? Prisma.sql`AND status = ${query.status}` : Prisma.empty}
    ${query.createdFrom ? Prisma.sql`AND created_at >= ${query.createdFrom}` : Prisma.empty}
    ${query.createdTo ? Prisma.sql`AND created_at <= ${query.createdTo}` : Prisma.empty}`;

  const db = getPlatformDb();
  const rows = await db.$queryRaw<CountsRow[]>`
    SELECT organization_id, slug, name, status, created_at, member_count, active_member_count, company_count,
           contact_count, lead_count, deal_count
    FROM platform_organization_counts ${where}
    ORDER BY ${column} ${direction}, slug
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
  const total = await db.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM platform_organization_counts ${where}`;
  const byStatus = await db.$queryRaw<{ status: string; n: bigint }[]>`SELECT status, count(*)::bigint AS n FROM platform_organization_counts GROUP BY status`;
  const count = Number(total[0]?.n ?? 0);
  return {
    items: rows.map(presentCounts),
    page,
    pageSize,
    total: count,
    pageCount: Math.max(1, Math.ceil(count / pageSize)),
    statusCounts: Object.fromEntries(byStatus.map((s) => [s.status, Number(s.n)])),
  };
}

export async function getOrganizationDetail(organizationId: string) {
  const db = getPlatformDb();
  const rows = await db.$queryRaw<CountsRow[]>`
    SELECT organization_id, slug, name, status, created_at, member_count, active_member_count, company_count,
           contact_count, lead_count, deal_count
    FROM platform_organization_counts WHERE organization_id = ${organizationId}`;
  const row = rows[0];
  if (!row) return null;
  const profile = await db.$queryRaw<{ timezone: string; default_currency: string; owner_name: string | null; owner_email: string | null; owner_status: string | null }[]>`
    SELECT timezone, default_currency, owner_name, owner_email, owner_status FROM platform_organization_profile WHERE organization_id = ${organizationId}`;
  const p = profile[0];
  const lifecycle = await db.organizationLifecycleEvent.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 50 });
  const requests = await db.platformDataRequest.findMany({
    where: { organizationId },
    orderBy: { submittedAt: "desc" },
    take: 20,
    select: { id: true, kind: true, status: true, submittedAt: true, exportStatus: true },
  });
  const audit = await listAuditEvents({ organizationId, limit: 20 });
  return {
    ...presentCounts(row),
    timezone: p?.timezone ?? null,
    defaultCurrency: p?.default_currency ?? null,
    owner: p?.owner_email ? { name: p.owner_name, email: p.owner_email, invitePending: p.owner_status === "PENDING" } : null,
    lifecycle: lifecycle.map((e) => ({ id: e.id, action: e.action, from: e.fromStatus, to: e.toStatus, reason: e.reason, actorIdentityId: e.actorIdentityId, at: e.createdAt.toISOString() })),
    dataRequests: requests.map((r) => ({ id: r.id, kind: r.kind, status: r.status, submittedAt: r.submittedAt.toISOString(), exportStatus: r.exportStatus })),
    recentAudit: audit.items,
  };
}

// ---------------------------------------------------------------------------
// Provisioning (PL3)
// ---------------------------------------------------------------------------

export interface ProvisionInput {
  name: string;
  slug: string;
  ownerName: string;
  ownerEmail: string;
}

export interface ProvisionResult {
  organizationId: string;
  slug: string;
  name: string;
  status: string;
  owner: { email: string; membershipId: string; invitePending: true };
}

const KEY_PATTERN = /^[\x21-\x7e]{8,200}$/;

function requestHash(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex");
}

/**
 * Runs a platform create once per Idempotency-Key. Same key and same body replays the stored answer; the same key with
 * another body is refused (422, as for tenant creates). No key means no replay protection.
 */
export async function withPlatformIdempotency<T extends Prisma.InputJsonValue>(
  actorIdentityId: string,
  scope: string,
  key: string | null,
  body: unknown,
  run: () => Promise<T>,
): Promise<{ result: T; replayed: boolean }> {
  if (key === null) return { result: await run(), replayed: false };
  if (!KEY_PATTERN.test(key)) {
    throw new ValidationError("Idempotency-Key must be 8 to 200 printable characters.", [{ path: "Idempotency-Key", message: "Use a UUID or similar unique string." }]);
  }
  const db = getPlatformDb();
  const hash = requestHash(body);
  try {
    await db.platformIdempotencyKey.create({ data: { actorIdentityId, scope, key, requestHash: hash } });
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") throw err;
    const existing = await db.platformIdempotencyKey.findUniqueOrThrow({ where: { actorIdentityId_scope_key: { actorIdentityId, scope, key } } });
    if (existing.requestHash !== hash) {
      throw new ApiError(422, "IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was already used for a different request.");
    }
    if (existing.response !== null) return { result: existing.response as T, replayed: true };
    throw new ApiError(409, "IDEMPOTENCY_IN_PROGRESS", "A request with this Idempotency-Key is still being processed. Retry shortly.");
  }
  try {
    const result = await run();
    await db.platformIdempotencyKey.update({ where: { actorIdentityId_scope_key: { actorIdentityId, scope, key } }, data: { response: result } });
    return { result, replayed: false };
  } catch (err) {
    // A failed create must not poison the key: the caller may fix the input and retry with it.
    await db.platformIdempotencyKey.delete({ where: { actorIdentityId_scope_key: { actorIdentityId, scope, key } } }).catch(() => undefined);
    throw err;
  }
}

/**
 * Creates the organisation with its seeded defaults and invites the first Management user (the same real accept-invite
 * flow as any member invite; the invite link is emailed and never returned here, or the caller could accept it themselves).
 * Audited with the reason "provisioned". `requestId` ties the entry to the request.
 */
export async function provisionPlatformOrganization(
  actor: Pick<PlatformContext, "identityId" | "email">,
  input: ProvisionInput,
  options: { idempotencyKey?: string | null; requestId?: string | null } = {},
): Promise<ProvisionResult & { replayed: boolean }> {
  const name = input.name.trim();
  const slug = normaliseSlug(input.slug);
  const ownerEmail = input.ownerEmail.trim().toLowerCase();
  const ownerName = input.ownerName.trim();

  const problems: { path: string; message: string }[] = [];
  if (!name) problems.push({ path: "name", message: "Name is required." });
  if (name.length > 120) problems.push({ path: "name", message: "Use at most 120 characters." });
  const bad = slugProblemOf(slug);
  if (bad) problems.push({ path: "slug", message: bad.message });
  if (!ownerName) problems.push({ path: "ownerName", message: "The first Management user's name is required." });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ownerEmail)) problems.push({ path: "ownerEmail", message: "A valid email is required." });
  if (problems.length > 0) throw new ValidationError(problems[0]!.message, problems);

  const { result, replayed } = await withPlatformIdempotency(
    actor.identityId,
    "organizations.provision",
    options.idempotencyKey ?? null,
    { name, slug, ownerName, ownerEmail },
    async () => {
      if (await slugTaken(slug)) {
        throw new ValidationError(`An organisation with slug "${slug}" already exists.`, [{ path: "slug", message: "Already used." }]);
      }
      const made = await provisionOrganization({ name, slug, adminEmail: ownerEmail, adminName: ownerName });
      // The audit entry commits on its own: the organisation exists from here on.
      await recordPlatformAudit(adminDb, {
        actorIdentityId: actor.identityId,
        actorLabel: actor.email,
        action: "organization.provisioned",
        targetType: "Organization",
        targetId: made.organizationId,
        organizationId: made.organizationId,
        organizationSlug: made.organizationSlug,
        reason: "Provisioned from the platform console",
        metadata: { name, ownerRole: "MANAGEMENT" },
        requestId: options.requestId ?? null,
      });
      return {
        organizationId: made.organizationId,
        slug: made.organizationSlug,
        name,
        status: "ACTIVE",
        owner: { email: ownerEmail, membershipId: made.adminMembershipId, invitePending: true as const },
      };
    },
  );
  return { ...result, replayed };
}
