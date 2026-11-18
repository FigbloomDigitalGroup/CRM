import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { ArchivedReadOnlyError, ForbiddenError, NotFoundError, ValidationError, type ValidationIssue } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import { withOrgContext } from "../db/orgScopedClient";
import { cleanText } from "../lib/inputParsing";
import { createActivity } from "./activityService";
import { getDeal } from "./dealService";
import { type QuickCaptureInput, quickCapture } from "./quickCaptureService";
import { type QuickLogInput, quickLog } from "./quickLogService";
import { createTask, getTask, updateTask } from "./taskService";

/**
 * Offline sync for the phone and the PWA (FIG-1064, B4.07, designs M1 to M4 and S3).
 *
 * A phone that loses signal queues what the person did. When it is back online it sends the queue as one batch; each
 * item carries a client id the phone invented. The server answers per item: applied, duplicate, conflict, or rejected
 * with a reason a person can read.
 *
 *   Safe to do offline (applied by the server when the queue arrives):
 *     QUICK_CAPTURE   a lead captured in the field (a duplicate becomes a CONFLICT the person resolves later)
 *     CALL_LOG        a call logged after tapping call
 *     WHATSAPP_LOG    a WhatsApp chat logged after tapping the link
 *     NOTE_ADD        a note on a lead, contact, company or deal
 *     TASK_CREATE     a task
 *     TASK_COMPLETE   a task marked done
 *   Read-only offline, by design (the pipeline is not edited from the queue):
 *     STAGE_CHANGE, OWNER_CHANGE are never applied. A stale one answers CONFLICT with what the server has; a current
 *     one answers REJECTED "open the deal online". Either way the server's stage and owner are never overwritten.
 *
 * Conflict rules:
 *   - Notes and logs are append-only, so the latest write wins by construction; each is stamped with the time the person
 *     made it (not the time it arrived), so the timeline reads in the order things happened.
 *   - Stage and ownership: the server wins, always, with a visible reason.
 *   - Everything else follows the same permissions as the online action: a task someone reassigned meanwhile is refused.
 *
 * Replaying is safe: a client id is claimed before its mutation runs (unique per person), so sending the same batch twice,
 * or two requests racing, changes nothing the second time and answers DUPLICATE with the first answer. Items run in the
 * order the person made them (`clientCreatedAt`, then position), so a capture is there before the call logged against it.
 * A later item may refer to an earlier one with `"ref:<clientId>"` in place of a record id.
 */

export const SYNC_KINDS = ["QUICK_CAPTURE", "CALL_LOG", "WHATSAPP_LOG", "NOTE_ADD", "TASK_CREATE", "TASK_COMPLETE", "STAGE_CHANGE", "OWNER_CHANGE"] as const;
export type SyncKind = (typeof SYNC_KINDS)[number];
export const OFFLINE_SAFE_KINDS: readonly SyncKind[] = ["QUICK_CAPTURE", "CALL_LOG", "WHATSAPP_LOG", "NOTE_ADD", "TASK_CREATE", "TASK_COMPLETE"];
export const SERVER_WINS_KINDS: readonly SyncKind[] = ["STAGE_CHANGE", "OWNER_CHANGE"];

export const MAX_BATCH = 100;
const MAX_PAYLOAD_BYTES = 20_000;
const CLIENT_ID = /^[\x21-\x7e]{8,200}$/;
const CLOCK_SKEW_MS = 5 * 60_000;
const PENDING_STALE_MS = 2 * 60_000;
const MAX_NOTE = 2000;

export type SyncStatus = "APPLIED" | "DUPLICATE" | "CONFLICT" | "REJECTED";

export interface SyncMutationInput {
  clientId: string;
  kind: string;
  payload?: Record<string, unknown>;
  /** When the person did it, ISO 8601. Defaults to arrival time; a time in the future is treated as now. */
  clientCreatedAt?: string;
}

export interface SyncItemResult {
  clientId: string;
  kind: string;
  status: SyncStatus;
  /** For DUPLICATE: what happened the first time. */
  originalStatus?: string;
  reason?: { code: string; message: string; issues?: ValidationIssue[] };
  entity?: { type: string; id: string };
  /** For a CONFLICT: what the server has, so the person can see why. */
  serverState?: Record<string, unknown>;
}

interface Outcome {
  status: "APPLIED" | "CONFLICT" | "REJECTED";
  reason?: SyncItemResult["reason"];
  entity?: SyncItemResult["entity"];
  serverState?: Record<string, unknown>;
}

