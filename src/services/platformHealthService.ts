import { randomUUID } from "node:crypto";
import { NotFoundError, ValidationError } from "../auth/errors";
import type { PlatformContext } from "../auth/platformSession";
import { getPlatformDb } from "../db/platformClient";
import { appDb } from "../db/orgScopedClient";
import { getStorageDriver } from "../storage";
import { lastVerification, recordPlatformAudit } from "./platformAuditService";

/**
 * System health and the platform home numbers (FIG-1139, B6.07; screens PL1, PL9).
 *
 * `checkSystemHealth` probes five components for real, each with a time limit,
 * and each probe fails on its own: one broken component is reported as such and
 * never hides the others. Tests inject a failing probe through `probes`.
 *
 * Nothing here reads a tenant row. The jobs and email probes read two
 * counts-only views (`platform_jobs_health`, `platform_email_health`); the
 * home numbers read the organisation counts view and platform tables.
 */

export const HEALTH_COMPONENTS = ["API", "DATABASE", "JOBS", "EMAIL", "STORAGE"] as const;
export type HealthComponent = (typeof HEALTH_COMPONENTS)[number];
export type HealthStatus = "OPERATIONAL" | "DEGRADED" | "DOWN";

export interface ComponentHealth {
  component: HealthComponent;
  status: HealthStatus;
  detail: string;
  latencyMs: number | null;
  metrics: Record<string, number | string | boolean | null>;
  checkedAt: string;
}

export type ProbeResult = Omit<ComponentHealth, "component" | "checkedAt" | "latencyMs"> & { latencyMs?: number | null };
export type Probe = () => Promise<ProbeResult>;

export const PROBE_TIMEOUT_MS = 5000;
const SLOW_DB_MS = 1000;
const JOBS_LATE_MS = 15 * 60_000;
const JOBS_STUCK_MS = 60 * 60_000;

const rank: Record<HealthStatus, number> = { OPERATIONAL: 0, DEGRADED: 1, DOWN: 2 };
export const worst = (statuses: HealthStatus[]): HealthStatus => statuses.reduce<HealthStatus>((a, b) => (rank[b] > rank[a] ? b : a), "OPERATIONAL");

const apiProbe: Probe = async () => ({
  status: "OPERATIONAL",
  detail: "The API is answering requests.",
  metrics: { uptimeSeconds: Math.round(process.uptime()), node: process.version },
});

const databaseProbe: Probe = async () => {
  const started = Date.now();
  // Both connections the product depends on: the platform role (this console) and the tenant application role (every organisation).
  await getPlatformDb().$queryRaw`SELECT 1`;
  await appDb.$queryRaw`SELECT 1`;
  const ms = Date.now() - started;
  return ms > SLOW_DB_MS
    ? { status: "DEGRADED", detail: `The database answered slowly (${ms} ms).`, latencyMs: ms, metrics: { responseMs: ms } }
    : { status: "OPERATIONAL", detail: "The database is answering.", latencyMs: ms, metrics: { responseMs: ms } };
};

const jobsProbe: Probe = async () => {
  const rows = await getPlatformDb().$queryRaw<
    { queued_count: bigint; running_count: bigint; dead_count: bigint; oldest_due_at: Date | null; last_succeeded_at: Date | null }[]
  >`SELECT queued_count, running_count, dead_count, oldest_due_at, last_succeeded_at FROM platform_jobs_health`;
  const r = rows[0]!;
  const lateMs = r.oldest_due_at ? Date.now() - r.oldest_due_at.getTime() : 0;
  const metrics = {
    queued: Number(r.queued_count),
    running: Number(r.running_count),
    dead: Number(r.dead_count),
    oldestDueMinutes: Math.round(lateMs / 60_000),
    lastSucceededAt: r.last_succeeded_at?.toISOString() ?? null,
  };
  if (lateMs > JOBS_STUCK_MS) return { status: "DOWN", detail: `Jobs are not being picked up: the oldest due job has waited ${metrics.oldestDueMinutes} minutes.`, metrics };
  if (lateMs > JOBS_LATE_MS) return { status: "DEGRADED", detail: `Jobs are running late: the oldest due job has waited ${metrics.oldestDueMinutes} minutes.`, metrics };
  if (metrics.dead > 0) return { status: "DEGRADED", detail: `${metrics.dead} job${metrics.dead === 1 ? " is" : "s are"} in the dead-letter list.`, metrics };
  return { status: "OPERATIONAL", detail: "Jobs are running on time.", metrics };
};

