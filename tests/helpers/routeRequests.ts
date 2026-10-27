/**
 * Hand-written requests for the few routes whose input the generic builder cannot guess, because they insist on a combination
 * ("exactly one of these ids"), a real value ("a date"), or a state (a push address on an allowed host). Keyed `METHOD /path`.
 * Everything else is built from the route's own schema (see sampleBody.ts).
 */
import type { Hints } from "./sampleBody";

export interface RequestOverride {
  body?: unknown;
  query?: string;
}

const PUSH_KEY = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";

export const REQUEST_OVERRIDES: Record<string, (hints: Hints) => RequestOverride> = {
  "GET /api/orgs/{orgSlug}/activities": (h) => ({ query: `?leadId=${h.leadId}` }),
  "GET /api/orgs/{orgSlug}/audit": (h) => ({ query: `?entityType=Lead&entityId=${h.leadId}` }),
  "GET /api/orgs/{orgSlug}/calendar": () => ({ query: "?date=2026-11-02&view=week" }),
  "POST /api/orgs/{orgSlug}/calendar": (h) => ({ body: { kind: "task", title: "Follow up", start: "2026-11-02T09:00:00.000Z", assigneeMembershipId: h.ownerMembershipId } }),
  "GET /api/orgs/{orgSlug}/communications": (h) => ({ query: `?leadId=${h.leadId}` }),
  "GET /api/orgs/{orgSlug}/company-services": (h) => ({ query: `?companyId=${h.companyId}` }),
  "POST /api/orgs/{orgSlug}/reference-catalogs/{catalogKey}": () => ({ body: { name: "Referral partner" } }),
  "POST /api/orgs/{orgSlug}/reference-catalogs/{catalogKey}/{entryId}": () => ({ body: { isActive: true } }),
  "POST /api/orgs/{orgSlug}/reference-catalogs/{catalogKey}/{entryId}/move": () => ({ body: { direction: "up" } }),
  "POST /api/orgs/{orgSlug}/files": () => ({ body: { purpose: "ATTACHMENT", name: "brief.pdf", mimeType: "application/pdf", sizeBytes: 12, checksumSha256: "a".repeat(64) } }),
  "POST /api/orgs/{orgSlug}/privacy/export-approvals": () => ({ body: { entity: "LEAD", reason: "Quarterly review" } }),
  "POST /api/orgs/{orgSlug}/push/subscriptions": () => ({ body: { endpoint: "https://fcm.googleapis.com/fcm/send/walk-1", keys: { p256dh: PUSH_KEY, auth: "tBHItJI5svbpez7KI4CCXg" } } }),
  "POST /api/orgs/{orgSlug}/website-lead-assignment-rules/{ruleId}": () => ({ body: { isActive: true } }),
  "POST /api/orgs/{orgSlug}/quick-capture": () => ({ body: { name: "Amina Odhiambo", phone: "+254722000111" } }),
  "GET /api/orgs/{orgSlug}/quick-log/prompt": (h) => ({ query: `?leadId=${h.leadId}` }),
  "POST /api/orgs/{orgSlug}/me/preferences/undo": () => ({ body: { token: "walk-token" } }),
};
