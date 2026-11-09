import { randomBytes, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { requirePermission } from "../auth/context";
import { NotFoundError, ValidationError } from "../auth/errors";
import { maskDeal } from "../auth/masking";
import { withOrgContext } from "../db/orgScopedClient";
import { logger } from "../lib/logger";
import { openSecret, sealSecret } from "../lib/secretBox";
import { UnsafeUrlError, checkWebhookUrl, resolvesToPublicAddress, safeRequest, type Resolver } from "../lib/ssrfGuard";
import {
  WEBHOOK_DISABLE_AFTER_DEAD,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_PING_EVENT,
  WEBHOOK_SIGNATURE_VERSION,
  isWebhookEventType,
  newWebhookSecret,
  signWebhook,
  webhookBackoffSeconds,
  type WebhookEventType,
} from "../lib/webhookEvents";
import { recordAuditEvent } from "../repositories/auditEvents";
import { resolveActiveMembership } from "../repositories/memberships";
import { requireFeature } from "./featureService";

/**
 * Outbound webhooks for record events (FIG-804, `docs/M17_LANE_C_PUBLIC_API_WEBHOOKS.md`).
 *
 *  - Management (`organization.manage_settings`) registers endpoints and chooses events. The signing secret (`whsec_...`) is shown once,
 *    when the endpoint is created or its secret rotated.
 *  - A service that changes a record calls `emitWebhookEvent`. It never throws and never waits for the network: it writes one PENDING
 *    delivery row per subscribed endpoint and asks the job framework to deliver.
 *  - The job `webhooks.deliver` (`src/jobs/webhookJobs.ts`) sends due deliveries, signs them, records the answer and schedules a retry with
 *    backoff (1 min, 3 min, 9 min ... 6 h) up to 8 attempts, then the delivery is DEAD. Management can retry a dead delivery.
 *  - Payloads are built as the endpoint's creator: deal values follow that person's role (`maskDeal`), margin and notes are never sent.
 *  - Every request to a receiver goes through `safeRequest` (`src/lib/ssrfGuard.ts`).
 */

export const MAX_ENDPOINTS_PER_ORGANISATION = 20;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 4096;
const CLAIM_BATCH = 50;
/** A claimed delivery that was not finished (a worker died) becomes due again after this long. */
const CLAIM_LEASE_SECONDS = 120;

export type DeliveryTransport = (input: { url: string; headers: Record<string, string>; body: string }) => Promise<{ status: number; snippet: string }>;

/** Replaced in tests so no real network is needed; production always uses `safeRequest`. */
let transportOverride: DeliveryTransport | null = null;
export function setWebhookTransportForTests(transport: DeliveryTransport | null): void {
  transportOverride = transport;
}
let resolverOverride: Resolver | undefined;
export function setWebhookResolverForTests(resolver: Resolver | undefined): void {
  resolverOverride = resolver;
}

function allowHttp(): boolean {
  // Plain http is for developing a receiver on a developer machine; production never allows it.
  return process.env.NODE_ENV !== "production" && process.env.WEBHOOK_ALLOW_HTTP === "true";
}

function endpointView(row: {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  secretHint: string;
  secretRotatedAt: Date | null;
  status: string;
  consecutiveFailures: number;
  lastDeliveryAt: Date | null;
  createdByMembershipId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    url: row.url,
    description: row.description,
    events: row.events,
    secretHint: row.secretHint,
    secretRotatedAt: row.secretRotatedAt,
    status: row.status as "ACTIVE" | "PAUSED" | "DISABLED",
    consecutiveFailures: row.consecutiveFailures,
    lastDeliveryAt: row.lastDeliveryAt,
    createdByMembershipId: row.createdByMembershipId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function requireManager(ctx: AuthContext) {
  await requireFeature(ctx.organizationId, "release.v2");
  requirePermission(ctx, "organization.manage_settings");
}

function parseEvents(events: unknown): WebhookEventType[] {
  const list = Array.isArray(events) ? [...new Set(events.map(String))] : [];
  const bad = list.filter((e) => !isWebhookEventType(e));
  if (list.length === 0 || bad.length > 0) {
    const message = list.length === 0 ? "Choose at least one event." : `Unknown event: ${bad.join(", ")}.`;
    throw new ValidationError(message, [{ path: "events", message }]);
  }
  return list as WebhookEventType[];
}

async function validateUrl(raw: string): Promise<string> {
  try {
    const url = checkWebhookUrl(raw, { allowHttp: allowHttp() });
    await resolvesToPublicAddress(url, resolverOverride);
    return url.toString();
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw new ValidationError(err.message, [{ path: "url", message: err.message }]);
    throw err;
  }
}

export interface CreateWebhookInput {
  url: string;
  events: string[];
  description?: string | null;
}

export async function createWebhookEndpoint(ctx: AuthContext, input: CreateWebhookInput) {
  await requireManager(ctx);
  const events = parseEvents(input.events);
  const url = await validateUrl(input.url ?? "");
  const description = input.description?.trim() ? input.description.trim().slice(0, 200) : null;
  const secret = newWebhookSecret(randomBytes(32).toString("base64url"));
  const row = await withOrgContext(ctx.organizationId, async (tx) => {
    const count = await tx.webhookEndpoint.count({ where: { organizationId: ctx.organizationId } });
    if (count >= MAX_ENDPOINTS_PER_ORGANISATION) {
      throw new ValidationError(`An organisation can have ${MAX_ENDPOINTS_PER_ORGANISATION} webhook endpoints. Remove one you no longer use.`);
    }
    return tx.webhookEndpoint.create({
      data: {
        organizationId: ctx.organizationId,
        url,
        description,
        events,
        secretSealed: sealSecret(secret),
        secretHint: secret.slice(-4),
        createdByMembershipId: ctx.membershipId,
      },
    });
  });
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "webhook.created",
    entityType: "WebhookEndpoint",
    entityId: row.id,
    newValue: { url, events, description },
  });
  return { ...endpointView(row), secret };
}

export async function listWebhookEndpoints(ctx: AuthContext) {
  await requireManager(ctx);
  const rows = await withOrgContext(ctx.organizationId, (tx) =>
    tx.webhookEndpoint.findMany({ where: { organizationId: ctx.organizationId }, orderBy: { createdAt: "asc" } }),
  );
  return { items: rows.map(endpointView), availableEvents: [...WEBHOOK_EVENT_TYPES] };
}

async function loadEndpoint(ctx: AuthContext, endpointId: string) {
  const row = await withOrgContext(ctx.organizationId, (tx) => tx.webhookEndpoint.findFirst({ where: { id: endpointId, organizationId: ctx.organizationId } }));
  if (!row) throw new NotFoundError("Webhook endpoint", endpointId);
  return row;
}

export async function getWebhookEndpoint(ctx: AuthContext, endpointId: string) {
  await requireManager(ctx);
  return endpointView(await loadEndpoint(ctx, endpointId));
}

export interface UpdateWebhookInput {
  url?: string;
  events?: string[];
  description?: string | null;
  /** ACTIVE resumes a paused or disabled endpoint. */
  status?: "ACTIVE" | "PAUSED";
}

export async function updateWebhookEndpoint(ctx: AuthContext, endpointId: string, input: UpdateWebhookInput) {
  await requireManager(ctx);
  const current = await loadEndpoint(ctx, endpointId);
  const data: Prisma.WebhookEndpointUpdateInput = {};
  if (input.url !== undefined) data.url = await validateUrl(input.url);
  if (input.events !== undefined) data.events = parseEvents(input.events);
  if (input.description !== undefined) data.description = input.description?.trim() ? input.description.trim().slice(0, 200) : null;
  if (input.status !== undefined) {
    if (input.status !== "ACTIVE" && input.status !== "PAUSED") throw new ValidationError("status must be ACTIVE or PAUSED.", [{ path: "status", message: "status must be ACTIVE or PAUSED." }]);
    data.status = input.status;
    if (input.status === "ACTIVE") data.consecutiveFailures = 0;
  }
  const row = await withOrgContext(ctx.organizationId, (tx) => tx.webhookEndpoint.update({ where: { id: current.id }, data }));
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "webhook.updated",
    entityType: "WebhookEndpoint",
    entityId: current.id,
    previousValue: { url: current.url, events: current.events, status: current.status, description: current.description },
    newValue: { url: row.url, events: row.events, status: row.status, description: row.description },
  });
  return endpointView(row);
}

