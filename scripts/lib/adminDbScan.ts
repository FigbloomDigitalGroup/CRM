/**
 * UC-F4 (Security S-1, part 1): finds every use of `adminDb` (the schema-owner Prisma client, which bypasses row-level security) in `src/`
 * and says which models it touches. One scanner, read by `scripts/adminDb-allowlist.ts` (which writes the allow-list and the classification
 * document) and by `tests/adminDbAllowList.test.ts` (which fails on any NEW use on tenant data outside the allow-list).
 *
 * It reads the code with the TypeScript compiler (no execution, no database). It sees:
 *   - `adminDb.<model>.<method>(...)`                               a model call
 *   - `adminDb.$transaction(async (tx) => { tx.<model>.<method> })` model calls through the callback's client
 *   - `adminDb.$queryRaw` / `$executeRaw` (and the Unsafe forms)    raw SQL; the tables are read from the SQL text
 *   - `adminDb` used as a value (passed, assigned, returned)        an "escape": the callee's model use is not visible here
 *   - `tx` used as a value inside a `$transaction` callback          a "tx escape", same reason
 * Where a call has a `where`, it also says whether the filter names the organisation (`org`), plainly does not (`none`), or cannot be
 * told from the code (`unknown`). That is a hint for review, not a proof: a missing organisation filter on a bare id is exactly the
 * S-1 risk, a present one is not a guarantee.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export type UseKind = "model" | "raw" | "escape" | "tx-escape";
export type Scope = "org" | "none" | "unknown" | null;

export interface AdminDbUse {
  /** Forward slashes, relative to the repository root. */
  file: string;
  line: number;
  kind: UseKind;
  /** Prisma delegate name (`company`), or null for raw SQL and escapes. */
  model: string | null;
  method: string | null;
  /** Raw SQL only: the tables found in the SQL text, as written. Empty when none could be read. */
  tables: string[];
  /** For calls with a `where`: does the filter name the organisation? null when the call has no `where` (create, raw). */
  scope: Scope;
}

export interface SchemaModels {
  /** Prisma delegate names of every model that is tenant data: has `organizationId`, plus the organisation itself. */
  tenant: Set<string>;
  /** Delegate names of the rest (users, sessions, roles, platform tables ...). */
  global: Set<string>;
  /** Table name (`@@map`) to delegate name. */
  tableToModel: Map<string, string>;
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Reads `prisma/schema.prisma`: which models carry `organizationId` (tenant data), and each model's table name. */
export function readSchemaModels(root: string): SchemaModels {
  const text = fs.readFileSync(path.join(root, "prisma", "schema.prisma"), "utf8");
  const tenant = new Set<string>();
  const global = new Set<string>();
  const tableToModel = new Map<string, string>();
  const blocks = text.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm);
  for (const [, name, body] of blocks) {
    const delegate = lowerFirst(name);
    const isTenant = /^\s*organizationId\s+String/m.test(body) || name === "Organization";
    (isTenant ? tenant : global).add(delegate);
    const map = body.match(/@@map\("([^"]+)"\)/);
    tableToModel.set(map ? map[1] : name, delegate);
  }
  return { tenant, global, tableToModel };
}

function walk(dir: string, out: string[]) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "generated" || entry.name === "node_modules") continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
}

