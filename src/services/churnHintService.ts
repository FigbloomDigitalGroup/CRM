import { Prisma } from "@prisma/client";
import type { AuthContext } from "../auth/context";
import { hasPermission, requirePermission } from "../auth/context";
import { NotFoundError, ValidationError } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import {
  evaluateCustomer,
  levelFor,
  scoreOf,
  signalsHash,
  viewForViewer,
  type CustomerFacts,
  type Reason,
} from "../lib/churnSignals";
import { cleanRecordText } from "../assistant/context";
import { recordAuditEvent } from "../repositories/auditEvents";
import { CONFIG_KEY, DEFAULT_CONFIG } from "./assistantService";
import { requireFeature } from "./featureService";
import { LIFECYCLE_KEYS } from "./lifecycleService";
import { loadRenewalSettings } from "./renewalSettings";

/**
 * Churn hints from the assistant (FIG-1190, B7.08). A gentle, explainable nudge to the owner of a customer that looks like it may leave:
 * what was seen, in words, never a score alone. The rules are in `src/lib/churnSignals.ts`.
 *
 * It runs inside the assistant's walls (docs/ASSISTANT.md):
 *  - the organisation switch (`assistant.enabled`) and the "churn" option (`retention` in the assistant settings, off by default);
 *  - `ai.use` to read or answer a hint, and V2;
 *  - a hint only ever proposes: it can be dismissed or rated, and nothing else. It moves no stage, sets no discount, changes no owner
 *    and sends nothing (hard rule 9). Dismissing, rating and the nightly refresh are audited.
 *
 * The generator is rules-based and calls no model. That is deliberate: a hint must be explainable reason by reason, and the text a
 * viewer sees must be built only from reasons that viewer may see, so it is composed per viewer at read time.
 *
 * Masking: the facts are dates and counts. No deal value, margin, cost, quote amount, invoice or payment is read. Each reason names the
 * permission its data needs (`needs`); a viewer is shown only the reasons they may see, and level and sentence are recomputed from
 * those. Who sees a hint at all: the customer's owner, and anyone with `reporting.view.all` (Management).
 */

const HINT = "ai.use";
const DAY = 24 * 60 * 60_000;
const CUSTOMER_STATES = [LIFECYCLE_KEYS.CUSTOMER, LIFECYCLE_KEYS.ACTIVE, LIFECYCLE_KEYS.DORMANT, LIFECYCLE_KEYS.RENEWAL];

/** JSON with sorted keys: Postgres stores jsonb with its own key order, so a plain stringify of stored and fresh values would differ. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : v,
  );
}

async function churnOptionOn(organizationId: string): Promise<boolean> {
  const row = await adminDb.organizationSetting.findUnique({ where: { organizationId_key: { organizationId, key: CONFIG_KEY } } });
  const v = (row?.value ?? {}) as { retention?: boolean };
  return v.retention ?? DEFAULT_CONFIG.retention;
}

/** The switches that must all be on; a refusal says which. */
export async function churnHintsState(organizationId: string): Promise<{ enabled: boolean; reason: string | null }> {
  const { isFeatureEnabled } = await import("./featureService");
  if (!(await isFeatureEnabled(organizationId, "assistant.enabled"))) return { enabled: false, reason: "The assistant is switched off for this organisation." };
  if (!(await churnOptionOn(organizationId))) return { enabled: false, reason: "Churn hints are switched off in Settings, AI assistant." };
  return { enabled: true, reason: null };
}

// ---------------------------------------------------------------------------
// Generating
// ---------------------------------------------------------------------------

interface ActivityRow {
  company_id: string;
  last_at: Date | null;
  last30: bigint;
  prior30: bigint;
}

