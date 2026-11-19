import { createHmac, timingSafeEqual } from "node:crypto";
import { Prisma, type OrganizationStatus } from "@prisma/client";
import { platformClient, type PlatformClient } from "../auth/figbloom/platformClient";
import { adminDb } from "../db/adminClient";
import { recordAuditEvent } from "../repositories/auditEvents";
import { releaseJobLock, tryAcquireJobLock } from "../repositories/scheduledJobRuns";

/**
 * CRM's link to the Figbloom platform (ERP/CRM_PLATFORM_CONTRACT.md section 2). Behind `PLATFORM_LINK_ENABLED`
 * (off by default: nothing here runs and the console endpoints don't exist).
 *
 * - Every CRM organisation is registered with the platform as an organisation and a tenant (same local ID). A change
 *   is sent right away; if the platform can't be reached it waits in `platform_sync_queue` and
 *   `npm run platform:sync` (every 15 minutes, with the notifications sweep) retries it with backoff.
 * - The first registration copies CRM's status (`backfill: true`): staff created the organisation, so it is active.
 *   After that the status is the platform's: the console suspends and reactivates, and the decision webhook applies it.
 */

type Env = Record<string, string | undefined>;

export const ORGANIZATION = "organization";
const SYNC_JOB = "platform-sync";
const BATCH = 50;
// a run that hasn't finished in 10 minutes has died: another may take over
const LOCK_STALE_MS = 10 * 60_000;

export function platformLinkEnabled(env: Env = process.env): boolean {
  return (env.PLATFORM_LINK_ENABLED ?? "").trim().toLowerCase() === "true";
}

/** 1, 2, 4 ... minutes, at most an hour. */
export const backoffMs = (attempts: number) => Math.min(60_000 * 2 ** Math.max(attempts - 1, 0), 3_600_000);

const toPlatformStatus = (status: OrganizationStatus) => (status === "ACTIVE" ? "active" : "suspended");

/** The organisation's first Management member (the admin it was created for), for the platform's owner email. */
async function ownerEmailOf(organizationId: string): Promise<string | null> {
  const owner = await adminDb.membership.findFirst({
    where: { organizationId, role: { key: "MANAGEMENT" }, status: { in: ["ACTIVE", "PENDING"] } },
    orderBy: [{ createdAt: "asc" }],
    select: { user: { select: { email: true } } },
  });
  return owner?.user.email ?? null;
}

/** Sends one organisation (and its tenant) to the platform and keeps the platform's ID. Throws when it fails. */
export async function syncOrganization(organizationId: string, client: PlatformClient = platformClient()): Promise<string> {
  const org = await adminDb.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const link = await adminDb.platformLink.findUnique({
    where: { entityKind_localId: { entityKind: ORGANIZATION, localId: org.id } },
  });
  const registered = await client.putOrganization(org.id, {
    name: org.name,
    owner_email: await ownerEmailOf(org.id),
    created_at: org.createdAt.toISOString(),
    // only the first time: from then on the status is the platform's
    ...(link ? {} : { status: toPlatformStatus(org.status), backfill: true }),
  });
  await client.putTenant(org.id, { name: org.name, slug: org.slug, organization_local_id: org.id, created_at: org.createdAt.toISOString() });
  await adminDb.platformLink.upsert({
    where: { entityKind_localId: { entityKind: ORGANIZATION, localId: org.id } },
    create: { entityKind: ORGANIZATION, localId: org.id, platformId: registered.organization_id },
    update: { platformId: registered.organization_id },
  });
  return registered.organization_id;
}

/** Puts the organisation on the queue (or brings its row forward). */
export async function queueOrganization(organizationId: string): Promise<void> {
  await adminDb.platformSyncQueue.upsert({
    where: { entityKind_localId: { entityKind: ORGANIZATION, localId: organizationId } },
    create: { entityKind: ORGANIZATION, localId: organizationId },
    update: { nextAttemptAt: new Date() },
  });
}

/**
 * An organisation was created or renamed: tell the platform now, or leave it queued for the next sync. Never throws:
 * the change in CRM has already happened and must not fail because the platform is away.
 */
export async function organizationChanged(organizationId: string, client?: PlatformClient): Promise<void> {
  if (!platformLinkEnabled()) return;
  await queueOrganization(organizationId);
  await sendQueued(organizationId, client);
}