const emailProbe: Probe = async () => {
  const rows = await getPlatformDb().$queryRaw<{ sent_24h: bigint; failed_24h: bigint; stuck_count: bigint }[]>`
    SELECT sent_24h, failed_24h, stuck_count FROM platform_email_health`;
  const r = rows[0]!;
  const metrics = { sent24h: Number(r.sent_24h), failed24h: Number(r.failed_24h), stuck: Number(r.stuck_count), providerConfigured: Boolean(process.env.SMTP_HOST) };
  if (!metrics.providerConfigured) return { status: "DEGRADED", detail: "No email provider is configured: messages are only logged, nobody receives them.", metrics };
  if (metrics.failed24h > 0 && metrics.failed24h >= metrics.sent24h) return { status: "DOWN", detail: `Email is failing: ${metrics.failed24h} failed and ${metrics.sent24h} sent in the last 24 hours.`, metrics };
  if (metrics.failed24h > 0 || metrics.stuck > 10) return { status: "DEGRADED", detail: `${metrics.failed24h} email${metrics.failed24h === 1 ? "" : "s"} failed in the last 24 hours and ${metrics.stuck} are waiting to be retried.`, metrics };
  return { status: "OPERATIONAL", detail: "Email is being delivered.", metrics };
};

const storageProbe: Probe = async (): Promise<ProbeResult> => {
  // Writes, reads back and removes a small object under a key no organisation owns.
  const driver = getStorageDriver();
  const key = `orgs/00000000-0000-0000-0000-000000000000/health/${randomUUID()}`;
  const payload = Buffer.from("figbloom-health-probe");
  const started = Date.now();
  try {
    await driver.putObject(key, payload, { contentType: "text/plain" });
    const back = await driver.getObject(key, 1024);
    if (!back.equals(payload)) return { status: "DOWN", detail: "Storage returned different bytes from what was written.", metrics: { driver: driver.name, responseMs: null } };
  } finally {
    await driver.deleteObject(key).catch(() => undefined);
  }
  const ms = Date.now() - started;
  return { status: "OPERATIONAL", detail: "Storage accepts and returns files.", latencyMs: ms, metrics: { driver: driver.name, responseMs: ms } };
};

export const DEFAULT_PROBES: Record<HealthComponent, Probe> = {
  API: apiProbe,
  DATABASE: databaseProbe,
  JOBS: jobsProbe,
  EMAIL: emailProbe,
  STORAGE: storageProbe,
};

