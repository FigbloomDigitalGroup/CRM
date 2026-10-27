import type { AuthContext } from "./context";
import { hasPermission } from "./context";

/**
 * The one place deal value and margin masking is decided (FIG-1036, B2.07).
 * Surfaces call these helpers; none of them re-implements the rule. See
 * docs/MASKING.md for the rule, the list of surfaces, and how to add one.
 *
 *   value   : visible with `deals.view.value` (Management, Finance), or to the
 *             owner of the deal ("the value they quoted themselves"). Anyone
 *             else gets `null` and `masked: true`, never a rounded or partial figure.
 *   margin  : visible only with `deals.margin` (Management). Not even the owner.
 *
 * Masking is applied where the data leaves a repository or service (a DTO
 * mapper or a service return), not inside each route, so a new route cannot
 * forget it.
 */

export function canSeeDealValue(ctx: AuthContext, deal: { ownerMembershipId: string | null }): boolean {
  return hasPermission(ctx, "deals.view.value") || deal.ownerMembershipId === ctx.membershipId;
}

/** Margin is Management-only; ownership does not grant it. */
export function canSeeMargin(ctx: AuthContext): boolean {
  return hasPermission(ctx, "deals.margin");
}

/** Whether the caller may see value figures aggregated over deals they do not individually own (totals, sums, averages). */
export function canSeeAggregateValue(ctx: AuthContext): boolean {
  return hasPermission(ctx, "deals.view.value");
}

type DealLike = { ownerMembershipId: string | null; value?: unknown };

/** A deal with its value (and margin, when it carries one) removed for callers who may not see them. */
export function maskDeal<T extends DealLike>(
  ctx: AuthContext,
  deal: T,
): T & { valueMasked: boolean } {
  const withMargin = deal as T & { margin?: unknown };
  const showValue = canSeeDealValue(ctx, deal);
  const hideMargin = "margin" in withMargin && !canSeeMargin(ctx);
  if (showValue && !hideMargin) return { ...deal, valueMasked: false };
  return {
    ...deal,
    ...(showValue ? {} : { value: null }),
    ...(hideMargin ? { margin: null, marginMasked: true } : {}),
    valueMasked: !showValue,
  };
}

/** A proposal's or quote's amount follows the value of the deal it belongs to. */
export function maskAmount<T extends { amount?: unknown }>(
  ctx: AuthContext,
  deal: { ownerMembershipId: string | null },
  row: T,
): T & { amountMasked: boolean } {
  if (canSeeDealValue(ctx, deal)) return { ...row, amountMasked: false };
  return { ...row, amount: null, amountMasked: true };
}

/**
 * A recurring service's value follows the same rule as a deal's: Management and Finance see it, and so does the
 * person who owns the service.
 */
export function maskServiceValue<T extends { ownerMembershipId: string | null; value?: unknown }>(
  ctx: AuthContext,
  row: T,
): T & { valueMasked: boolean } {
  if (canSeeDealValue(ctx, row)) return { ...row, valueMasked: false };
  return { ...row, value: null, valueMasked: true };
}

/** Keys that carry money anywhere in a stored snapshot (audit before/after values). */
const VALUE_KEYS = new Set(["value", "amount", "total", "subtotal", "price", "discount"]);
const MARGIN_KEYS = new Set(["margin", "cost", "costPrice"]);

/** Entity types whose audit snapshots can hold a deal-derived money field. */
const MONEY_ENTITIES = new Set(["Deal", "ProposalReference", "Quote", "QuoteLine", "Payment", "RecurringService"]);

/** Entity types that hold payments; their audit snapshots are for Finance and Management only (finance.view.payments). */
export const PAYMENT_ENTITIES: ReadonlySet<string> = new Set(["Invoice", "PaymentRecord", "DealPaymentNote"]);

/**
 * Removes money fields from an audit snapshot for callers who may not see the
 * deal's value. The record stays (that a value changed is still evidence); the
 * figure does not. Works on the JSON the audit table stores.
 */
export function maskAuditSnapshot(
  ctx: AuthContext,
  entityType: string,
  snapshot: unknown,
  deal: { ownerMembershipId: string | null } | null = null,
): unknown {
  if (!MONEY_ENTITIES.has(entityType) || snapshot === null || typeof snapshot !== "object") return snapshot;
  const showValue = deal ? canSeeDealValue(ctx, deal) : hasPermission(ctx, "deals.view.value");
  const showMargin = canSeeMargin(ctx);
  if (showValue && showMargin) return snapshot;
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      return Object.fromEntries(
        Object.entries(node as Record<string, unknown>).map(([key, v]) => {
          if (!showValue && VALUE_KEYS.has(key)) return [key, null];
          if (!showMargin && MARGIN_KEYS.has(key)) return [key, null];
          return [key, walk(v)];
        }),
      );
    }
    return node;
  };
  return walk(snapshot);
}

/**
 * Money written into free text by the system ("Deal worth KES 1,200,000 won").
 * Roles that may not see values get a placeholder instead. User-typed notes are
 * not rewritten; only text the system composes goes through this.
 */
const MONEY_TEXT =
  /(?:\b(?:KES|KSH|KSHS|USD|EUR|GBP|UGX|TZS|RWF)\b\.?\s*|[$€£]\s?)\d[\d,]*(?:\.\d+)?(?:\s?(?:k|m|million|bn))?|\b\d[\d,]*(?:\.\d+)?\s?(?:KES|KSH|KSHS|USD|EUR|GBP|UGX|TZS|RWF)\b/gi;

export const VALUE_HIDDEN_TEXT = "[value hidden]";

export function redactMoneyText(text: string): string {
  return text.replace(MONEY_TEXT, VALUE_HIDDEN_TEXT);
}

/** Redacts system-composed text unless the viewer may see values. */
export function textForViewer(ctx: Pick<AuthContext, "permissionKeys">, text: string): string {
  return ctx.permissionKeys.includes("deals.view.value") ? text : redactMoneyText(text);
}