class Reject extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly issues?: ValidationIssue[],
  ) {
    super(message);
  }
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

const hashOf = (kind: string, payload: unknown) => createHash("sha256").update(`${kind}|${stable(payload ?? {})}`).digest("hex");

function str(payload: Record<string, unknown>, key: string): string | undefined {
  const v = payload[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Replaces "ref:<clientId>" in the record id fields with the id of what that earlier mutation made. */
async function resolveRefs(ctx: AuthContext, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { ...payload };
  for (const key of ["leadId", "contactId", "companyId", "dealId", "taskId"]) {
    const value = out[key];
    if (typeof value === "string" && value.startsWith("ref:")) {
      const clientId = value.slice(4);
      const earlier = await withOrgContext(ctx.organizationId, (tx) =>
        tx.syncMutation.findUnique({
          where: { organizationId_membershipId_clientId: { organizationId: ctx.organizationId, membershipId: ctx.membershipId, clientId } },
        }),
      );
      const ok = earlier && earlier.status === "APPLIED" && earlier.entityId;
      if (!ok) {
        throw new Reject("DEPENDENCY_FAILED", `This depends on "${clientId}", which was not applied, so it could not be applied either.`);
      }
      out[key] = earlier.entityId;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// One handler per kind
// ---------------------------------------------------------------------------

type Handler = (ctx: AuthContext, payload: Record<string, unknown>, at: Date) => Promise<Outcome>;

const handlers: Record<SyncKind, Handler> = {
  async QUICK_CAPTURE(ctx, payload) {
    const result = await quickCapture(ctx, payload as unknown as QuickCaptureInput);
    if (result.status === "DUPLICATE_WARNING") {
      return {
        status: "CONFLICT",
        reason: { code: "DUPLICATE_FOUND", message: "Someone like this is already in the CRM. Nothing was created; choose open, create anyway or merge." },
        serverState: { duplicates: result.duplicates, hiddenDuplicates: result.hiddenDuplicates, options: result.options },
      };
    }
    if (result.status === "CREATED") return { status: "APPLIED", entity: { type: "Lead", id: result.lead.id } };
    if (result.status === "MERGED") return { status: "APPLIED", entity: { type: result.mergedInto.type === "lead" ? "Lead" : "Contact", id: result.mergedInto.id } };
    return { status: "APPLIED", entity: { type: result.existing.type === "lead" ? "Lead" : "Contact", id: result.existing.id } };
  },

  async CALL_LOG(ctx, payload, at) {
    const result = await quickLog(ctx, { ...(payload as unknown as QuickLogInput), channel: "CALL" }, at);
    return { status: "APPLIED", entity: { type: "Communication", id: result.communicationId } };
  },

  async WHATSAPP_LOG(ctx, payload, at) {
    const result = await quickLog(ctx, { ...(payload as unknown as QuickLogInput), channel: "WHATSAPP" }, at);
    return { status: "APPLIED", entity: { type: "Communication", id: result.communicationId } };
  },

  async NOTE_ADD(ctx, payload, at) {
    const text = cleanText(payload.text, "text", MAX_NOTE, { required: true })!;
    const links = { leadId: str(payload, "leadId"), contactId: str(payload, "contactId"), companyId: str(payload, "companyId"), dealId: str(payload, "dealId") };
    if (Object.values(links).filter(Boolean).length !== 1) {
      throw new Reject("INVALID_MUTATION", "A note belongs to exactly one record: a lead, contact, company or deal.");
    }
    const activity = await createActivity(ctx, { type: "NOTE", subject: cleanText(payload.subject, "subject", 200) ?? undefined, description: text, occurredAt: at, ...links });
    return { status: "APPLIED", entity: { type: "Activity", id: activity.id } };
  },

  async TASK_CREATE(ctx, payload) {
    const title = cleanText(payload.title, "title", 200, { required: true })!;
    const task = await createTask(ctx, {
      title,
      description: cleanText(payload.description, "description", 2000) ?? undefined,
      dueAt: str(payload, "dueAt"),
      priority: payload.priority === "HIGH" || payload.priority === "LOW" ? payload.priority : "MEDIUM",
      leadId: str(payload, "leadId"),
      contactId: str(payload, "contactId"),
      companyId: str(payload, "companyId"),
      dealId: str(payload, "dealId"),
    });
    return { status: "APPLIED", entity: { type: "Task", id: task.id } };
  },

  async TASK_COMPLETE(ctx, payload) {
    const taskId = str(payload, "taskId");
    if (!taskId) throw new Reject("INVALID_MUTATION", "Say which task was completed.");
    const task = await getTask(ctx, taskId);
    // Already done (here or on another device): the answer is the same, and the earlier completion time stands.
    if (task.status === "COMPLETED") return { status: "APPLIED", entity: { type: "Task", id: taskId } };
    try {
      await updateTask(ctx, taskId, { status: "COMPLETED" });
    } catch (err) {
      if (err instanceof ForbiddenError) {
        throw new Reject("FORBIDDEN", "This task is not yours to complete any more. Ask whoever it was reassigned to.");
      }
      throw err;
    }
    return { status: "APPLIED", entity: { type: "Task", id: taskId } };
  },

  async STAGE_CHANGE(ctx, payload) {
    const dealId = str(payload, "dealId");
    const expectedStageId = str(payload, "expectedStageId");
    if (!dealId || !expectedStageId) throw new Reject("INVALID_MUTATION", "A stage change names the deal and the stage the phone last saw.");
    const deal = await getDeal(ctx, dealId);
    if (deal.pipelineStageId !== expectedStageId) {
      const stage = await adminDb.pipelineStage.findFirst({ where: { id: deal.pipelineStageId, organizationId: ctx.organizationId }, select: { id: true, name: true } });
      return {
        status: "CONFLICT",
        reason: { code: "STAGE_CHANGED", message: `The deal has moved to ${stage?.name ?? "another stage"} since your phone last saw it. The server's stage was kept.` },
        entity: { type: "Deal", id: dealId },
        serverState: { stageId: deal.pipelineStageId, stageName: stage?.name ?? null, updatedAt: deal.updatedAt },
      };
    }
    return {
      status: "REJECTED",
      reason: { code: "NOT_ALLOWED_OFFLINE", message: "The pipeline cannot be changed from the offline queue. Open the deal when you are online." },
      entity: { type: "Deal", id: dealId },
    };
  },

  async OWNER_CHANGE(ctx, payload) {
    const dealId = str(payload, "dealId");
    const expectedOwnerId = str(payload, "expectedOwnerMembershipId");
    if (!dealId || !expectedOwnerId) throw new Reject("INVALID_MUTATION", "An owner change names the deal and the owner the phone last saw.");
    const deal = await getDeal(ctx, dealId);
    if (deal.ownerMembershipId !== expectedOwnerId) {
      return {
        status: "CONFLICT",
        reason: { code: "OWNER_CHANGED", message: "The deal has a different owner since your phone last saw it. The server's owner was kept." },
        entity: { type: "Deal", id: dealId },
        serverState: { ownerMembershipId: deal.ownerMembershipId },
      };
    }
    return {
      status: "REJECTED",
      reason: { code: "NOT_ALLOWED_OFFLINE", message: "Ownership cannot be changed from the offline queue. Open the deal when you are online." },
      entity: { type: "Deal", id: dealId },
    };
  },
};

function describeError(err: unknown): Outcome | null {
  if (err instanceof Reject) return { status: "REJECTED", reason: { code: err.code, message: err.message, issues: err.issues } };
  if (err instanceof ArchivedReadOnlyError) return { status: "REJECTED", reason: { code: "ARCHIVED", message: err.message } };
  if (err instanceof ValidationError) return { status: "REJECTED", reason: { code: "VALIDATION_FAILED", message: err.message, issues: err.issues } };
  if (err instanceof ForbiddenError) return { status: "REJECTED", reason: { code: "FORBIDDEN", message: "Your role cannot do this." } };
  if (err instanceof NotFoundError) return { status: "REJECTED", reason: { code: "NOT_FOUND", message: "That record no longer exists, or you cannot open it." } };
  return null;
}

// ---------------------------------------------------------------------------
// The batch
// ---------------------------------------------------------------------------

function fromRow(row: { clientId: string; kind: string; status: string; reason: string | null; entityType: string | null; entityId: string | null; response: Prisma.JsonValue | null }): Omit<SyncItemResult, "status" | "originalStatus"> & { stored: string } {
  const response = (row.response ?? {}) as { reason?: SyncItemResult["reason"]; serverState?: Record<string, unknown> };
  return {
    clientId: row.clientId,
    kind: row.kind,
    stored: row.status,
    ...(response.reason ? { reason: response.reason } : row.reason ? { reason: { code: row.reason, message: row.reason } } : {}),
    ...(row.entityType && row.entityId ? { entity: { type: row.entityType, id: row.entityId } } : {}),
    ...(response.serverState ? { serverState: response.serverState } : {}),
  };
}

async function processOne(ctx: AuthContext, item: SyncMutationInput, batchId: string, now: Date): Promise<SyncItemResult> {
  const clientId = typeof item.clientId === "string" ? item.clientId : "";
  const kind = typeof item.kind === "string" ? item.kind : "";
  const base = { clientId: clientId || "(missing)", kind: kind || "(missing)" };
  if (!CLIENT_ID.test(clientId)) {
    return { ...base, status: "REJECTED", reason: { code: "INVALID_MUTATION", message: "clientId must be 8 to 200 printable characters, unique for each queued action." } };
  }
  if (!(SYNC_KINDS as readonly string[]).includes(kind)) {
    return { ...base, status: "REJECTED", reason: { code: "UNKNOWN_KIND", message: `"${kind}" cannot be synced. Use one of: ${SYNC_KINDS.join(", ")}.` } };
  }
  const payload = item.payload && typeof item.payload === "object" && !Array.isArray(item.payload) ? item.payload : {};
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > MAX_PAYLOAD_BYTES) {
    return { ...base, status: "REJECTED", reason: { code: "INVALID_MUTATION", message: "This queued action is too large." } };
  }
  let at = now;
  if (item.clientCreatedAt !== undefined) {
    const parsed = new Date(item.clientCreatedAt);
    if (Number.isNaN(parsed.getTime())) {
      return { ...base, status: "REJECTED", reason: { code: "INVALID_MUTATION", message: "clientCreatedAt is not a valid date and time." } };
    }
    // A phone clock that is ahead is clamped to now, so nothing is ever recorded in the future.
    at = parsed.getTime() > now.getTime() + CLOCK_SKEW_MS ? now : new Date(Math.min(parsed.getTime(), now.getTime()));
  }
  const requestHash = hashOf(kind, payload);
  const where = { organizationId_membershipId_clientId: { organizationId: ctx.organizationId, membershipId: ctx.membershipId, clientId } };

  // Claim the client id first.
  let claimed = false;
  try {
    await withOrgContext(ctx.organizationId, (tx) =>
      tx.syncMutation.create({
        data: { organizationId: ctx.organizationId, membershipId: ctx.membershipId, clientId, kind, status: "PENDING", requestHash, clientCreatedAt: at, batchId },
      }),
    );
    claimed = true;
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
  }

  if (!claimed) {
    const existing = await withOrgContext(ctx.organizationId, (tx) => tx.syncMutation.findUnique({ where }));
    if (!existing) return { ...base, status: "REJECTED", reason: { code: "SERVER_BUSY", message: "Try this one again in a moment." } };
    if (existing.requestHash !== requestHash) {
      return { ...base, status: "REJECTED", reason: { code: "CLIENT_ID_REUSED", message: "This client id was already used for a different action." } };
    }
    if (existing.status === "PENDING") {
      if (now.getTime() - existing.createdAt.getTime() < PENDING_STALE_MS) {
        return { ...base, status: "DUPLICATE", originalStatus: "PENDING" };
      }
      // The earlier attempt died without answering: take it over.
      await withOrgContext(ctx.organizationId, (tx) => tx.syncMutation.update({ where, data: { createdAt: now, batchId } }));
      claimed = true;
    } else {
      const { stored, ...rest } = fromRow(existing);
      return { ...rest, status: "DUPLICATE", originalStatus: stored };
    }
  }

  let outcome: Outcome;
  try {
    const resolved = await resolveRefs(ctx, payload);
    outcome = await handlers[kind as SyncKind](ctx, resolved, at);
  } catch (err) {
    const described = describeError(err);
    if (!described) {
      // An unexpected failure is not remembered: the same client id may be sent again and will run.
      await withOrgContext(ctx.organizationId, (tx) => tx.syncMutation.deleteMany({ where: { organizationId: ctx.organizationId, membershipId: ctx.membershipId, clientId, status: "PENDING" } })).catch(() => undefined);
      return { ...base, status: "REJECTED", reason: { code: "SERVER_ERROR", message: "The server could not apply this. It will be tried again next time." } };
    }
    outcome = described;
  }

  await withOrgContext(ctx.organizationId, (tx) =>
    tx.syncMutation.update({
      where,
      data: {
        status: outcome.status,
        reason: outcome.reason?.code ?? null,
        entityType: outcome.entity?.type ?? null,
        entityId: outcome.entity?.id ?? null,
        response: { reason: outcome.reason ?? null, serverState: outcome.serverState ?? null } as Prisma.InputJsonValue,
      },
    }),
  );
  return { ...base, status: outcome.status, ...(outcome.reason ? { reason: outcome.reason } : {}), ...(outcome.entity ? { entity: outcome.entity } : {}), ...(outcome.serverState ? { serverState: outcome.serverState } : {}) };
}

export interface SyncBatchInput {
  mutations: SyncMutationInput[];
}

export async function applySyncBatch(ctx: AuthContext, input: SyncBatchInput, now = new Date()) {
  if (!Array.isArray(input.mutations) || input.mutations.length === 0) {
    throw new ValidationError("Send at least one queued action.", [{ path: "mutations", message: "The queue is empty." }]);
  }
  if (input.mutations.length > MAX_BATCH) {
    throw new ValidationError(`A batch holds at most ${MAX_BATCH} actions. Send the rest in the next batch.`, [{ path: "mutations", message: `At most ${MAX_BATCH}.` }]);
  }
  const batchId = createHash("sha1").update(`${ctx.membershipId}|${now.toISOString()}|${Math.random()}`).digest("hex").slice(0, 24);

  // In the order the person made them; ties and missing times keep their position.
  const order = input.mutations
    .map((m, index) => ({ m, index, t: typeof m?.clientCreatedAt === "string" ? Date.parse(m.clientCreatedAt) : Number.NaN }))
    .sort((a, b) => {
      const ta = Number.isNaN(a.t) ? Number.POSITIVE_INFINITY : a.t;
      const tb = Number.isNaN(b.t) ? Number.POSITIVE_INFINITY : b.t;
      // Items with no time stay after the timed ones, in their own order.
      if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
      if (Number.isFinite(ta) !== Number.isFinite(tb)) return Number.isFinite(ta) ? -1 : 1;
      return a.index - b.index;
    });

  const results = new Array<SyncItemResult>(input.mutations.length);
  const seen = new Set<string>();
  for (const { m, index } of order) {
    // The same client id twice in one batch is the second one's duplicate, answered without touching the database.
    if (typeof m?.clientId === "string" && seen.has(m.clientId)) {
      results[index] = { clientId: m.clientId, kind: String(m.kind), status: "DUPLICATE", originalStatus: "SAME_BATCH" };
      continue;
    }
    if (typeof m?.clientId === "string") seen.add(m.clientId);
    results[index] = await processOne(ctx, m, batchId, now);
  }

  const counts = { applied: 0, duplicate: 0, conflict: 0, rejected: 0 };
  for (const r of results) counts[r.status.toLowerCase() as keyof typeof counts] += 1;
  return { batchId, serverTime: now, processedOrder: order.map((o) => o.index), results, counts };
}

/** The queue as the server sees it: when this person last synced, what happened lately, and what needs their attention. */
export async function getSyncStatus(ctx: AuthContext, now = new Date()) {
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  return withOrgContext(ctx.organizationId, async (tx) => {
    const where = { organizationId: ctx.organizationId, membershipId: ctx.membershipId, createdAt: { gte: since } };
    const [byStatus, last, attention] = await Promise.all([
      tx.syncMutation.groupBy({ by: ["status"], where, _count: { _all: true } }),
      tx.syncMutation.findFirst({ where: { organizationId: ctx.organizationId, membershipId: ctx.membershipId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      tx.syncMutation.findMany({ where: { ...where, status: { in: ["CONFLICT", "REJECTED"] } }, orderBy: { createdAt: "desc" }, take: 30 }),
    ]);
    const count = (s: string) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
    return {
      serverTime: now,
      lastSyncAt: last?.createdAt ?? null,
      lastSevenDays: { applied: count("APPLIED"), conflict: count("CONFLICT"), rejected: count("REJECTED"), pending: count("PENDING") },
      needsAttention: attention.map((row) => {
        const { stored, ...rest } = fromRow(row);
        return { ...rest, status: stored as SyncStatus, at: row.createdAt };
      }),
      maxBatch: MAX_BATCH,
    };
  });
}