async function runProbe(component: HealthComponent, probe: Probe, timeoutMs: number): Promise<ComponentHealth> {
  const started = Date.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    const result = await Promise.race([
      probe(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no answer within ${timeoutMs} ms`)), timeoutMs);
      }),
    ]);
    return { component, ...result, latencyMs: result.latencyMs ?? Date.now() - started, checkedAt: new Date().toISOString() };
  } catch (err) {
    return {
      component,
      status: "DOWN",
      detail: `The ${component.toLowerCase()} check failed: ${err instanceof Error ? err.message.split("\n").pop() : "unknown error"}`,
      latencyMs: Date.now() - started,
      metrics: {},
      checkedAt: new Date().toISOString(),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function checkSystemHealth(options: { probes?: Partial<Record<HealthComponent, Probe>>; timeoutMs?: number } = {}) {
  const probes = { ...DEFAULT_PROBES, ...options.probes };
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  const components = await Promise.all(HEALTH_COMPONENTS.map((c) => runProbe(c, probes[c], timeoutMs)));
  const incidents = await listIncidents({ openOnly: true });
  return {
    overall: worst(components.map((c) => c.status)),
    checkedAt: new Date().toISOString(),
    components,
    openIncidents: incidents,
  };
}

// ---------------------------------------------------------------------------
// Incident markers
// ---------------------------------------------------------------------------

export const INCIDENT_SEVERITIES = ["INFO", "DEGRADED", "OUTAGE"] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

function presentIncident(i: { id: string; component: string; severity: string; title: string; note: string | null; startedAt: Date; resolvedAt: Date | null }) {
  return { id: i.id, component: i.component as HealthComponent, severity: i.severity as IncidentSeverity, title: i.title, note: i.note, startedAt: i.startedAt.toISOString(), resolvedAt: i.resolvedAt?.toISOString() ?? null, open: i.resolvedAt === null };
}

export async function listIncidents(options: { openOnly?: boolean; days?: number } = {}) {
  const since = new Date(Date.now() - (options.days ?? 30) * 86_400_000);
  const rows = await getPlatformDb().platformIncident.findMany({
    where: options.openOnly ? { resolvedAt: null } : { OR: [{ resolvedAt: null }, { startedAt: { gte: since } }] },
    orderBy: { startedAt: "desc" },
    take: 100,
  });
  return rows.map(presentIncident);
}

export async function createIncident(
  actor: Pick<PlatformContext, "identityId" | "email">,
  input: { component: string; severity: string; title: string; note?: string },
  requestId?: string | null,
) {
  const issues: { path: string; message: string }[] = [];
  if (!(HEALTH_COMPONENTS as readonly string[]).includes(input.component)) issues.push({ path: "component", message: `Use one of ${HEALTH_COMPONENTS.join(", ")}.` });
  if (!(INCIDENT_SEVERITIES as readonly string[]).includes(input.severity)) issues.push({ path: "severity", message: `Use one of ${INCIDENT_SEVERITIES.join(", ")}.` });
  const title = input.title?.trim() ?? "";
  if (title.length < 3 || title.length > 140) issues.push({ path: "title", message: "Give the incident a title of 3 to 140 characters." });
  if ((input.note ?? "").length > 1000) issues.push({ path: "note", message: "At most 1000 characters." });
  if (issues.length > 0) throw new ValidationError(issues[0]!.message, issues);

  const db = getPlatformDb();
  const row = await db.$transaction(async (tx) => {
    const created = await tx.platformIncident.create({
      data: { component: input.component, severity: input.severity, title, note: input.note?.trim() || null, createdByIdentityId: actor.identityId },
    });
    await recordPlatformAudit(tx, {
      actorIdentityId: actor.identityId,
      actorLabel: actor.email,
      action: "incident.opened",
      targetType: "Incident",
      targetId: created.id,
      metadata: { component: input.component, severity: input.severity },
      requestId: requestId ?? null,
    });
    return created;
  });
  return presentIncident(row);
}

export async function resolveIncident(actor: Pick<PlatformContext, "identityId" | "email">, id: string, requestId?: string | null) {
  const db = getPlatformDb();
  return db.$transaction(async (tx) => {
    const existing = await tx.platformIncident.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Incident", id);
    if (existing.resolvedAt) return presentIncident(existing);
    const updated = await tx.platformIncident.update({ where: { id }, data: { resolvedAt: new Date(), resolvedByIdentityId: actor.identityId } });
    await recordPlatformAudit(tx, {
      actorIdentityId: actor.identityId,
      actorLabel: actor.email,
      action: "incident.resolved",
      targetType: "Incident",
      targetId: id,
      metadata: { component: existing.component },
      requestId: requestId ?? null,
    });
    return presentIncident(updated);
  });
}

// ---------------------------------------------------------------------------
// Platform home (PL1): counts only
// ---------------------------------------------------------------------------

export async function getPlatformHome(options: { probes?: Partial<Record<HealthComponent, Probe>> } = {}) {
  const db = getPlatformDb();
  const byStatus = await db.$queryRaw<{ status: string; n: bigint }[]>`SELECT status, count(*)::bigint AS n FROM platform_organization_counts GROUP BY status`;
  const status = Object.fromEntries(byStatus.map((s) => [s.status, Number(s.n)])) as Record<string, number>;
  const totals = await db.$queryRaw<{ members: bigint | null }[]>`SELECT sum(active_member_count)::bigint AS members FROM platform_organization_counts WHERE status = 'ACTIVE'`;
  const requests = await db.platformDataRequest.groupBy({ by: ["status"], where: { status: { in: ["SUBMITTED", "APPROVED"] } }, _count: { _all: true } });
  const openRequests = Object.fromEntries(requests.map((r) => [r.status, r._count._all]));
  const health = await checkSystemHealth({ probes: options.probes });
  return {
    organisations: {
      total: Object.values(status).reduce((a, b) => a + b, 0),
      active: status.ACTIVE ?? 0,
      suspended: status.SUSPENDED ?? 0,
      offboarding: status.OFFBOARDING ?? 0,
      offboarded: status.OFFBOARDED ?? 0,
      activeMembers: Number(totals[0]?.members ?? 0),
    },
    requests: {
      open: (openRequests.SUBMITTED ?? 0) + (openRequests.APPROVED ?? 0),
      awaitingApproval: openRequests.SUBMITTED ?? 0,
      approved: openRequests.APPROVED ?? 0,
    },
    health: { overall: health.overall, components: health.components.map((c) => ({ component: c.component, status: c.status })), openIncidents: health.openIncidents.length },
    auditLog: await lastVerification(),
    generatedAt: new Date().toISOString(),
  };
}
