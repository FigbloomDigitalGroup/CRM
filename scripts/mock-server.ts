import { loadContractExamples } from "../src/api/contractExamples";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createMockServer } from "../src/api/mockServer";
import { buildOpenApiDocument } from "../src/api/openapi";

/**
 * G1.06: `npm run mock:api` starts the mock server on :4010 from the frozen contract (src/api/contract/openapi.v1.json when it exists, else
 * the live document) and the recorded examples. Send `x-mock-role: SALES` (or any of the six roles, or `none`) to act as that role.
 */
const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1] || 4010);
const frozen = resolve("src/api/contract/openapi.v1.json");
const doc = existsSync(frozen) ? JSON.parse(readFileSync(frozen, "utf8")) : buildOpenApiDocument();

const examples = existsSync(resolve("src/api/contract/examples.json")) ? loadContractExamples() : {};
createMockServer({ doc, examples }).listen(port, () => {
  console.log(`Figbloom CRM mock API on http://localhost:${port} (${Object.keys(doc.paths).length} paths). Header x-mock-role picks the role.`);
});