/** One pass over the organisation's customers: reasons in, hints stored. Safe to repeat; a dismissed hint stays dismissed until something new happens. */
export async function refreshChurnHints(organizationId: string, now = new Date()) {
  const state = await churnHintsState(organizationId);
  if (!state.enabled) return { checked: 0, created: 0, updated: 0, resolved: 0, skipped: state.reason };

  const settings = await loadRenewalSettings(organizationId);
  const companies = await adminDb.company.findMany({
    where: { organizationId, archivedAt: null, mergedIntoId: null, ownerMembershipId: { not: null }, lifecycleState: { key: { in: CUSTOMER_STATES } } },
    select: { id: true, ownerMembershipId: true, createdAt: true, lifecycleState: { select: { key: true } } },
  });
  if (companies.length === 0) return { checked: 0, created: 0, updated: 0, resolved: await resolveGone(organizationId, [], now), skipped: null };
  const ids = companies.map((c) => c.id);

  const last30From = new Date(now.getTime() - 30 * DAY);
  const prior30From = new Date(now.getTime() - 60 * DAY);
  const [activity, services, open] = await Promise.all([
    adminDb.$queryRaw<ActivityRow[]>(Prisma.sql`
      SELECT c.id AS company_id,
             MAX(a.occurred_at) AS last_at,
             COUNT(a.id) FILTER (WHERE a.occurred_at >= ${last30From}) AS last30,
             COUNT(a.id) FILTER (WHERE a.occurred_at >= ${prior30From} AND a.occurred_at < ${last30From}) AS prior30
      FROM companies c
      LEFT JOIN activities a ON a.organization_id = c.organization_id AND a.occurred_at <= ${now}
        AND (a.company_id = c.id OR a.contact_id IN (SELECT ct.id FROM contacts ct WHERE ct.organization_id = c.organization_id AND ct.company_id = c.id))
      WHERE c.organization_id = ${organizationId} AND c.id IN (${Prisma.join(ids)})
      GROUP BY c.id`),
    adminDb.recurringService.findMany({
      where: { organizationId, companyId: { in: ids } },
      select: { companyId: true, startsOn: true, renewsOn: true, cancelledAt: true, stateOverride: true },
    }),
    adminDb.churnHint.findMany({ where: { organizationId, status: { in: ["OPEN", "DISMISSED"] } }, orderBy: { generatedAt: "desc" } }),
  ]);
  const activityBy = new Map(activity.map((a) => [a.company_id, a]));
  const servicesBy = new Map<string, typeof services>();
  for (const s of services) servicesBy.set(s.companyId, [...(servicesBy.get(s.companyId) ?? []), s]);
  const openBy = new Map(open.filter((h) => h.status === "OPEN").map((h) => [h.companyId, h]));
  const lastDismissed = new Map<string, (typeof open)[number]>();
  for (const h of open) if (h.status === "DISMISSED" && !lastDismissed.has(h.companyId)) lastDismissed.set(h.companyId, h);

  let created = 0;
  let updated = 0;
  const keep = new Set<string>();
  for (const company of companies) {
    const a = activityBy.get(company.id);
    const facts: CustomerFacts = {
      createdAt: company.createdAt,
      lastActivityAt: a?.last_at ?? null,
      activitiesLast30: Number(a?.last30 ?? 0),
      activitiesPrior30: Number(a?.prior30 ?? 0),
      dormant: company.lifecycleState?.key === LIFECYCLE_KEYS.DORMANT,
      services: servicesBy.get(company.id) ?? [],
    };
    const reasons = evaluateCustomer(facts, now, settings);
    const score = scoreOf(reasons);
    if (!levelFor(score)) continue; // clears below (resolveGone)
    keep.add(company.id);
    const hash = signalsHash(reasons);
    const existing = openBy.get(company.id);
    if (existing) {
      if (existing.signalsHash !== hash || existing.ownerMembershipId !== company.ownerMembershipId || canonical(existing.signals) !== canonical(reasons)) {
        await adminDb.churnHint.update({ where: { id: existing.id }, data: { signals: reasons as unknown as Prisma.InputJsonValue, signalsHash: hash, score, ownerMembershipId: company.ownerMembershipId, updatedAt: now } });
        updated++;
      }
      continue;
    }
    // A hint someone dismissed does not come back for the same kinds of trouble.
    if (lastDismissed.get(company.id)?.signalsHash === hash) continue;
    await adminDb.churnHint.create({
      data: { organizationId, companyId: company.id, ownerMembershipId: company.ownerMembershipId, score, signals: reasons as unknown as Prisma.InputJsonValue, signalsHash: hash, generatedAt: now, updatedAt: now },
    });
    created++;
  }
  const resolved = await resolveGone(organizationId, [...keep], now);
  if (created + updated + resolved > 0) {
    await recordAuditEvent({ organizationId, action: "churn_hints.refreshed", entityType: "ChurnHint", metadata: { checked: companies.length, created, updated, resolved } });
  }
  return { checked: companies.length, created, updated, resolved, skipped: null };
}

