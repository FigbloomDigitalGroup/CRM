import type { Prisma } from "@prisma/client";
import { type Audience, AUDIENCES, type ParamDef, RULES, RULE_KEYS, type RuleDef, type RuleKey, findRule } from "../automations/catalogue";
import { type OwnRuleState, loadOwnRule } from "../automations/runLog";
import type { AuthContext } from "../auth/context";
import { hasPermission, requirePermission } from "../auth/context";
import { PAYMENT_ENTITIES } from "../auth/masking";
import { NotFoundError, ValidationError, type ValidationIssue } from "../auth/errors";
import { adminDb } from "../db/adminClient";
import { parseDateOnly } from "../lib/inputParsing";
import { buildPage, resolvePaging, type PageRequest } from "../lib/pagination";
import { WEBSITE_LEAD_ASSIGNMENT_MODE_SETTING_KEY } from "../repositories/leadIngestion";
import { recordAuditEvent } from "../repositories/auditEvents";
import { withOrgContext } from "../db/orgScopedClient";
import { loadDormancyDays, updateReportSettings } from "./customerReportService";
import { loadStageRules } from "./dealRuleService";
import { setWebsiteAssignmentSetting } from "./integrationService";
import { loadReminderSettings, updateReminderSettings } from "./reminderService";

/**
 * Settings > Automations (FIG-1059, B4.02, screen S5): the visible rules and their run log. Management only
 * (`configuration.manage`).
 *
 * The catalogue is code (`src/automations/catalogue.ts`). Four of the rules are the reminders from FIG-795 and the
 * dormant and invoice rules around them; their switch and thresholds already live in the reminder, dormancy and
 * assignment settings, and this service reads and writes them there, so the older settings endpoints and this
 * screen can never disagree. The others keep their state in `automation_rules`. Audiences always live there.
 */
const PERMISSION = "configuration.manage";

export interface RuleView {
  key: RuleKey;
  name: string;
  description: string;
  trigger: string;
  effect: string;
  actions: readonly string[];
  enabled: boolean;
  params: (ParamDef & { value: number | string })[];
  audience: Audience | null;
  audiences: readonly Audience[];
  origin: string;
  /** What the rule did in the last seven days, and when it last did anything. */
  recent: { applied: number; skipped: number; failed: number; lastRunAt: Date | null };
}

async function stateFor(organizationId: string, rule: RuleDef): Promise<{ enabled: boolean; values: Record<string, number | string>; audience: Audience | null }> {
  const own: OwnRuleState = await loadOwnRule(organizationId, rule.key);
  const values: Record<string, number | string> = { ...own.params };
  let enabled = own.enabled;
  switch (rule.key) {
    case RULE_KEYS.PROPOSAL_FOLLOW_UP: {
      const s = (await loadReminderSettings(organizationId)).proposalFollowUp;
      enabled = s.enabled;
      values.days = s.days;
      break;
    }
    case RULE_KEYS.RENEWAL_REMINDER: {
      const s = (await loadReminderSettings(organizationId)).renewal;
      enabled = s.enabled;
      values.daysAhead = s.daysAhead;
      break;
    }
    case RULE_KEYS.DORMANT_CUSTOMER_FLAG:
      enabled = (await loadReminderSettings(organizationId)).dormant.enabled;
      values.days = await loadDormancyDays(organizationId);
      break;
    case RULE_KEYS.OVERDUE_INVOICE_NOTICE:
      enabled = (await loadReminderSettings(organizationId)).overdueInvoices.enabled;
      break;
    case RULE_KEYS.WEBSITE_LEAD_ASSIGNMENT: {
      const row = await adminDb.organizationSetting.findUnique({ where: { organizationId_key: { organizationId, key: WEBSITE_LEAD_ASSIGNMENT_MODE_SETTING_KEY } } });
      values.fallback = (row?.value as { mode?: string } | null)?.mode === "UNASSIGNED" ? "UNASSIGNED" : "ROUND_ROBIN";
      break;
    }
    case RULE_KEYS.STALLED_DEAL_ALERT:
      values.stalledAfterDays = (await loadStageRules(organizationId)).defaultDays;
      break;
    default:
      break;
  }
  return { enabled, values, audience: own.audience };
}

