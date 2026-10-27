/**
 * Renders the OpenAPI document as a readable developer reference (docs/API_REFERENCE.md, G1.06). Pure and deterministic, so a test can
 * check the committed file against the document and CI fails when they drift.
 */
type Doc = { info: { title: string; version: string }; paths: Record<string, Record<string, any>>; tags?: { name: string }[] };

const METHOD_ORDER = ["get", "post", "put", "patch", "delete"];

function fields(schema: any): string {
  const props = schema?.properties;
  if (!props || typeof props !== "object") return "";
  const required = new Set<string>(schema.required ?? []);
  return Object.entries(props as Record<string, any>)
    .map(([name, s]) => `\`${name}\`${required.has(name) ? "" : "?"}: ${typeOf(s)}`)
    .join(", ");
}

function typeOf(s: any): string {
  if (!s || typeof s !== "object") return "any";
  if (s.$ref) return String(s.$ref).split("/").pop()!;
  if (Array.isArray(s.enum)) return s.enum.map((v: unknown) => JSON.stringify(v)).join(" | ");
  const union = s.anyOf ?? s.oneOf;
  if (Array.isArray(union)) return union.map(typeOf).join(" | ");
  const t = Array.isArray(s.type) ? s.type.join(" | ") : s.type;
  if (t === "array") return `${typeOf(s.items)}[]`;
  if (t === "integer") return "number";
  return t ?? (s.nullable ? "null" : "any");
}

export function buildReferenceMarkdown(doc: Doc, contractHash?: string): string {
  const lines: string[] = [];
  lines.push(`# ${doc.info.title} reference (v${doc.info.version})`);
  lines.push("");
  lines.push("Generated from the OpenAPI document by `npm run contract:update`; do not edit by hand. The document is `src/api/contract/openapi.v1.json`,");
  lines.push("the typed client is `src/api-client/`, and `npm run mock:api` serves every operation below without a database.");
  lines.push("Conventions (error envelope, paging, idempotency): `docs/API_CONVENTIONS.md`. Changes since 1.0: `docs/API_CHANGELOG.md`.");
  lines.push("");
  lines.push("**Access** lists the roles the permission matrix lets through (`docs/PERMISSION_MATRIX_REPORT.md`); any other role gets a 403 with an explained denial.");
  lines.push("Operations marked *derived* have their request schema recorded from the route itself; their answers are described by shape, not by a hand-written schema.");
  lines.push("");
  const byTag = new Map<string, { method: string; path: string; op: any }[]>();
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries<any>(item)) {
      const tag = op.tags?.[0] ?? "Other";
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag)!.push({ method, path, op });
    }
  }
  const tags = [...byTag.keys()].sort();
  lines.push("## Contents", "");
  for (const tag of tags) lines.push(`- [${tag}](#${tag.toLowerCase().replace(/[^a-z0-9]+/g, "-")}) (${byTag.get(tag)!.length})`);
  lines.push("");
  for (const tag of tags) {
    lines.push(`## ${tag}`, "");
    const ops = byTag.get(tag)!.sort((a, b) => a.path.localeCompare(b.path) || METHOD_ORDER.indexOf(a.method) - METHOD_ORDER.indexOf(b.method));
    for (const { method, path, op } of ops) {
      lines.push(`### \`${method.toUpperCase()} ${path.replace("/api/orgs/{orgSlug}", "…")}\``);
      lines.push("");
      lines.push(`\`${op.operationId}\`${op["x-contract-source"] === "derived" ? " · *derived*" : ""}${op["x-rate-limited"] ? " · rate limited" : ""}`);
      lines.push("");
      if (op.summary && !op.summary.startsWith(`${method.toUpperCase()} `)) lines.push(String(op.summary).replace(/\s+/g, " "), "");
      const roles: string[] | undefined = op["x-allowed-roles"];
      const security = (op.security ?? []).length === 0 ? "none (public)" : Object.keys(op.security[0]).join(", ");
      lines.push(`- **Credential:** ${security}${roles ? `; **access:** ${roles.length ? roles.map((r) => r.toLowerCase().replace(/_/g, " ")).join(", ") : "nobody"}` : ""}`);
      const query = (op.parameters ?? []).filter((p: any) => p.in === "query");
      if (query.length) lines.push(`- **Query:** ${query.map((p: any) => `\`${p.name}\`${p.required ? "" : "?"}: ${typeOf(p.schema)}`).join(", ")}`);
      const bodyContent = op.requestBody?.content ?? {};
      if (bodyContent["multipart/form-data"]) lines.push("- **Body:** multipart form with `file`");
      else if (bodyContent["application/json"]) {
        const f = fields(bodyContent["application/json"].schema);
        lines.push(`- **Body:** ${f || "JSON object"}`);
      }
      const ok = op.responses?.["200"] ?? op.responses?.["201"];
      const okSchema = ok?.content?.["application/json"]?.schema;
      if (ok?.content?.["text/csv"]) lines.push("- **Returns:** CSV");
      else if (okSchema) lines.push(`- **Returns:** ${fields(okSchema) || typeOf(okSchema)}`);
      const errors = Object.keys(op.responses ?? {}).filter((s) => Number(s) >= 400 && s !== "500");
      if (errors.length) lines.push(`- **Errors:** ${errors.join(", ")}`);
      lines.push("");
    }
  }
  if (contractHash) lines.push(`contract-hash: ${contractHash}`, "");
  return lines.join("\n");
}
