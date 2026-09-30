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

/** How many requests this exact submitted key (valid or not) has made since `since`. */
export async function countRequestsByKeyHash(
  keyHash: string,
  since: Date,
): Promise<number> {
  return adminDb.websiteLeadRequestLog.count({
    where: { keyHash, createdAt: { gte: since } },
  });
}

/** How many requests this IP has made (to any organization) since `since`. */
export async function countRequestsByIp(
  ipAddress: string,
  since: Date,
): Promise<number> {
  return adminDb.websiteLeadRequestLog.count({
    where: { ipAddress, createdAt: { gte: since } },
  });
}

/**
 * For the settings-page monitoring view -- goes through `withOrgContext`
 * (RLS), unlike the write path above, since this is read by an
 * authenticated Management user through their resolved org context.
 */
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
