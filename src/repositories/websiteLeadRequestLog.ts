import { adminDb } from "../db/adminClient";
import { withOrgContext } from "../db/orgScopedClient";

export type WebsiteLeadRequestOutcome =
  | "ACCEPTED"
  | "RATE_LIMITED"
  | "INVALID_KEY"
  | "ORIGIN_NOT_ALLOWED"
  | "PAYLOAD_TOO_LARGE"
  | "VALIDATION_FAILED"
  | "HONEYPOT_TRIGGERED"
  | "CAPTCHA_FAILED";

export interface RecordWebsiteLeadRequestInput {
  organizationId?: string | null;
  keyHash?: string | null;
  ipAddress?: string | null;
  origin?: string | null;
  outcome: WebsiteLeadRequestOutcome;
  reason?: string | null;
  leadId?: string | null;
}

/**
 * Written via the schema-owner `adminDb` connection, not `withOrgContext`
 * -- this runs on every request to the public endpoint, including ones
 * where the organization never resolves at all, so there's no RLS context
 * to set yet (same exception already documented in
 * src/auth/websiteApiKey.ts for the Organization/WebsiteApiKey lookups
 * that happen alongside it).
 */
export async function recordWebsiteLeadRequest(
  input: RecordWebsiteLeadRequestInput,
) {
  // B4.01: the Settings screen shows when the website last got a lead through and when it last turned one away.
  if (input.organizationId) {
    const at = new Date();
    await adminDb.websiteApiKey
      .updateMany({
        where: { organizationId: input.organizationId },
        data: input.outcome === "ACCEPTED" ? { lastAcceptedAt: at } : { lastRejectedAt: at },
      })
      .catch(() => undefined);
  }
  return adminDb.websiteLeadRequestLog.create({
    data: {
      organizationId: input.organizationId ?? null,
      keyHash: input.keyHash ?? null,
      ipAddress: input.ipAddress ?? null,
      origin: input.origin ?? null,
      outcome: input.outcome,
      reason: input.reason ?? null,
      leadId: input.leadId ?? null,
    },
  });
}

/**
 * For the settings-page monitoring view -- goes through `withOrgContext`
 * (RLS), unlike the write path above, since this is read by an
 * authenticated Management user through their resolved org context.
 */
/** Rejected submissions (everything but ACCEPTED), newest first, with a total for paging (B4.01). */
export async function listRejectedWebsiteLeadRequests(
  organizationId: string,
  filter: { outcome?: string; skip: number; take: number },
) {
  const where = {
    organizationId,
    outcome: filter.outcome ? filter.outcome : { not: "ACCEPTED" },
  };
  return withOrgContext(organizationId, async (tx) => {
    const [rows, total] = await Promise.all([
      tx.websiteLeadRequestLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: filter.skip, take: filter.take }),
      tx.websiteLeadRequestLog.count({ where }),
    ]);
    return { rows, total };
  });
}

export async function latestRejectedWebsiteLeadRequest(organizationId: string) {
  return withOrgContext(organizationId, (tx) =>
    tx.websiteLeadRequestLog.findFirst({
      where: { organizationId, outcome: { not: "ACCEPTED" } },
      orderBy: { createdAt: "desc" },
    }),
  );
}

export async function listRecentWebsiteLeadRequests(
  organizationId: string,
  limit: number,
) {
  return withOrgContext(organizationId, (tx) =>
    tx.websiteLeadRequestLog.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
  );
}