/** Sends one queued organisation: done -> the row goes; failed -> retried later with backoff. */
async function sendQueued(organizationId: string, client?: PlatformClient): Promise<boolean> {
  try {
    await syncOrganization(organizationId, client);
    await adminDb.platformSyncQueue.deleteMany({ where: { entityKind: ORGANIZATION, localId: organizationId } });
    return true;
  } catch (err) {
    const row = await adminDb.platformSyncQueue.findUnique({
      where: { entityKind_localId: { entityKind: ORGANIZATION, localId: organizationId } },
    });
    const attempts = (row?.attempts ?? 0) + 1;
    await adminDb.platformSyncQueue.updateMany({
      where: { entityKind: ORGANIZATION, localId: organizationId },
      data: {
        attempts,
        nextAttemptAt: new Date(Date.now() + backoffMs(attempts)),
        lastError: (err instanceof Error ? err.message : String(err)).slice(0, 500),
      },
    });
    return false;
  }
}

/** The retry run (`npm run platform:sync`): every due row, one run at a time across servers. */
export async function runPlatformSync(client?: PlatformClient): Promise<{ sent: number; failed: number; skipped: boolean }> {
  if (!platformLinkEnabled()) return { sent: 0, failed: 0, skipped: true };
  if (!(await tryAcquireJobLock(SYNC_JOB, LOCK_STALE_MS))) return { sent: 0, failed: 0, skipped: true };
  let sent = 0;
  let failed = 0;
  try {
    const due = await adminDb.platformSyncQueue.findMany({
      where: { entityKind: ORGANIZATION, nextAttemptAt: { lte: new Date() } },
      orderBy: { nextAttemptAt: "asc" },
      take: BATCH,
    });
    for (const row of due) {
      if (await sendQueued(row.localId, client)) sent += 1;
      else failed += 1;
    }
  } finally {
    await releaseJobLock(SYNC_JOB, failed ? { success: false, error: `${failed} not sent; retried later` } : { success: true });
  }
  return { sent, failed, skipped: false };
}

// ---------------------------------------------------------------------------------------------
// decisions from the console (the platform's decision webhook)
// ---------------------------------------------------------------------------------------------

/** The platform's signature check: HMAC-SHA256 over "<timestamp>.<raw body>", within 5 minutes. */
export function verifyPlatformSignature(
  secret: string,
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
  nowMs = Date.now(),
): boolean {
  if (!secret || !signature || !timestamp || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > 300) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`);
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export interface PlatformDecision {
  organization: { id: string; local_id: string; status: string; status_reason: string | null };
  decided_by?: string;
  decided_at?: string;
}

export class UnknownOrganizationError extends Error {
  constructor() {
    super("This organisation is not one of CRM's.");
    this.name = "UnknownOrganizationError";
  }
}

/**
 * Applies a console decision: suspended (or rejected) -> SUSPENDED, active -> ACTIVE. A repeated delivery changes
 * nothing. Suspending ends the sessions opened in that organisation; members see the "access is paused" no-access.
 */
export async function applyPlatformDecision(deliveryId: string, decision: PlatformDecision): Promise<"applied" | "repeated" | "unchanged"> {
  const { local_id: localId, id: platformId, status, status_reason: reason } = decision.organization;
  const target: OrganizationStatus | null =
    status === "active" ? "ACTIVE" : status === "suspended" || status === "rejected" ? "SUSPENDED" : null;
  const org = await adminDb.organization.findUnique({ where: { id: localId } });
  const link = org
    ? await adminDb.platformLink.findUnique({ where: { entityKind_localId: { entityKind: ORGANIZATION, localId } } })
    : null;
  // only an organisation CRM registered, under the same platform ID
  if (!org || (link && link.platformId !== platformId)) throw new UnknownOrganizationError();

  try {
    await adminDb.platformDelivery.create({ data: { deliveryId } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return "repeated";
    throw err;
  }
  if (!target || target === org.status || org.status === "INACTIVE") return "unchanged";

  await adminDb.organization.update({ where: { id: org.id }, data: { status: target } });
  if (target === "SUSPENDED") {
    await adminDb.session.updateMany({
      where: { organizationId: org.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: "ORGANIZATION_SUSPENDED" },
    });
  }
  if (!link) {
    await adminDb.platformLink.create({ data: { entityKind: ORGANIZATION, localId: org.id, platformId } });
  }
  await recordAuditEvent({
    organizationId: org.id,
    action: target === "SUSPENDED" ? "organization.suspended" : "organization.reactivated",
    entityType: "Organization",
    entityId: org.id,
    metadata: { via: "figbloom-console", reason: reason ?? null, decidedBy: decision.decided_by ?? null },
  });
  return "applied";
}