export async function deleteWebhookEndpoint(ctx: AuthContext, endpointId: string) {
  await requireManager(ctx);
  const current = await loadEndpoint(ctx, endpointId);
  await withOrgContext(ctx.organizationId, (tx) => tx.webhookEndpoint.delete({ where: { id: current.id } }));
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "webhook.deleted",
    entityType: "WebhookEndpoint",
    entityId: current.id,
    previousValue: { url: current.url, events: current.events },
  });
  return { id: current.id, deleted: true as const };
}

/** A new secret, shown once. The old one stops working at once (receivers update theirs, then deliveries sign with the new one). */
export async function rotateWebhookSecret(ctx: AuthContext, endpointId: string) {
  await requireManager(ctx);
  const current = await loadEndpoint(ctx, endpointId);
  const secret = newWebhookSecret(randomBytes(32).toString("base64url"));
  const row = await withOrgContext(ctx.organizationId, (tx) =>
    tx.webhookEndpoint.update({
      where: { id: current.id },
      data: { secretSealed: sealSecret(secret), secretHint: secret.slice(-4), secretRotatedAt: new Date() },
    }),
  );
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "webhook.secret_rotated",
    entityType: "WebhookEndpoint",
    entityId: current.id,
    metadata: { previousHint: current.secretHint, newHint: row.secretHint },
  });
  return { ...endpointView(row), secret };
}

