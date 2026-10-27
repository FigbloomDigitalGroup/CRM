/**
 * Builds a request body (or query) that satisfies a route's own Zod schema, so the generated suites can get past validation and
 * reach the permission and record checks behind it. The schema is read back from the route at run time (see the `validation` mock
 * in the suites), so nothing here has to be kept in step with a hand-written list of bodies.
 */
import { z } from "zod";

export type Hints = Record<string, string>;

type Schema = Record<string, any>;

function resolve(node: Schema, root: Schema): Schema {
  if (node && typeof node.$ref === "string") {
    const path = node.$ref.replace(/^#\//, "").split("/");
    let target: any = root;
    for (const part of path) target = target?.[part];
    return resolve(target ?? {}, root);
  }
  return node ?? {};
}

function sample(node: Schema, root: Schema, hints: Hints, name: string, all: boolean, depth: number): unknown {
  node = resolve(node, root);
  if (depth > 6) return undefined;
  if ("const" in node) return node.const;
  if (Array.isArray(node.enum) && node.enum.length > 0) return node.enum[0];
  const variants = node.anyOf ?? node.oneOf;
  if (Array.isArray(variants) && variants.length > 0) {
    const concrete = variants.find((v: Schema) => resolve(v, root).type !== "null") ?? variants[0];
    return sample(concrete, root, hints, name, all, depth + 1);
  }
  if (Array.isArray(node.allOf) && node.allOf.length > 0) {
    return sample(node.allOf[0], root, hints, name, all, depth + 1);
  }
  const type = Array.isArray(node.type) ? node.type.find((t: string) => t !== "null") : node.type;
  switch (type) {
    case "string": {
      if (hints[name]) return hints[name];
      if (/Id$/.test(name) && hints[name.replace(/Id$/, "") + "Id"]) return hints[name.replace(/Id$/, "") + "Id"];
      if (node.format === "email") return "sample.person@example.test";
      if (node.format === "date-time") return new Date("2026-11-02T09:00:00Z").toISOString();
      if (node.format === "date") return "2026-11-02";
      if (node.format === "uuid") return hints[name] ?? "00000000-0000-4000-8000-000000000000";
      if (node.format === "uri") return "https://example.test/x";
      if (/email/i.test(name)) return "sample.person@example.test";
      if (/phone/i.test(name)) return "+254700111222";
      if (/(On|Date)$/.test(name) || /^(from|to|since|until|dateFrom|dateTo|startsOn|renewsOn|issuedOn|dueOn|paidOn)$/.test(name)) return "2026-11-02";
      if (/(At)$/.test(name)) return new Date("2026-11-02T09:00:00Z").toISOString();
      const min = typeof node.minLength === "number" ? node.minLength : 1;
      const text = "Sample";
      return text.length >= min ? text : text.padEnd(min, "x");
    }
    case "integer":
    case "number": {
      let value = typeof node.minimum === "number" ? node.minimum : typeof node.exclusiveMinimum === "number" ? node.exclusiveMinimum + 1 : 1;
      if (typeof node.maximum === "number" && value > node.maximum) value = node.maximum;
      return value;
    }
    case "boolean":
      return false;
    case "array": {
      const min = typeof node.minItems === "number" ? node.minItems : 0;
      if (min === 0 && !all) return [];
      const item = sample(node.items ?? {}, root, hints, name, all, depth + 1);
      return item === undefined ? [] : Array.from({ length: Math.max(min, 1) }, () => item);
    }
    case "object":
    default: {
      const props: Record<string, Schema> = node.properties ?? {};
      if (Object.keys(props).length === 0) {
        // A free-form record: an empty one is the safest value.
        return type === "object" || node.additionalProperties !== undefined ? {} : undefined;
      }
      const required = new Set<string>(node.required ?? []);
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(props)) {
        if (!all && !required.has(key)) continue;
        const v = sample(value, root, hints, key, all, depth + 1);
        if (v !== undefined) out[key] = v;
      }
      return out;
    }
  }
}

/** A value for `schema`. `all` also fills the optional fields, for schemas that insist on "at least one of these". */
export function sampleFor(schema: z.ZodType, hints: Hints, all = false): unknown {
  let json: Schema;
  try {
    json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any", target: "draft-2020-12" }) as Schema;
  } catch {
    return {};
  }
  return sample(json, json, hints, "", all, 0) ?? {};
}

/** Query strings: every value is a string, so scalars are rendered as text. */
export function queryFor(schema: z.ZodType, hints: Hints, all = false): string {
  const value = sampleFor(schema, hints, all);
  if (!value || typeof value !== "object") return "";
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined || v === null || typeof v === "object") continue;
    params.set(k, String(v));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}
