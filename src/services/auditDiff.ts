import { Prisma } from "@prisma/client";

function normalize(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Prisma.Decimal) return value.toNumber();
  return value;
}

function isNumericString(value: unknown): value is string {
  return (
    typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))
  );
}

/** Arrays/objects (e.g. Organization.workingDays, FIG-604) compare by content, not reference -- `normalize` already returns the array itself for storage, so two equal-content arrays from different sources (DB row vs. patch) would otherwise always look "changed." */
function compareKey(normalized: unknown): unknown {
  return typeof normalized === "object" && normalized !== null
    ? JSON.stringify(normalized)
    : normalized;
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
    let previous = normalize(b[field]);
    let next = normalize(p[field]);
    // A Decimal-backed field's DB value normalizes to a `number` above,
    // but a patch often sends it as a plain string before Prisma coerces
    // it at write time (e.g. Deal.value: "5000") -- coerce the string side
    // to match, but ONLY when paired against an actual number. Applying
    // this unconditionally to any numeric-looking string would silently
    // turn something like a phone number ("+254700000000") into a JS
    // number on both sides of a same-type string/string comparison, which
    // was a real bug (FIG-604) once a free-text field was audited.
    if (typeof previous === "number" && isNumericString(next)) {
      next = Number(next);
    } else if (typeof next === "number" && isNumericString(previous)) {
      previous = Number(previous);
    }
    if (compareKey(previous) !== compareKey(next)) {
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