function toView(rule: RuleDef, state: Awaited<ReturnType<typeof stateFor>>, recent: RuleView["recent"]): RuleView {
  return {
    key: rule.key,
    name: rule.name,
    description: rule.description,
    trigger: rule.trigger,
    effect: rule.effect,
    actions: rule.actions,
    enabled: state.enabled,
    params: rule.params.map((p) => ({ ...p, value: state.values[p.key] ?? p.default })),
    audience: state.audience,
    audiences: rule.audiences,
    origin: rule.origin,
    recent,
  };
}

async function recentRuns(organizationId: string, now = new Date()): Promise<Map<string, RuleView["recent"]>> {
  const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const rows = await withOrgContext(organizationId, (tx) =>
    tx.automationRun.groupBy({
      by: ["ruleKey", "status"],
      where: { organizationId, createdAt: { gte: since } },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
  );
  const out = new Map<string, RuleView["recent"]>();
  for (const r of rows) {
    const cur = out.get(r.ruleKey) ?? { applied: 0, skipped: 0, failed: 0, lastRunAt: null };
    if (r.status === "APPLIED") cur.applied += r._count._all;
    else if (r.status === "SKIPPED") cur.skipped += r._count._all;
    else cur.failed += r._count._all;
    const at = r._max.createdAt;
    if (at && (!cur.lastRunAt || at > cur.lastRunAt)) cur.lastRunAt = at;
    out.set(r.ruleKey, cur);
  }
  return out;
}

export async function listAutomationRules(ctx: AuthContext): Promise<{ items: RuleView[]; boundary: string }> {
  requirePermission(ctx, PERMISSION);
  const recent = await recentRuns(ctx.organizationId);
  const items = await Promise.all(
    RULES.map(async (rule) => toView(rule, await stateFor(ctx.organizationId, rule), recent.get(rule.key) ?? { applied: 0, skipped: 0, failed: 0, lastRunAt: null })),
  );
  return {
    items,
    boundary: "Automations assign, remind and draft. They never move a deal stage, set a discount, approve anything or change an owner outside an assignment rule.",
  };
}

export async function getAutomationRule(ctx: AuthContext, key: string): Promise<RuleView> {
  requirePermission(ctx, PERMISSION);
  const rule = findRule(key);
  if (!rule) throw new NotFoundError("AutomationRule", key);
  const recent = await recentRuns(ctx.organizationId);
  return toView(rule, await stateFor(ctx.organizationId, rule), recent.get(rule.key) ?? { applied: 0, skipped: 0, failed: 0, lastRunAt: null });
}

export interface AutomationRulePatch {
  enabled?: boolean;
  params?: Record<string, number | string>;
  audience?: Audience;
}

function validate(rule: RuleDef, patch: AutomationRulePatch): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (patch.enabled !== undefined && typeof patch.enabled !== "boolean") issues.push({ path: "enabled", message: "True or false." });
  if (patch.audience !== undefined) {
    if (rule.audiences.length === 0) issues.push({ path: "audience", message: `${rule.name} does not notify people, so it has no audience.` });
    else if (!(AUDIENCES as readonly string[]).includes(patch.audience) || !rule.audiences.includes(patch.audience)) {
      issues.push({ path: "audience", message: `Choose one of: ${rule.audiences.join(", ")}.` });
    }
  }
  for (const [key, value] of Object.entries(patch.params ?? {})) {
    const def = rule.params.find((p) => p.key === key);
    if (!def) {
      issues.push({ path: `params.${key}`, message: `${rule.name} has no setting called "${key}".` });
      continue;
    }
    if (def.readOnly) {
      issues.push({ path: `params.${key}`, message: def.note ?? "This number is changed where it lives." });
      continue;
    }
    if (def.unit === "choice") {
      if (typeof value !== "string" || !def.options?.includes(value)) issues.push({ path: `params.${key}`, message: `Choose one of: ${def.options?.join(", ")}.` });
    } else if (typeof value !== "number" || !Number.isInteger(value) || value < (def.min ?? 1) || value > (def.max ?? 365)) {
      issues.push({ path: `params.${key}`, message: `A whole number of ${def.unit} from ${def.min ?? 1} to ${def.max ?? 365}.` });
    }
  }
  return issues;
}

/** Switch a rule on or off, change its thresholds or its audience. Audited with the before and after. */
export async function updateAutomationRule(ctx: AuthContext, key: string, patch: AutomationRulePatch): Promise<RuleView> {
  requirePermission(ctx, PERMISSION);
  const rule = findRule(key);
  if (!rule) throw new NotFoundError("AutomationRule", key);
  const issues = validate(rule, patch);
  if (issues.length > 0) throw new ValidationError("This change is not valid.", issues);

  const before = await stateFor(ctx.organizationId, rule);
  const params = patch.params ?? {};
  const orgId = ctx.organizationId;

  // Rules whose state lives in an existing setting write it there, so the older endpoints stay in step.
  switch (rule.key) {
    case RULE_KEYS.PROPOSAL_FOLLOW_UP:
      await updateReminderSettings(ctx, { proposalFollowUp: { enabled: patch.enabled, days: params.days as number | undefined } });
      break;
    case RULE_KEYS.RENEWAL_REMINDER:
      await updateReminderSettings(ctx, { renewal: { enabled: patch.enabled, daysAhead: params.daysAhead as number | undefined } });
      break;
    case RULE_KEYS.DORMANT_CUSTOMER_FLAG:
      if (patch.enabled !== undefined) await updateReminderSettings(ctx, { dormant: { enabled: patch.enabled } });
      if (params.days !== undefined) await updateReportSettings(ctx, { dormancyDays: params.days as number });
      break;
    case RULE_KEYS.OVERDUE_INVOICE_NOTICE:
      if (patch.enabled !== undefined) await updateReminderSettings(ctx, { overdueInvoices: { enabled: patch.enabled } });
      break;
    default:
      break;
  }
  if (rule.key === RULE_KEYS.WEBSITE_LEAD_ASSIGNMENT && params.fallback !== undefined) {
    await setWebsiteAssignmentSetting(ctx, params.fallback as "ROUND_ROBIN" | "UNASSIGNED");
  }

  // The rules that keep their own state, and every rule's audience, live in automation_rules.
  const ownsEnabled = !([RULE_KEYS.PROPOSAL_FOLLOW_UP, RULE_KEYS.RENEWAL_REMINDER, RULE_KEYS.DORMANT_CUSTOMER_FLAG, RULE_KEYS.OVERDUE_INVOICE_NOTICE] as RuleKey[]).includes(rule.key);
  const ownParams = ownsEnabled && ![RULE_KEYS.WEBSITE_LEAD_ASSIGNMENT, RULE_KEYS.STALLED_DEAL_ALERT].includes(rule.key as never);
  await withOrgContext(orgId, async (tx) => {
    const row = await tx.automationRule.findUnique({ where: { organizationId_ruleKey: { organizationId: orgId, ruleKey: rule.key } } });
    const config = (row?.config && typeof row.config === "object" && !Array.isArray(row.config) ? (row.config as Record<string, unknown>) : {}) as Record<string, unknown>;
    const storedParams = { ...((config.params as Record<string, unknown> | undefined) ?? {}) };
    if (ownParams) for (const [k, v] of Object.entries(params)) storedParams[k] = v;
    const nextConfig = { ...config, params: storedParams, ...(patch.audience !== undefined ? { audience: patch.audience } : {}) } as Prisma.InputJsonObject;
    const enabled = ownsEnabled ? (patch.enabled ?? row?.enabled ?? rule.defaultEnabled) : (patch.enabled ?? before.enabled);
    await tx.automationRule.upsert({
      where: { organizationId_ruleKey: { organizationId: orgId, ruleKey: rule.key } },
      update: { enabled, config: nextConfig, updatedByMembershipId: ctx.membershipId },
      create: { organizationId: orgId, ruleKey: rule.key, enabled, config: nextConfig, updatedByMembershipId: ctx.membershipId },
    });
  });

  const after = await stateFor(orgId, rule);
  await recordAuditEvent({
    organizationId: orgId,
    actorMembershipId: ctx.membershipId,
    action: "automation_rule.updated",
    entityType: "AutomationRule",
    entityId: rule.key,
    previousValue: { enabled: before.enabled, params: before.values, audience: before.audience } as Prisma.InputJsonValue,
    newValue: { enabled: after.enabled, params: after.values, audience: after.audience } as Prisma.InputJsonValue,
  });
  return getAutomationRule(ctx, rule.key);
}

export interface RunLogQuery {
  ruleKey?: string;
  status?: string;
  entityType?: string;
  entityId?: string;
  dateFrom?: string;
  dateTo?: string;
}

/** The run log: each run with its rule, the record it touched and what happened. Newest first, paged. */
export async function listAutomationRuns(ctx: AuthContext, query: RunLogQuery = {}, request: PageRequest = {}) {
  requirePermission(ctx, PERMISSION);
  if (query.ruleKey !== undefined && !findRule(query.ruleKey)) throw new ValidationError(`"${query.ruleKey}" is not an automation rule.`, [{ path: "ruleKey", message: `Use one of: ${RULES.map((r) => r.key).join(", ")}.` }]);
  if (query.status !== undefined && !["APPLIED", "SKIPPED", "FAILED"].includes(query.status)) throw new ValidationError("status must be APPLIED, SKIPPED or FAILED.", [{ path: "status", message: "APPLIED, SKIPPED or FAILED." }]);
  // Runs on invoices are payments information: only a reader who may see payments sees them.
  const hidePayments = !hasPermission(ctx, "finance.view.payments");
  if (hidePayments && query.ruleKey === RULE_KEYS.OVERDUE_INVOICE_NOTICE) {
    return buildPage([], 0, resolvePaging(request));
  }
  const where: Prisma.AutomationRunWhereInput = {
    organizationId: ctx.organizationId,
    ...(hidePayments ? { ruleKey: { not: RULE_KEYS.OVERDUE_INVOICE_NOTICE }, NOT: { entityType: { in: [...PAYMENT_ENTITIES] } } } : {}),
    ...(query.ruleKey ? { ruleKey: query.ruleKey } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.entityType ? { entityType: query.entityType } : {}),
    ...(query.entityId ? { entityId: query.entityId } : {}),
    ...(query.dateFrom || query.dateTo
      ? {
          createdAt: {
            ...(query.dateFrom ? { gte: parseDateOnly(query.dateFrom, "dateFrom") } : {}),
            ...(query.dateTo ? { lt: new Date(parseDateOnly(query.dateTo, "dateTo").getTime() + 24 * 60 * 60 * 1000) } : {}),
          },
        }
      : {}),
  };
  const paging = resolvePaging(request);
  const [rows, total] = await withOrgContext(ctx.organizationId, (tx) =>
    Promise.all([
      tx.automationRun.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: paging.skip, take: paging.take }),
      tx.automationRun.count({ where }),
    ]),
  );
  const items = rows.map((r) => ({
    id: r.id,
    at: r.createdAt,
    rule: { key: r.ruleKey, name: findRule(r.ruleKey)?.name ?? r.ruleKey },
    record: { type: r.entityType, id: r.entityId },
    status: r.status,
    result: r.result,
  }));
  return buildPage(items, total, paging);
}