export async function listWebhookDeliveries(ctx: AuthContext, endpointId: string, options: { status?: string; limit?: number } = {}) {
  await requireManager(ctx);
  const endpoint = await loadEndpoint(ctx, endpointId);
  const status = options.status && ["PENDING", "DELIVERED", "DEAD"].includes(options.status) ? options.status : undefined;
  const rows = await withOrgContext(ctx.organizationId, (tx) =>
    tx.webhookDelivery.findMany({
      where: { organizationId: ctx.organizationId, endpointId: endpoint.id, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(options.limit ?? 50, 1), 200),
      // The payload is not listed: the log shows what happened, not the record again.
      select: { id: true, eventId: true, eventType: true, status: true, attempts: true, nextAttemptAt: true, lastAttemptAt: true, lastStatusCode: true, lastError: true, durationMs: true, createdAt: true, deliveredAt: true },
    }),
  );
  return { items: rows };
}

/** Puts a dead delivery back in the queue for one more round of attempts. */
export async function retryWebhookDelivery(ctx: AuthContext, endpointId: string, deliveryId: string) {
  await requireManager(ctx);
  const endpoint = await loadEndpoint(ctx, endpointId);
  const result = await withOrgContext(ctx.organizationId, (tx) =>
    tx.webhookDelivery.updateMany({
      where: { id: deliveryId, endpointId: endpoint.id, organizationId: ctx.organizationId, status: "DEAD" },
      data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(), lastError: null },
    }),
  );
  if (result.count === 0) throw new NotFoundError("Dead webhook delivery", deliveryId);
  await recordAuditEvent({ organizationId: ctx.organizationId, actorMembershipId: ctx.membershipId, action: "webhook.delivery_retried", entityType: "WebhookEndpoint", entityId: endpoint.id, metadata: { deliveryId } });
  await kickDelivery(ctx.organizationId);
  return { id: deliveryId, status: "PENDING" as const };
}

