import { Prisma } from "@prisma/client";

function normalize(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Prisma.Decimal) return value.toNumber();
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return value;
}

/**
 * Compares a record as it stood (`before`) against the subset of fields an
 * update call is actually changing (`patch` -- a key missing or `undefined`
 * means "not part of this edit," distinct from `null` which means "clear
 * it"), for exactly the `fields` this entity's audit trail cares about.
 * Returns `null` when none of them actually changed, so an edit that only
 * touches an untracked field (notes, description, ...) doesn't produce a
 * no-op audit event. Shared by company/contact/lead/dealService's
 * "broaden audit coverage" update paths (FIG-600) so each doesn't
 * reimplement the same before/after comparison.
 */
export function diffAuditedFields(
  before: object,
  patch: object,
  fields: readonly string[],
): { previousValue: Prisma.InputJsonValue; newValue: Prisma.InputJsonValue } | null {
  const b = before as Record<string, unknown>;
  const p = patch as Record<string, unknown>;
  const previousValue: Record<string, unknown> = {};
  const newValue: Record<string, unknown> = {};
  let changed = false;

  for (const field of fields) {
    if (!(field in p) || p[field] === undefined) continue;
    const previous = normalize(b[field]);
    const next = normalize(p[field]);
    if (previous !== next) {
      previousValue[field] = previous;
      newValue[field] = next;
      changed = true;
    }
  }

  return changed
    ? {
        previousValue: previousValue as Prisma.InputJsonValue,
        newValue: newValue as Prisma.InputJsonValue,
      }
    : null;
}