/** Open hints whose customer no longer shows enough signals (or is no longer an owned, live customer) are closed, not deleted. */
async function resolveGone(organizationId: string, keepCompanyIds: string[], now: Date): Promise<number> {
  const result = await adminDb.churnHint.updateMany({
    where: { organizationId, status: "OPEN", ...(keepCompanyIds.length ? { companyId: { notIn: keepCompanyIds } } : {}) },
    data: { status: "RESOLVED", resolvedAt: now, updatedAt: now },
  });
  return result.count;
}

// ---------------------------------------------------------------------------
// Reading and answering
// ---------------------------------------------------------------------------

export interface ChurnHintView {
  id: string;
  status: string;
  level: "low" | "medium" | "high";
  summary: string;
  reasons: { signal: string; text: string; weight: number }[];
  company: { id: string; name: string };
  owner: { membershipId: string; name: string } | null;
  generatedAt: Date;
  dismissedAt: Date | null;
  dismissReason: string | null;
  feedback: string | null;
  mine: boolean;
}

function canSee(ctx: AuthContext, ownerMembershipId: string | null): boolean {
  return ownerMembershipId === ctx.membershipId || hasPermission(ctx, "reporting.view.all");
}

type HintRow = Prisma.ChurnHintGetPayload<object>;

async function present(ctx: AuthContext, rows: HintRow[]): Promise<ChurnHintView[]> {
  if (rows.length === 0) return [];
  const [companies, owners] = await Promise.all([
    adminDb.company.findMany({ where: { organizationId: ctx.organizationId, id: { in: rows.map((r) => r.companyId) } }, select: { id: true, name: true } }),
    adminDb.membership.findMany({
      where: { organizationId: ctx.organizationId, id: { in: rows.flatMap((r) => (r.ownerMembershipId ? [r.ownerMembershipId] : [])) } },
      select: { id: true, user: { select: { name: true } } },
    }),
  ]);
  const companyName = new Map(companies.map((c) => [c.id, c.name]));
  const ownerName = new Map(owners.map((o) => [o.id, o.user.name]));
  const out: ChurnHintView[] = [];
  for (const row of rows) {
    if (!canSee(ctx, row.ownerMembershipId)) continue;
    const seen = viewForViewer(row.signals as unknown as Reason[], (k) => hasPermission(ctx, k));
    if (!seen) continue; // nothing this person may see is left
    const name = companyName.get(row.companyId);
    if (name === undefined) continue; // the person cannot open companies at all, or it is gone
    out.push({
      id: row.id,
      status: row.status,
      level: seen.level,
      summary: cleanRecordText(seen.summary, { redactMoney: !hasPermission(ctx, "deals.view.value"), max: 400 }).text,
      reasons: seen.reasons,
      company: { id: row.companyId, name: cleanRecordText(name, { redactMoney: false, max: 200 }).text },
      owner: row.ownerMembershipId ? { membershipId: row.ownerMembershipId, name: ownerName.get(row.ownerMembershipId) ?? "" } : null,
      generatedAt: row.generatedAt,
      dismissedAt: row.dismissedAt,
      dismissReason: row.dismissReason,
      feedback: row.feedback,
      mine: row.ownerMembershipId === ctx.membershipId,
    });
  }
  const rank = { high: 0, medium: 1, low: 2 } as const;
  return out.sort((a, b) => rank[a.level] - rank[b.level] || b.generatedAt.getTime() - a.generatedAt.getTime());
}

