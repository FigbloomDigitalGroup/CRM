import { readFileSync } from "node:fs";
import { fromV11Recording } from "./derivedOperations";

/**
 * The recorded example answers the mock server serves (G1.06, G2.03): the V1 recording, with the V1.1 recording for the routes that are closed to
 * everybody in a V1 organisation (see `fromV11Recording`). Read from disk so the mock server script and the contract tests use the same set.
 */
export function loadContractExamples(dir = "src/api/contract"): Record<string, Record<string, unknown>> {
  const v1 = JSON.parse(readFileSync(`${dir}/examples.json`, "utf8")) as Record<string, Record<string, unknown>>;
  const v11 = JSON.parse(readFileSync(`${dir}/examplesV11.json`, "utf8")) as Record<string, Record<string, unknown>>;
  const merged = { ...v1 };
  for (const [key, value] of Object.entries(v11)) if (fromV11Recording(key)) merged[key] = value;
  return merged;
}
