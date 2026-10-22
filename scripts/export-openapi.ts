import { mkdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { buildOpenApiDocument } from "../src/api/openapi";

/**
 * FIG-1014 (B0.06): writes the generated OpenAPI document to a file
 * (default `openapi/openapi.json`; pass a path to override). CI runs this
 * and keeps the file as a build artifact.
 */
const out = resolve(process.argv[2] ?? "openapi/openapi.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(buildOpenApiDocument(), null, 2) + "\n");
console.log(`OpenAPI document written to ${out}`);
