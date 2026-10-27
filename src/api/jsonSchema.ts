/**
 * Small helpers over JSON Schema that the API contract tooling shares (G1.06): inferring a schema from a real response, rendering a
 * schema as a TypeScript type for the generated client, and building a deterministic example for the mock server.
 *
 * Deliberately dependency-free: the document is OpenAPI 3.1, so its schemas are plain JSON Schema, and the subset the Zod
 * converter and the inference below produce is small.
 */

export type JsonSchema = Record<string, any>;

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Infers a schema from one real response. Everything seen is `required` unless it was `null`, and a `null` becomes "any value or
 * null" because one example cannot say what the field holds when it is set. Arrays take the union of what their first items show.
 */
export function inferSchema(value: unknown, depth = 0): JsonSchema {
  if (value === null || value === undefined) return { nullable: true, description: "Observed as null in the reference example." };
  if (depth > 8) return {};
  if (typeof value === "string") {
    if (ISO_DATE_TIME.test(value)) return { type: "string", format: "date-time" };
    if (ISO_DATE.test(value)) return { type: "string", format: "date" };
    return { type: "string" };
  }
  if (typeof value === "number") return { type: Number.isInteger(value) ? "integer" : "number" };
  if (typeof value === "boolean") return { type: "boolean" };
  if (Array.isArray(value)) {
    if (value.length === 0) return { type: "array", items: {} };
    return { type: "array", items: mergeSchemas(value.slice(0, 5).map((v) => inferSchema(v, depth + 1))) };
  }
  if (typeof value === "object") {
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const schema = inferSchema(v, depth + 1);
      properties[key] = schema;
      if (!schema.nullable) required.push(key);
    }
    return { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: true };
  }
  return {};
}

function mergeSchemas(schemas: JsonSchema[]): JsonSchema {
  if (schemas.length === 1) return schemas[0]!;
  const objects = schemas.filter((s) => s.type === "object");
  if (objects.length === schemas.length) {
    const keys = new Set(objects.flatMap((o) => Object.keys(o.properties ?? {})));
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const key of keys) {
      const present = objects.filter((o) => o.properties?.[key]);
      const merged = mergeSchemas(present.map((o) => o.properties[key]));
      properties[key] = merged;
      if (present.length === objects.length && !merged.nullable) required.push(key);
    }
    return { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: true };
  }
  const first = schemas[0]!;
  const sameType = schemas.every((s) => s.type === first.type && s.format === first.format);
  if (sameType) return { ...first, ...(schemas.some((s) => s.nullable) ? { nullable: true } : {}) };
  return {};
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const key = (k: string) => (IDENT.test(k) ? k : JSON.stringify(k));

/** A TypeScript type for a JSON Schema (3.1 style `type: [..., "null"]`, plus the `nullable` marker `inferSchema` uses). */
export function toTsType(schema: JsonSchema | undefined, root: JsonSchema = {}, indent = 0): string {
  if (!schema || Object.keys(schema).length === 0) return "unknown";
  if (typeof schema.$ref === "string") {
    const name = schema.$ref.split("/").pop()!;
    return `Schemas[${JSON.stringify(name)}]`;
  }
  const pad = "  ".repeat(indent + 1);
  const end = "  ".repeat(indent);
  const withNull = (t: string) => (schema.nullable ? `${t} | null` : t);
  if ("const" in schema) return withNull(JSON.stringify(schema.const));
  if (Array.isArray(schema.enum)) return withNull(schema.enum.map((v: unknown) => JSON.stringify(v)).join(" | ") || "never");
  const union = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(union)) return withNull(union.map((s: JsonSchema) => toTsType(s, root, indent)).join(" | ") || "unknown");
  if (Array.isArray(schema.allOf)) return withNull(schema.allOf.map((s: JsonSchema) => toTsType(s, root, indent)).join(" & ") || "unknown");
  const types: string[] = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const parts = types.map((t) => {
    switch (t) {
      case "string":
        return "string";
      case "integer":
      case "number":
        return "number";
      case "boolean":
        return "boolean";
      case "null":
        return "null";
      case "array":
        return `Array<${toTsType(schema.items, root, indent)}>`;
      case "object": {
        const props: Record<string, JsonSchema> = schema.properties ?? {};
        const required = new Set<string>(schema.required ?? []);
        const lines = Object.entries(props).map(([k, v]) => `${pad}${key(k)}${required.has(k) ? "" : "?"}: ${toTsType(v, root, indent + 1)};`);
        const extra = schema.additionalProperties;
        if (extra && extra !== true && typeof extra === "object") lines.push(`${pad}[key: string]: ${toTsType(extra, root, indent + 1)};`);
        else if (extra === true || (lines.length === 0 && extra === undefined)) lines.push(`${pad}[key: string]: unknown;`);
        return lines.length ? `{\n${lines.join("\n")}\n${end}}` : "Record<string, unknown>";
      }
      default:
        return "unknown";
    }
  });
  if (parts.length === 0) return withNull("unknown");
  return withNull(parts.join(" | "));
}

/** A small deterministic generator so the mock server's examples do not change from one start to the next. */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/** An example value for a schema (used where no recorded response exists). */
export function exampleFor(schema: JsonSchema | undefined, seed: string, root: JsonSchema = {}, depth = 0): unknown {
  const rnd = seededRandom(seed);
  const go = (node: JsonSchema | undefined, name: string, d: number): unknown => {
    if (!node || d > 5) return null;
    if (typeof node.$ref === "string") {
      const target = root.components?.schemas?.[node.$ref.split("/").pop()!];
      return go(target, name, d + 1);
    }
    if ("const" in node) return node.const;
    if (Array.isArray(node.enum)) return node.enum[0];
    const union = node.anyOf ?? node.oneOf;
    if (Array.isArray(union)) return go(union.find((s: JsonSchema) => s.type !== "null") ?? union[0], name, d + 1);
    const type = Array.isArray(node.type) ? node.type.find((t: string) => t !== "null") : node.type;
    switch (type) {
      case "string":
        if (node.format === "date-time") return "2026-11-02T09:00:00.000Z";
        if (node.format === "date") return "2026-11-02";
        if (node.format === "email") return "person@example.test";
        if (node.format === "uuid" || /Id$/.test(name)) return `00000000-0000-4000-8000-${String(Math.floor(rnd() * 1e12)).padStart(12, "0")}`;
        return name ? `${name} sample` : "sample";
      case "integer":
        return Math.floor(rnd() * 100);
      case "number":
        return Math.round(rnd() * 10000) / 100;
      case "boolean":
        return false;
      case "array":
        return [go(node.items, name, d + 1)].filter((v) => v !== null);
      case "object": {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries<JsonSchema>(node.properties ?? {})) out[k] = go(v, k, d + 1);
        return out;
      }
      default:
        return null;
    }
  };
  return go(schema, "", depth);
}
