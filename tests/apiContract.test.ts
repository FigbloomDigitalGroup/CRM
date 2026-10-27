/**
 * G1.06 (FIG-1073): the V1 API contract is frozen, typed, mockable and documented, and cannot drift quietly.
 *
 *   - every route on disk is in the OpenAPI document (the few left out are named, with a reason), and nothing in it is stale;
 *   - the document equals the frozen file `src/api/contract/openapi.v1.json`, and a changed contract needs a note in
 *     docs/API_CHANGELOG.md carrying the new contract hash;
 *   - the typed client and the developer reference are up to date with the document;
 *   - the mock server answers every operation as every role: the matrix's refusals, the signed-out 401, and an example otherwise.
 *
 * After an intended API change run `npm run contract:update`, then add the printed `contract-hash:` line and a note to the changelog.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiRequestError, buildUrl, createClient } from "../src/api-client";
import { operations } from "../src/api-client/generated";
import { NOT_IN_V1_CONTRACT } from "../src/api/accountOperations";
import { buildClientSource } from "../src/api/clientGenerator";
import { createMockServer } from "../src/api/mockServer";
import { API_VERSION, buildOpenApiDocument } from "../src/api/openapi";
import { buildReferenceMarkdown } from "../src/api/referenceDoc";

const FROZEN = "src/api/contract/openapi.v1.json";
const ROLES = ["MANAGEMENT", "SALES", "DELIVERY", "FINANCE", "RESTRICTED_TECHNICAL", "CUSTOMER_SUPPORT"];

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) routeFiles(p, out);
    else if (name === "route.ts") out.push(p);
  }
  return out;
}

function routesOnDisk(): string[] {
  const keys: string[] = [];
  for (const file of routeFiles("src/app/api")) {
    const path = file.replace(/\\/g, "/").replace("src/app", "").replace(/\/route\.ts$/, "").replace(/\[([A-Za-z0-9_]+)\]/g, "{$1}");
    const source = readFileSync(file, "utf8");
    for (const m of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      if (new RegExp(`export\\s+(async\\s+function|const)\\s+${m}\\b`).test(source)) keys.push(`${m} ${path}`);
    }
  }
  return keys.sort();
}

const doc = buildOpenApiDocument() as any;

describe("the document covers the API", () => {
  it("documents every route on disk, apart from the ones deliberately left out", () => {
    const documented = new Set<string>();
    for (const [path, item] of Object.entries<any>(doc.paths)) for (const m of Object.keys(item)) documented.add(`${m.toUpperCase()} ${path}`);
    const missing = routesOnDisk().filter((k) => !documented.has(k) && !(k.split(" ")[1]! in NOT_IN_V1_CONTRACT));
    expect(missing).toEqual([]);
  });

  it("documents nothing that has no route", () => {
    const onDisk = new Set(routesOnDisk());
    const stale: string[] = [];
    for (const [path, item] of Object.entries<any>(doc.paths)) for (const m of Object.keys(item)) if (!onDisk.has(`${m.toUpperCase()} ${path}`)) stale.push(`${m.toUpperCase()} ${path}`);
    expect(stale).toEqual([]);
  });

  it("names every left-out route, and each is a real route", () => {
    const onDisk = new Set(routesOnDisk().map((k) => k.split(" ")[1]));
    for (const path of Object.keys(NOT_IN_V1_CONTRACT)) expect(onDisk.has(path), path).toBe(true);
  });

  it("gives every operation a unique id", () => {
    const ids = Object.values<any>(doc.paths).flatMap((item) => Object.values<any>(item).map((op) => op.operationId));
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
    expect(ids.every((id) => /^[a-z][A-Za-z0-9]*$/.test(id))).toBe(true);
  });

  it("states which credential each operation takes and which roles may use it", () => {
    const noCredential: string[] = [];
    let withRoles = 0;
    for (const [path, item] of Object.entries<any>(doc.paths)) {
      for (const [m, op] of Object.entries<any>(item)) {
        if (!Array.isArray(op.security)) noCredential.push(`${m} ${path}`);
        if (path.startsWith("/api/orgs/{orgSlug}")) {
          if (Array.isArray(op["x-allowed-roles"])) withRoles++;
        }
      }
    }
    expect(noCredential).toEqual([]);
    expect(withRoles).toBeGreaterThan(300);
  });
});

describe("the frozen contract", () => {
  const frozenText = readFileSync(FROZEN, "utf8");

  it("is version 1.0.0 of the API", () => {
    expect(JSON.parse(frozenText).info.version).toBe("1.0.0");
    expect(API_VERSION).toMatch(/^1\./);
  });

  it("equals the document the code produces (otherwise: npm run contract:update, and add a changelog note)", () => {
    expect(JSON.parse(JSON.stringify(doc))).toEqual(JSON.parse(frozenText));
  });

  it("has its current hash in docs/API_CHANGELOG.md, so a change cannot ship without a version note", () => {
    const hash = createHash("sha256").update(frozenText).digest("hex");
    const changelog = readFileSync("docs/API_CHANGELOG.md", "utf8");
    expect(changelog, `add "contract-hash: ${hash}" and a note describing the change`).toContain(`contract-hash: ${hash}`);
  });
});

describe("generated artefacts are up to date", () => {
  const frozen = JSON.parse(readFileSync(FROZEN, "utf8"));

  it("has a typed client that matches the document", () => {
    expect(readFileSync("src/api-client/generated.ts", "utf8").replace(/\r\n/g, "\n")).toBe(buildClientSource(frozen));
  });

  it("has a developer reference that matches the document", () => {
    expect(readFileSync("docs/API_REFERENCE.md", "utf8").replace(/\r\n/g, "\n")).toBe(buildReferenceMarkdown(frozen));
  });
});

describe("the typed client", () => {
  it("builds the URL from path parameters and query, encoding what needs it", () => {
    expect(buildUrl("/api/orgs/{orgSlug}/leads/{leadId}", { orgSlug: "acme co", leadId: "l/1" }, { page: 2, q: undefined, sort: "-createdAt" })).toBe(
      "/api/orgs/acme%20co/leads/l%2F1?page=2&sort=-createdAt",
    );
    expect(() => buildUrl("/api/orgs/{orgSlug}/leads", {}, undefined)).toThrow(/orgSlug/);
  });

  it("calls an operation with the right method, URL, body and idempotency key, and returns the JSON", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const client = createClient({
      baseUrl: "http://api.test/",
      headers: () => ({ "x-mock-role": "SALES" }),
      fetch: (async (url: string, init: RequestInit) => {
        seen.push({ url, init });
        return new Response(JSON.stringify({ lead: { id: "l1" } }), { status: 200, headers: { "content-type": "application/json" } });
      }) as unknown as typeof fetch,
    });
    const out = await client.call("createLead", { params: { orgSlug: "acme" }, body: { leadStatusId: "s1" } as any, idempotencyKey: "key-12345678" });
    expect(out).toEqual({ lead: { id: "l1" } });
    expect(seen[0]!.url).toBe("http://api.test/api/orgs/acme/leads");
    expect(seen[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(seen[0]!.init.body))).toEqual({ leadStatusId: "s1" });
    const headers = seen[0]!.init.headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBe("key-12345678");
    expect(headers["x-mock-role"]).toBe("SALES");
  });

  it("throws the error envelope as an ApiRequestError, and tells onError first", async () => {
    const envelope = { error: "No.", code: "FORBIDDEN", message: "No.", fieldErrors: [], requestId: "r1", denial: { yourRole: "Sales", ownerRoles: ["Management"], whoToAsk: ["Ada"] } };
    const heard: string[] = [];
    const client = createClient({ fetch: (async () => new Response(JSON.stringify(envelope), { status: 403 })) as unknown as typeof fetch, onError: (e) => heard.push(e.code) });
    const error = await client.call("listIntegrations", { params: { orgSlug: "acme" } }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error.isForbidden).toBe(true);
    expect(error.envelope.denial.whoToAsk).toEqual(["Ada"]);
    expect(heard).toEqual(["FORBIDDEN"]);
  });

  it("knows every operation in the document", () => {
    const ids = Object.values<any>(doc.paths).flatMap((item) => Object.values<any>(item).map((op) => op.operationId));
    expect(Object.keys(operations).sort()).toEqual([...ids].sort());
  });
});

describe("the mock server", () => {
  let base = "";
  let server: ReturnType<typeof createMockServer>;

  beforeAll(async () => {
    const examples = JSON.parse(readFileSync("src/api/contract/examples.json", "utf8"));
    server = createMockServer({ doc: JSON.parse(readFileSync(FROZEN, "utf8")), examples });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  async function call(method: string, path: string, role: string) {
    const url = path.replace(/\{[A-Za-z0-9_]+\}/g, "x1");
    const res = await fetch(base + url, { method, headers: { "x-mock-role": role } });
    return { status: res.status, text: await res.text(), type: res.headers.get("content-type") ?? "" };
  }

  it("answers every operation as every role: the matrix's refusal, or an example", async () => {
    const problems: string[] = [];
    let answered = 0;
    for (const [path, item] of Object.entries<any>(doc.paths)) {
      for (const [method, op] of Object.entries<any>(item)) {
        for (const role of ROLES) {
          const out = await call(method.toUpperCase(), path, role);
          answered++;
          const allowed: string[] | undefined = op["x-allowed-roles"];
          if (allowed && !allowed.includes(role)) {
            const body = JSON.parse(out.text);
            if (out.status !== 403 || body.code !== "FORBIDDEN" || !body.denial?.yourRole) problems.push(`${role} ${method} ${path}: expected an explained 403, got ${out.status}`);
          } else if (out.status >= 300 && !(out.status === 404 && op["x-role-outcomes"]?.[role] === "H")) {
            problems.push(`${role} ${method} ${path}: expected an example, got ${out.status}`);
          }
        }
      }
    }
    expect(answered).toBeGreaterThan(2000);
    expect(problems).toEqual([]);
  }, 120_000);

  it("answers 401 when signed out, and 404 for a route the contract does not have", async () => {
    const signedOut = await call("GET", "/api/orgs/{orgSlug}/leads", "none");
    expect(signedOut.status).toBe(401);
    expect(JSON.parse(signedOut.text).code).toBe("UNAUTHORIZED");
    expect((await call("GET", "/api/orgs/x1/no-such-route", "MANAGEMENT")).status).toBe(404);
  });

  it("carries the same masking as the real API in every recorded example: no deal value or payment for a role that may not see it", () => {
    const examples = JSON.parse(readFileSync("src/api/contract/examples.json", "utf8")) as Record<string, Record<string, unknown>>;
    const mayDealValue = new Set(["MANAGEMENT", "FINANCE", "SALES"]);
    const mayPayments = new Set(["MANAGEMENT", "FINANCE"]);
    const leaks: string[] = [];
    let scanned = 0;
    for (const [key, byRole] of Object.entries(examples)) {
      for (const role of ROLES) {
        // The mock serves a role its own recorded answer, or the shared one only when the role is listed in `same`; any other role gets the
        // matrix's refusal or a schema-built example, never another role's data.
        const same = Array.isArray(byRole.same) && (byRole.same as string[]).includes(role);
        if (!(role in byRole) && !same) continue;
        const body = same ? byRole.default : byRole[role];
        const text = JSON.stringify(body ?? "");
        scanned++;
        if (!mayDealValue.has(role) && /7[,\s]?654[,\s]?321/.test(text)) leaks.push(`${role} ${key}: deal value`);
        if (!mayPayments.has(role) && (/8[,\s]?123[,\s]?456/.test(text) || /INV-SENTINEL/.test(text))) leaks.push(`${role} ${key}: payment`);
      }
    }
    // Only answers that were really recorded are checked (a role with no recorded answer is served a refusal or a schema example).
    expect(scanned).toBeGreaterThan(500);
    expect(leaks).toEqual([]);
  });
});
