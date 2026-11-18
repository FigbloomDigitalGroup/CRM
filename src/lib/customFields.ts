import { z } from "zod";
import type { ValidationIssue } from "../auth/errors";

/**
 * Custom field values, validated against an organisation's definitions
 * (FIG-803, FIG-1030). Pure functions: the service loads the definitions and
 * the record, this module decides what a valid set of values looks like.
 */

export type CustomFieldType = "TEXT" | "NUMBER" | "DATE" | "SELECT" | "MULTISELECT" | "BOOLEAN";

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldDefinition {
  key: string;
  label: string;
  fieldType: CustomFieldType;
  options?: unknown;
  required: boolean;
  requiredOnQualify: boolean;
  section: "GENERAL" | "QUALIFICATION";
  serviceId: string | null;
  isActive: boolean;
}

export type FieldValue = string | number | boolean | string[];
export type FieldValues = Record<string, FieldValue>;

export const MAX_TEXT_LENGTH = 2000;
export const MAX_OPTIONS = 100;
export const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,49}$/;

export function optionsOf(def: Pick<FieldDefinition, "options">): FieldOption[] {
  if (!Array.isArray(def.options)) return [];
  return def.options.filter(
    (o): o is FieldOption => !!o && typeof (o as FieldOption).value === "string" && typeof (o as FieldOption).label === "string",
  );
}

const isoDate = z
  .string()
  .trim()
  .refine((s) => /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(s) && !Number.isNaN(Date.parse(s)), "Use a date such as 2026-11-30.")
  .transform((s) => s.slice(0, 10));

/** The zod schema for one field's value; an empty value means "no answer" and clears the field. */
export function schemaForField(def: FieldDefinition): z.ZodType<FieldValue | null> {
  const empty = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);
  let inner: z.ZodType<FieldValue>;
  switch (def.fieldType) {
    case "TEXT":
      inner = z.string().trim().max(MAX_TEXT_LENGTH, `At most ${MAX_TEXT_LENGTH} characters.`);
      break;
    case "NUMBER":
      inner = z
        .union([z.number(), z.string().trim().regex(/^-?\d+(\.\d+)?$/, "Enter a number.").transform(Number)])
        .refine((n) => Number.isFinite(n), "Enter a number.");
      break;
    case "DATE":
      inner = isoDate;
      break;
    case "BOOLEAN":
      inner = z.union([z.boolean(), z.enum(["true", "false"]).transform((s) => s === "true")]);
      break;
    case "SELECT": {
      const allowed = optionsOf(def).map((o) => o.value);
      inner = z.string().refine((s) => allowed.includes(s), `Choose one of: ${allowed.join(", ") || "(no options defined)"}.`);
      break;
    }
    case "MULTISELECT": {
      const allowed = optionsOf(def).map((o) => o.value);
      inner = z
        .array(z.string())
        .refine((a) => a.every((s) => allowed.includes(s)), `Choose from: ${allowed.join(", ") || "(no options defined)"}.`)
        .transform((a) => [...new Set(a)]);
      break;
    }
  }
  return z.preprocess((v) => (empty(v) ? null : v), inner.nullable()) as z.ZodType<FieldValue | null>;
}

export interface ValidateOptions {
  /** Stored values for the record, used to keep keys the caller did not send. */
  existing?: Record<string, unknown> | null;
  /** `reject`: a key with no definition is an error. `keep`: it is passed through untouched (legacy and system keys). */
  unknownKeys: "reject" | "keep";
  /** Only definitions that apply are validated; others (inactive, other service) keep their stored value. */
  applies?: (def: FieldDefinition) => boolean;
}

