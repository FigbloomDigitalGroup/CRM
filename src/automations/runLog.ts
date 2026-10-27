import { Prisma } from "@prisma/client";
import { adminDb } from "../db/adminClient";
import { type OrgScopedClient, withOrgContext } from "../db/orgScopedClient";
import { type Audience, AUDIENCES, type RuleKey, findRule } from "./catalogue";

/**
 * The automation run log and the rule state the rules read (FIG-1059, B4.02).
 *
 * Every effect a rule has is recorded: which rule, which record, what happened. A partial unique index
 * (`automation_runs_one_effect_key`) allows one APPLIED run per rule and trigger, so "one effect per trigger"
 * holds even if two workers run at once. A trigger is a stable string that names the thing that fired the
 * rule ("lead:<id>", "proposal:<id>:<date>"), so a repeat run finds its own earlier run and does nothing.
 */

export type RunStatus = "APPLIED" | "SKIPPED" | "FAILED";

export interface RunTarget {
  organizationId: string;
  ruleKey: RuleKey;
  triggerKey: string;
  entityType?: string;
  entityId?: string;
}

export interface RunResult {
  /** What happened, in a sentence a person can read in the log. Never an amount or a payment number. */
  result: string;
  detail?: Prisma.InputJsonValue;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * Runs `effect` at most once for this rule and trigger. The run is claimed first (APPLIED, result "pending"),
 * so a second caller sees the claim and does nothing. If the effect throws, the claim is released and a FAILED
 * row is written, so the next sweep can try again; the error never reaches the caller (a rule that fails
 * must not break the request or the job that raised it).
 */
export async function runRuleOnce(
  target: RunTarget,
  effect: () => Promise<RunResult | null>,
): Promise<"APPLIED" | "DUPLICATE" | "SKIPPED" | "FAILED"> {
  const { organizationId } = target;
  let claimId: string;
  try {
    const claim = await withOrgContext(organizationId, (tx) =>
      tx.automationRun.create({
        data: {
          organizationId,
          ruleKey: target.ruleKey,
          triggerKey: target.triggerKey,
          entityType: target.entityType,
          entityId: target.entityId,
          status: "APPLIED",
          result: "pending",
        },
      }),
    );
    claimId = claim.id;
  } catch (err) {
    if (isUniqueViolation(err)) return "DUPLICATE";
    throw err;
  }

  try {
    const done = await effect();
    if (done === null) {
      // Nothing to do after all: do not leave a claim that blocks a later, real run.
      await withOrgContext(organizationId, (tx) => tx.automationRun.delete({ where: { id: claimId } }));
      return "SKIPPED";
    }
    await withOrgContext(organizationId, (tx) =>
      tx.automationRun.update({ where: { id: claimId }, data: { result: done.result, detail: done.detail } }),
    );
    return "APPLIED";
  } catch (err) {
    await withOrgContext(organizationId, async (tx) => {
      await tx.automationRun.delete({ where: { id: claimId } });
      await tx.automationRun.create({
        data: {
          organizationId,
          ruleKey: target.ruleKey,
          triggerKey: target.triggerKey,
          entityType: target.entityType,
          entityId: target.entityId,
          status: "FAILED",
          result: err instanceof Error ? err.message.slice(0, 300) : "The rule failed.",
        },
      });
    }).catch(() => undefined);
    return "FAILED";
  }
}

/** Records one outcome that is not worth claiming first (a one-shot decision such as "left unassigned"). Never throws. */
export async function logRuleRun(target: RunTarget, status: RunStatus, entry: RunResult): Promise<void> {
  await withOrgContext(target.organizationId, (tx) =>
    tx.automationRun.create({
      data: {
        organizationId: target.organizationId,
        ruleKey: target.ruleKey,
        triggerKey: target.triggerKey,
        entityType: target.entityType,
        entityId: target.entityId,
        status,
        result: entry.result,
        detail: entry.detail,
      },
    }),
  ).catch((err) => {
    // A duplicate APPLIED run for the same trigger is the one-effect guarantee doing its job.
    if (!isUniqueViolation(err)) throw err;
  });
}

// ---------------------------------------------------------------------------
// Rule state
// ---------------------------------------------------------------------------

export interface OwnRuleState {
  enabled: boolean;
  params: Record<string, number | string>;
  audience: Audience | null;
}

function parseConfig(value: unknown): { params: Record<string, number | string>; audience: Audience | null } {
  const config = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const rawParams = config.params && typeof config.params === "object" && !Array.isArray(config.params) ? (config.params as Record<string, unknown>) : {};
  const params: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(rawParams)) if (typeof v === "number" || typeof v === "string") params[k] = v;
  const audience = typeof config.audience === "string" && (AUDIENCES as readonly string[]).includes(config.audience) ? (config.audience as Audience) : null;
  return { params, audience };
}

/** The switch, thresholds and audience for a rule that keeps its own state in `automation_rules`, with catalogue defaults filled in. */
export async function readOwnRule(db: Pick<OrgScopedClient, "automationRule">, organizationId: string, ruleKey: RuleKey): Promise<OwnRuleState> {
  const def = findRule(ruleKey)!;
  const row = await db.automationRule.findUnique({ where: { organizationId_ruleKey: { organizationId, ruleKey } } });
  const stored = parseConfig(row?.config);
  const params: Record<string, number | string> = {};
  for (const p of def.params) params[p.key] = stored.params[p.key] ?? p.default;
  return { enabled: row ? row.enabled : def.defaultEnabled, params, audience: stored.audience ?? def.defaultAudience };
}

export function loadOwnRule(organizationId: string, ruleKey: RuleKey): Promise<OwnRuleState> {
  return withOrgContext(organizationId, (tx) => readOwnRule(tx, organizationId, ruleKey));
}

/** Who a notification goes to: the owner, and Management too when the rule's audience says so. Duplicates are removed. */
export async function expandAudience(
  organizationId: string,
  ownerMembershipId: string | null,
  audience: Audience | null,
): Promise<string[]> {
  const ids = new Set<string>();
  if (ownerMembershipId) ids.add(ownerMembershipId);
  if (audience === "OWNER_AND_MANAGEMENT") {
    const managers = await adminDb.membership.findMany({
      where: { organizationId, status: "ACTIVE", role: { key: "MANAGEMENT" } },
      select: { id: true },
    });
    for (const m of managers) ids.add(m.id);
  }
  return [...ids];
}