const WHERE_METHODS = new Set(["findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "update", "updateMany", "delete", "deleteMany", "upsert", "count", "aggregate", "groupBy"]);
const RAW_METHODS = new Set(["$queryRaw", "$queryRawUnsafe", "$executeRaw", "$executeRawUnsafe"]);

/** Does this `where` mention the organisation? `org` when its text names one, `none` when it is an object literal that does not, else `unknown`. */
function whereScope(call: ts.CallExpression): Scope {
  const arg = call.arguments[0];
  if (!arg || !ts.isObjectLiteralExpression(arg)) return null;
  const where = arg.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText() === "where" || ts.isShorthandPropertyAssignment(p) && p.name.getText() === "where");
  if (!where) return null;
  if (!ts.isPropertyAssignment(where)) return "unknown";
  const text = where.initializer.getText();
  if (/organi[sz]ationId|orgId|organization\s*:/.test(text)) return "org";
  return ts.isObjectLiteralExpression(where.initializer) ? "none" : "unknown";
}

function sqlTables(call: ts.CallExpression): string[] {
  const parts: string[] = [];
  const grab = (n: ts.Node) => {
    if (ts.isNoSubstitutionTemplateLiteral(n) || ts.isStringLiteral(n)) parts.push(n.text);
    else if (ts.isTemplateExpression(n)) {
      parts.push(n.head.text);
      for (const s of n.templateSpans) parts.push(s.literal.text);
    }
    n.forEachChild(grab);
  };
  call.forEachChild(grab);
  const tables = new Set<string>();
  for (const m of parts.join(" ").matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+(?:ONLY\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/gi)) {
    const t = m[1].toLowerCase();
    if (!["select", "set", "lateral", "unnest", "generate_series", "jsonb_array_elements", "jsonb_to_recordset"].includes(t)) tables.add(t);
  }
  return [...tables].sort();
}

export function scanFile(root: string, absFile: string): AdminDbUse[] {
  const text = fs.readFileSync(absFile, "utf8");
  if (!text.includes("adminDb")) return [];
  const rel = path.relative(root, absFile).split(path.sep).join("/");
  const sf = ts.createSourceFile(absFile, text, ts.ScriptTarget.Latest, true, absFile.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const uses: AdminDbUse[] = [];
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const add = (n: ts.Node, u: Omit<AdminDbUse, "file" | "line">) => uses.push({ file: rel, line: lineOf(n), ...u });

  /** `<client>.<model>.<method>(...)` for a given client identifier node. */
  function modelCall(clientNode: ts.Node) {
    const modelAccess = clientNode.parent;
    if (!ts.isPropertyAccessExpression(modelAccess) || modelAccess.expression !== clientNode) return false;
    const model = modelAccess.name.text;
    const methodAccess = modelAccess.parent;
    if (ts.isPropertyAccessExpression(methodAccess) && methodAccess.expression === modelAccess) {
      const call = methodAccess.parent;
      const method = methodAccess.name.text;
      const isCall = ts.isCallExpression(call) && call.expression === methodAccess;
      add(clientNode, { kind: "model", model, method, tables: [], scope: isCall && WHERE_METHODS.has(method) ? whereScope(call) : null });
    } else {
      add(clientNode, { kind: "model", model, method: null, tables: [], scope: null });
    }
    return true;
  }

  function txCallback(call: ts.CallExpression) {
    const fn = call.arguments[0];
    if (!fn || !(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) return;
    const param = fn.parameters[0];
    if (!param || !ts.isIdentifier(param.name)) return;
    const name = param.name.text;
    const inner = (n: ts.Node) => {
      if (ts.isIdentifier(n) && n.text === name && n !== param.name && !ts.isParameter(n.parent)) {
        if (!(ts.isPropertyAssignment(n.parent) && n.parent.name === n)) {
          if (!modelCall(n)) {
            const p = n.parent;
            // `tx.$queryRaw...` is raw SQL through the transaction client.
            if (ts.isPropertyAccessExpression(p) && p.expression === n && RAW_METHODS.has(p.name.text) && ts.isCallExpression(p.parent)) {
              add(n, { kind: "raw", model: null, method: p.name.text, tables: sqlTables(p.parent), scope: null });
            } else if (!(ts.isPropertyAccessExpression(p) && p.expression === n && p.name.text.startsWith("$"))) {
              add(n, { kind: "tx-escape", model: null, method: null, tables: [], scope: null });
            }
          }
        }
      }
      n.forEachChild(inner);
    };
    fn.body.forEachChild(inner);
    if (!ts.isBlock(fn.body)) inner(fn.body);
  }

  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return;
    if (ts.isIdentifier(n) && n.text === "adminDb") {
      const p = n.parent;
      if (ts.isPropertyAccessExpression(p) && p.expression === n) {
        const name = p.name.text;
        if (name === "$transaction") {
          if (ts.isCallExpression(p.parent)) txCallback(p.parent);
        } else if (RAW_METHODS.has(name)) {
          if (ts.isCallExpression(p.parent)) add(n, { kind: "raw", model: null, method: name, tables: sqlTables(p.parent), scope: null });
          else if (ts.isTaggedTemplateExpression(p.parent)) add(n, { kind: "raw", model: null, method: name, tables: sqlTables(p.parent as unknown as ts.CallExpression), scope: null });
        } else if (name.startsWith("$")) {
          // $connect, $disconnect, $on: no data access.
        } else {
          modelCall(n);
        }
      } else if (!ts.isImportSpecifier(p) && !ts.isVariableDeclaration(p)) {
        add(n, { kind: "escape", model: null, method: null, tables: [], scope: null });
      } else if (ts.isVariableDeclaration(p) && p.initializer && p.initializer === n) {
        add(n, { kind: "escape", model: null, method: null, tables: [], scope: null });
      }
    }
    n.forEachChild(visit);
  };
  visit(sf);
  return uses;
}

/** Every use of `adminDb` under `<root>/src`, sorted by file and line. */
export function scanAdminDbUses(root: string): AdminDbUse[] {
  const files: string[] = [];
  walk(path.join(root, "src"), files);
  const all: AdminDbUse[] = [];
  for (const f of files.sort()) all.push(...scanFile(root, f));
  return all.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
}

/**
 * Every file under `src` that imports the owner client module (`db/adminClient`), statically (`from "..."`) or dynamically
 * (`await import("...")`). This is the set the ESLint override has to cover. The module's own file is not an importer.
 */
export function filesImportingAdminDb(root: string): string[] {
  const files: string[] = [];
  walk(path.join(root, "src"), files);
  const out: string[] = [];
  for (const f of files) {
    const rel = path.relative(root, f).split(path.sep).join("/");
    if (rel === "src/db/adminClient.ts") continue;
    const text = fs.readFileSync(f, "utf8");
    if (/(?:\bfrom\s*|\bimport\s*\(\s*)["'][^"']*db\/adminClient["']/.test(text)) out.push(rel);
  }
  return out.sort();
}

export const ESCAPE_KEY = "$adminDb-escape";
export const TX_ESCAPE_KEY = "$tx-escape";
export const RAW_UNKNOWN_KEY = "$raw-unreadable";

/**
 * The "models" a use counts against, for the allow-list: tenant delegates by name, raw SQL by the tenant tables its text names,
 * and the three UNKNOWN markers (an escape, a transaction-client escape, raw SQL whose tables could not be read). Uses of global
 * (non-tenant) models are not tenant data and are not counted.
 */
export function tenantKeys(use: AdminDbUse, models: SchemaModels): string[] {
  if (use.kind === "escape") return [ESCAPE_KEY];
  if (use.kind === "tx-escape") return [TX_ESCAPE_KEY];
  if (use.kind === "raw") {
    const keys = use.tables.map((t) => models.tableToModel.get(t)).filter((m): m is string => !!m && models.tenant.has(m));
    if (use.tables.length === 0) return [RAW_UNKNOWN_KEY];
    return [...new Set(keys)];
  }
  return use.model && models.tenant.has(use.model) ? [use.model] : [];
}