/** Sends a `webhook.ping` event to one endpoint, so the person can check the receiver and the signature. Queued like any delivery. */
export async function sendWebhookTest(ctx: AuthContext, endpointId: string) {
  await requireManager(ctx);
  const endpoint = await loadEndpoint(ctx, endpointId);
  const eventId = randomUUID();
  const payload = { id: eventId, type: WEBHOOK_PING_EVENT, createdAt: new Date().toISOString(), organizationId: ctx.organizationId, data: { message: "This is a test event from Figbloom CRM." } };
  const row = await withOrgContext(ctx.organizationId, (tx) =>
    tx.webhookDelivery.create({
      data: { organizationId: ctx.organizationId, endpointId: endpoint.id, eventId, eventType: WEBHOOK_PING_EVENT, payload, nextAttemptAt: new Date() },
    }),
  );
  await kickDelivery(ctx.organizationId);
  return { deliveryId: row.id, eventId };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Emitting events

type Rec = Record<string, unknown>;

function iso(value: unknown): string | null {
  return value instanceof Date ? value.toISOString() : typeof value === "string" ? value : null;
}

/**
 * The fields a receiver gets for each kind of record: a fixed list, never "the whole row", so a new column or a free-text note can
 * never leak by accident. Deal money is masked for the endpoint creator's role; margin is never included.
 */
function dataFor(type: WebhookEventType, record: Rec, ctx: AuthContext, extra: Rec): Rec {
  const pick = (keys: string[]): Rec => Object.fromEntries(keys.map((k) => [k, record[k] instanceof Date ? iso(record[k]) : (record[k] ?? null)]));
  switch (type) {
    case "lead.created":
    case "lead.assigned":
    case "lead.converted":
      return { lead: pick(["id", "companyId", "contactId", "leadSourceId", "leadStatusId", "temperature", "ownerMembershipId", "convertedAt", "createdAt"]), ...extra };
    case "deal.stage_changed":
    case "deal.won":
    case "deal.lost": {
      const masked = maskDeal(ctx, { ...record, ownerMembershipId: (record.ownerMembershipId as string | null) ?? null });
      const deal = Object.fromEntries(
        ["id", "companyId", "primaryContactId", "ownerMembershipId", "pipelineStageId", "outcome", "value", "currency", "expectedCloseDate", "wonAt", "lostAt", "createdAt"].map((k) => {
          const v = (masked as Rec)[k];
          if (v instanceof Date) return [k, iso(v)];
          // A decimal value goes out as text, like the rest of the API.
          return [k, v === null || v === undefined ? null : k === "value" ? String(v) : v];
        }),
      );
      return { deal: { ...deal, valueMasked: (masked as Rec).valueMasked === true }, ...extra };
    }
    case "contact.created":
      return { contact: pick(["id", "companyId", "firstName", "lastName", "email", "phone", "jobTitle", "ownerMembershipId", "createdAt"]) };
    case "company.created":
      return { company: pick(["id", "name", "industry", "website", "location", "ownerMembershipId", "createdAt"]) };
    case "task.created":
      return { task: pick(["id", "title", "assigneeMembershipId", "dueAt", "priority", "status", "companyId", "contactId", "leadId", "dealId", "createdAt"]) };
  }
}

export interface EmitWebhookInput {
  organizationId: string;
  type: WebhookEventType;
  /** The record as the service has it (a database row); only the fixed fields for its kind are sent. */
  record: object;
  /** Facts about the event that are not on the record (the stage a deal came from). Ids and plain values only. */
  extra?: Record<string, string | number | boolean | null>;
}

async function kickDelivery(organizationId: string): Promise<void> {
  try {
    // One waiting job per 10-second slot is enough: it sends everything due. A second one in the same slot is skipped by the unique key.
    const slot = Math.floor(Date.now() / 10_000);
    const { enqueueJob } = await import("../repositories/backgroundJobs");
    await enqueueJob({ organizationId, type: "webhooks.deliver", dedupeKey: `webhooks.deliver:kick:${slot}`, maxAttempts: 3, timeoutMs: 5 * 60_000 });
  } catch (err) {
    // A duplicate key is the expected "already queued"; anything else is logged, never raised.
    if ((err as { code?: string })?.code !== "P2002") logger.warn({ err }, "Webhook delivery could not be queued");
  }
}

/**
 * Records a record event for every endpoint subscribed to it. Never throws: a webhook problem must not undo or fail the change that caused
 * it. Safe to call after the change is committed.
 */
export async function emitWebhookEvent(input: EmitWebhookInput): Promise<number> {
  try {
    const endpoints = await withOrgContext(input.organizationId, (tx) =>
      tx.webhookEndpoint.findMany({ where: { organizationId: input.organizationId, status: "ACTIVE", events: { has: input.type } } }),
    );
    if (endpoints.length === 0) return 0;
    const eventId = randomUUID();
    const createdAt = new Date().toISOString();
    let queued = 0;
    for (const endpoint of endpoints) {
      // The payload is built as the person who created the endpoint, so masking follows their role today, not the role they had then.
      const creator = endpoint.createdByMembershipId ? await membershipContext(input.organizationId, endpoint.createdByMembershipId) : null;
      if (!creator) continue; // no one left to speak for this endpoint: send nothing rather than send unmasked data
      const payload = { id: eventId, type: input.type, createdAt, organizationId: input.organizationId, data: dataFor(input.type, input.record as Rec, creator, input.extra ?? {}) };
      await withOrgContext(input.organizationId, (tx) =>
        tx.webhookDelivery.create({
          data: { organizationId: input.organizationId, endpointId: endpoint.id, eventId, eventType: input.type, payload: payload as Prisma.InputJsonValue, nextAttemptAt: new Date() },
        }),
      );
      queued += 1;
    }
    if (queued > 0) await kickDelivery(input.organizationId);
    return queued;
  } catch (err) {
    logger.warn({ err, type: input.type }, "Webhook event could not be recorded");
    return 0;
  }
}

/** `lead.created` for a lead made by the public website endpoint or a web form, which write through `ingestWebsiteLead` and have only the lead's id. */
export async function emitLeadCreatedById(organizationId: string, leadId: string): Promise<number> {
  try {
    const lead = await withOrgContext(organizationId, (tx) => tx.lead.findFirst({ where: { id: leadId, organizationId } }));
    return lead ? await emitWebhookEvent({ organizationId, type: "lead.created", record: lead }) : 0;
  } catch (err) {
    logger.warn({ err }, "Webhook event could not be recorded");
    return 0;
  }
}

async function membershipContext(organizationId: string, membershipId: string): Promise<AuthContext | null> {
  try {
    const m = await withOrgContext(organizationId, (tx) => tx.membership.findFirst({ where: { id: membershipId, organizationId }, select: { userId: true } }));
    if (!m) return null;
    const ctx = await resolveActiveMembership(m.userId, organizationId);
    return ctx && ctx.membershipId === membershipId ? ctx : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Delivering

export interface DeliverySummary {
  claimed: number;
  delivered: number;
  retrying: number;
  dead: number;
}

/**
 * Sends the deliveries of one organisation that are due. A delivery is claimed by pushing its next attempt into the future (a lease), so
 * two workers never send the same one, and a worker that dies leaves it to be picked up again after the lease.
 */
export async function deliverDueWebhooks(organizationId: string, now: Date = new Date()): Promise<DeliverySummary> {
  const summary: DeliverySummary = { claimed: 0, delivered: 0, retrying: 0, dead: 0 };
  const claimed = await withOrgContext(organizationId, (tx) =>
    tx.$queryRaw<Array<{ id: string }>>`
      UPDATE webhook_deliveries
         SET next_attempt_at = ${new Date(now.getTime() + CLAIM_LEASE_SECONDS * 1000)}
       WHERE id IN (
         SELECT id FROM webhook_deliveries
          WHERE organization_id = ${organizationId} AND status = 'PENDING' AND next_attempt_at <= ${now}
          ORDER BY next_attempt_at
          LIMIT ${CLAIM_BATCH}
          FOR UPDATE SKIP LOCKED)
       RETURNING id`,
  );
  summary.claimed = claimed.length;
  for (const { id } of claimed) {
    const outcome = await attemptDelivery(organizationId, id, now);
    if (outcome === "delivered") summary.delivered += 1;
    else if (outcome === "dead") summary.dead += 1;
    else summary.retrying += 1;
  }
  return summary;
}

async function attemptDelivery(organizationId: string, deliveryId: string, now: Date): Promise<"delivered" | "retry" | "dead"> {
  const delivery = await withOrgContext(organizationId, (tx) => tx.webhookDelivery.findFirst({ where: { id: deliveryId, organizationId } }));
  if (!delivery || delivery.status !== "PENDING") return "delivered";
  const endpoint = await withOrgContext(organizationId, (tx) => tx.webhookEndpoint.findFirst({ where: { id: delivery.endpointId, organizationId } }));
  if (!endpoint || (endpoint.status !== "ACTIVE" && delivery.eventType !== WEBHOOK_PING_EVENT)) {
    await withOrgContext(organizationId, (tx) =>
      tx.webhookDelivery.update({ where: { id: delivery.id }, data: { status: "DEAD", lastError: endpoint ? "The endpoint is paused or switched off." : "The endpoint was removed.", nextAttemptAt: null } }),
    );
    return "dead";
  }

  const body = JSON.stringify(delivery.payload);
  const timestamp = Math.floor(Date.now() / 1000);
  let secret: string;
  try {
    secret = openSecret(endpoint.secretSealed);
  } catch (err) {
    // The key is missing or wrong: nothing can be signed. Keep the delivery for when it is fixed rather than killing it.
    logger.error({ err, endpointId: endpoint.id }, "Webhook secret could not be opened");
    await withOrgContext(organizationId, (tx) =>
      tx.webhookDelivery.update({ where: { id: delivery.id }, data: { lastError: "The signing secret could not be read.", nextAttemptAt: new Date(now.getTime() + 15 * 60_000) } }),
    );
    return "retry";
  }
  const headers = {
    "content-type": "application/json",
    "user-agent": "Figbloom-Webhooks/1",
    "x-figbloom-event": delivery.eventType,
    "x-figbloom-delivery": delivery.id,
    "x-figbloom-timestamp": String(timestamp),
    "x-figbloom-signature": signWebhook(secret, timestamp, body),
    "x-figbloom-signature-version": WEBHOOK_SIGNATURE_VERSION,
  };

  const started = Date.now();
  let status = 0;
  let snippet = "";
  let error: string | null = null;
  try {
    const res = transportOverride
      ? await transportOverride({ url: endpoint.url, headers, body })
      : await safeRequest(endpoint.url, { headers, body, timeoutMs: REQUEST_TIMEOUT_MS, maxResponseBytes: MAX_RESPONSE_BYTES, allowHttp: allowHttp(), resolver: resolverOverride });
    status = res.status;
    snippet = res.snippet;
    if (status < 200 || status >= 300) error = status >= 300 && status < 400 ? `The receiver answered ${status} (redirects are not followed).` : `The receiver answered ${status}.`;
  } catch (err) {
    error = err instanceof UnsafeUrlError ? "Refused: the address is private or internal." : (err instanceof Error ? err.message : "The request failed.").slice(0, 300);
  }
  const durationMs = Date.now() - started;
  const attempts = delivery.attempts + 1;

  if (!error) {
    await withOrgContext(organizationId, async (tx) => {
      await tx.webhookDelivery.update({
        where: { id: delivery.id },
        data: { status: "DELIVERED", attempts, lastAttemptAt: new Date(), lastStatusCode: status, lastError: null, durationMs, deliveredAt: new Date(), nextAttemptAt: null },
      });
      await tx.webhookEndpoint.update({ where: { id: endpoint.id }, data: { consecutiveFailures: 0, lastDeliveryAt: new Date() } });
    });
    return "delivered";
  }

  // 410 Gone is the receiver saying "stop": the endpoint is switched off at once. Anything else retries until the attempts run out.
  const gone = status === 410;
  const dead = gone || attempts >= WEBHOOK_MAX_ATTEMPTS;
  await withOrgContext(organizationId, async (tx) => {
    await tx.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: dead ? "DEAD" : "PENDING",
        attempts,
        lastAttemptAt: new Date(),
        lastStatusCode: status || null,
        lastError: (snippet && status ? `${error} ${snippet.replace(/\s+/g, " ").slice(0, 160)}` : error)?.slice(0, 400) ?? null,
        durationMs,
        nextAttemptAt: dead ? null : new Date(Date.now() + webhookBackoffSeconds(attempts) * 1000),
      },
    });
    if (dead) {
      const failures = endpoint.consecutiveFailures + 1;
      const disable = gone || failures >= WEBHOOK_DISABLE_AFTER_DEAD;
      await tx.webhookEndpoint.update({ where: { id: endpoint.id }, data: { consecutiveFailures: failures, ...(disable && endpoint.status === "ACTIVE" ? { status: "DISABLED" } : {}) } });
      if (disable && endpoint.status === "ACTIVE") {
        await tx.auditEvent.create({
          data: {
            organizationId,
            action: "webhook.disabled",
            entityType: "WebhookEndpoint",
            entityId: endpoint.id,
            metadata: { reason: gone ? "The receiver answered 410 Gone." : `${failures} deliveries in a row failed for good.` },
          },
        });
      }
    }
  });
  return dead ? "dead" : "retry";
}