export interface ListHintsQuery {
  status?: "OPEN" | "DISMISSED" | "RESOLVED";
  companyId?: string;
  mine?: boolean;
}

export async function listChurnHints(ctx: AuthContext, query: ListHintsQuery = {}) {
  requirePermission(ctx, HINT);
  await requireFeature(ctx.organizationId, "release.v2");
  const state = await churnHintsState(ctx.organizationId);
  if (!state.enabled) return { enabled: false as const, reason: state.reason, hints: [] as ChurnHintView[] };
  if (!hasPermission(ctx, "companies.view")) return { enabled: true as const, reason: null, hints: [] as ChurnHintView[] };
  const rows = await adminDb.churnHint.findMany({
    where: {
      organizationId: ctx.organizationId,
      status: query.status ?? "OPEN",
      ...(query.companyId ? { companyId: query.companyId } : {}),
      ...(query.mine || !hasPermission(ctx, "reporting.view.all") ? { ownerMembershipId: ctx.membershipId } : {}),
    },
    orderBy: { generatedAt: "desc" },
    take: 200,
  });
  return { enabled: true as const, reason: null, hints: await present(ctx, rows) };
}

/** Regenerates the organisation's hints now (the nightly job does the same). Needs the assistant and the churn option on. */
export async function refreshChurnHintsNow(ctx: AuthContext) {
  requirePermission(ctx, HINT);
  await requireFeature(ctx.organizationId, "release.v2");
  const result = await refreshChurnHints(ctx.organizationId);
  if (result.skipped) throw new ValidationError(result.skipped);
  return result;
}

async function loadVisibleHint(ctx: AuthContext, hintId: string): Promise<HintRow> {
  requirePermission(ctx, HINT);
  const row = await adminDb.churnHint.findFirst({ where: { id: hintId, organizationId: ctx.organizationId } });
  // A hint the person may not see does not exist for them.
  if (!row || !canSee(ctx, row.ownerMembershipId) || !(await present(ctx, [row])).length) throw new NotFoundError("Churn hint", hintId);
  return row;
}

export async function dismissChurnHint(ctx: AuthContext, hintId: string, input: { reason?: string } = {}): Promise<ChurnHintView> {
  await requireFeature(ctx.organizationId, "release.v2");
  const state = await churnHintsState(ctx.organizationId);
  if (!state.enabled) throw new ValidationError(state.reason ?? "Churn hints are off.");
  const row = await loadVisibleHint(ctx, hintId);
  if (row.status !== "OPEN") throw new ValidationError("This hint is already closed.");
  const reason = input.reason ? cleanRecordText(input.reason, { redactMoney: true, max: 300 }).text || null : null;
  const updated = await adminDb.churnHint.update({
    where: { id: hintId },
    data: { status: "DISMISSED", dismissedAt: new Date(), dismissedByMembershipId: ctx.membershipId, dismissReason: reason, updatedAt: new Date() },
  });
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "churn_hint.dismissed",
    entityType: "ChurnHint",
    entityId: hintId,
    metadata: { companyId: row.companyId, hasReason: reason !== null },
  });
  return (await present(ctx, [updated]))[0]!;
}

export async function rateChurnHint(ctx: AuthContext, hintId: string, input: { value: "HELPFUL" | "NOT_HELPFUL"; note?: string }): Promise<ChurnHintView> {
  await requireFeature(ctx.organizationId, "release.v2");
  const row = await loadVisibleHint(ctx, hintId);
  const note = input.note ? cleanRecordText(input.note, { redactMoney: true, max: 500 }).text || null : null;
  const updated = await adminDb.churnHint.update({
    where: { id: hintId },
    data: { feedback: input.value, feedbackNote: note, feedbackByMembershipId: ctx.membershipId, feedbackAt: new Date(), updatedAt: new Date() },
  });
  await recordAuditEvent({
    organizationId: ctx.organizationId,
    actorMembershipId: ctx.membershipId,
    action: "churn_hint.feedback",
    entityType: "ChurnHint",
    entityId: hintId,
    metadata: { companyId: row.companyId, value: input.value },
  });
  return (await present(ctx, [updated]))[0]!;
}