export interface ValidateResult {
  /** Stored values after the change: existing values, plus the valid incoming ones; cleared fields removed. */
  values: Record<string, unknown>;
  /** Keys whose value changed, with before and after. */
  changes: Record<string, { before: unknown; after: unknown }>;
  issues: ValidationIssue[];
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Applies `incoming` to `existing` under the definitions. Fields not sent keep
 * their stored value; sending null or an empty value clears a field; a value
 * that fails its type is reported with the field path and nothing is applied
 * for that field.
 */
export function applyValues(
  defs: FieldDefinition[],
  incoming: Record<string, unknown>,
  options: ValidateOptions,
  pathPrefix = "customFields",
): ValidateResult {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const existing = { ...(options.existing ?? {}) } as Record<string, unknown>;
  const values = { ...existing };
  const changes: ValidateResult["changes"] = {};
  const issues: ValidationIssue[] = [];

  for (const [key, raw] of Object.entries(incoming)) {
    const def = byKey.get(key);
    if (!def) {
      if (options.unknownKeys === "reject") {
        issues.push({ path: `${pathPrefix}.${key}`, message: `"${key}" is not a field of this record.`, code: "UNKNOWN_FIELD" });
      } else {
        values[key] = raw;
        if (!sameValue(existing[key], raw)) changes[key] = { before: existing[key] ?? null, after: raw };
      }
      continue;
    }
    if (options.applies && !options.applies(def)) {
      issues.push({ path: `${pathPrefix}.${key}`, message: `"${def.label}" does not apply here.`, code: "FIELD_NOT_APPLICABLE" });
      continue;
    }
    if (!def.isActive) {
      issues.push({ path: `${pathPrefix}.${key}`, message: `"${def.label}" is no longer in use.`, code: "FIELD_INACTIVE" });
      continue;
    }
    const parsed = schemaForField(def).safeParse(raw);
    if (!parsed.success) {
      issues.push({
        path: `${pathPrefix}.${key}`,
        message: `${def.label}: ${parsed.error.issues[0]?.message ?? "Invalid value."}`,
        code: "INVALID_VALUE",
      });
      continue;
    }
    const value = parsed.data;
    if (value === null) delete values[key];
    else values[key] = value;
    if (!sameValue(existing[key], value)) changes[key] = { before: existing[key] ?? null, after: value };
  }
  return { values, changes, issues };
}

/** Required fields with no value, for one moment: saving a record, or moving a lead to Qualified. */
export function missingRequired(
  defs: FieldDefinition[],
  values: Record<string, unknown> | null | undefined,
  moment: "save" | "qualify",
  pathPrefix = "customFields",
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const def of defs) {
    if (!def.isActive) continue;
    const needed = moment === "save" ? def.required : def.required || def.requiredOnQualify;
    if (!needed) continue;
    const v = values?.[def.key];
    const blank = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
    if (blank) {
      issues.push({
        path: `${pathPrefix}.${def.key}`,
        message: moment === "qualify" ? `${def.label} is needed before this lead can be qualified.` : `${def.label} is required.`,
        code: moment === "qualify" ? "REQUIRED_ON_QUALIFY" : "REQUIRED",
      });
    }
  }
  return issues;
}

/** The query-string form of a filter value for one definition (`customField[budget]=5000`), as a JSON value to match. */
export function filterValueFor(def: FieldDefinition, raw: string): string | number | boolean | null {
  switch (def.fieldType) {
    case "NUMBER": {
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    }
    case "BOOLEAN":
      return raw === "true" ? true : raw === "false" ? false : null;
    default:
      return raw;
  }
}

export function validateDefinitionOptions(fieldType: CustomFieldType, options: unknown): ValidationIssue[] {
  if (fieldType !== "SELECT" && fieldType !== "MULTISELECT") return [];
  if (!Array.isArray(options) || options.length === 0) {
    return [{ path: "options", message: "A choice field needs at least one option.", code: "OPTIONS_REQUIRED" }];
  }
  if (options.length > MAX_OPTIONS) {
    return [{ path: "options", message: `At most ${MAX_OPTIONS} options.`, code: "TOO_MANY_OPTIONS" }];
  }
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  options.forEach((o, i) => {
    const value = (o as FieldOption | undefined)?.value;
    const label = (o as FieldOption | undefined)?.label;
    if (typeof value !== "string" || !value.trim() || typeof label !== "string" || !label.trim()) {
      issues.push({ path: `options.${i}`, message: "Each option needs a value and a label." });
    } else if (seen.has(value)) {
      issues.push({ path: `options.${i}`, message: `Duplicate option value "${value}".` });
    }
    if (typeof value === "string") seen.add(value);
  });
  return issues;
}

/** One `customField[key]=value` filter as a JSON path match, applied to a record's `customFields` column. */
export type JsonClause = { path: string[]; equals?: string | number | boolean; array_contains?: string | number | boolean };
