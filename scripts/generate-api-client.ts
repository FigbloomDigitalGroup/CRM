import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildClientSource } from "../src/api/clientGenerator";
import { buildOpenApiDocument } from "../src/api/openapi";

/**
 * G1.06: writes the typed API client (`src/api-client/generated.ts`) from the OpenAPI document. With `--check` it writes nothing and
 * exits 1 when the committed file is out of date, which is how CI catches a route change that skipped the contract step.
 *
 *   npx tsx scripts/generate-api-client.ts [--check] [--from openapi/openapi.v1.json]
 */
const args = process.argv.slice(2);
const check = args.includes("--check");
const fromIndex = args.indexOf("--from");
const doc = fromIndex >= 0 ? JSON.parse(readFileSync(resolve(args[fromIndex + 1]!), "utf8")) : buildOpenApiDocument();
const out = resolve("src/api-client/generated.ts");
const source = buildClientSource(doc);

if (check) {
  let current = "";
  try {
    current = readFileSync(out, "utf8");
  } catch {
    current = "";
  }
  if (current.replace(/\r\n/g, "\n") !== source) {
    console.error("src/api-client/generated.ts is out of date. Run: npx tsx scripts/generate-api-client.ts");
    process.exit(1);
  }
  console.log("src/api-client/generated.ts is up to date.");
} else {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, source);
  console.log(`Typed client written to ${out}`);
}
