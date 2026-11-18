import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { buildClientSource } from "../src/api/clientGenerator";
import { buildOpenApiDocument } from "../src/api/openapi";
import { buildReferenceMarkdown } from "../src/api/referenceDoc";

/**
 * G1.06: regenerates everything derived from the OpenAPI document, in one go:
 *
 *   src/api/contract/openapi.v1.json   the frozen contract (tag `api-v1.0` marks its first version)
 *   src/api-client/generated.ts        the typed client's operation table and types
 *   docs/API_REFERENCE.md              the developer reference
 *
 * Then it prints the contract hash. A change to the contract must also add a line `contract-hash: <that hash>` with a note to
 * docs/API_CHANGELOG.md; tests/apiContract.test.ts fails until it does, which is how the API cannot drift without a version note.
 */
function write(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

const doc = buildOpenApiDocument();
const frozen = `${JSON.stringify(doc, null, 2)}\n`;
write("src/api/contract/openapi.v1.json", frozen);
write("src/api-client/generated.ts", buildClientSource(JSON.parse(frozen)));
const hash = createHash("sha256").update(frozen).digest("hex");
write("docs/API_REFERENCE.md", buildReferenceMarkdown(JSON.parse(frozen)));
console.log(`Contract written: ${Object.keys(doc.paths).length} paths, version ${doc.info.version}.`);
console.log(`contract-hash: ${hash}`);
