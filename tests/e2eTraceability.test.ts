import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { V1_TRACE } from "../e2e/qa/trace";

/**
 * Q1.01 (FIG-1115), B0.04: every V1 row of the Screen Checklist is traced to at least one Playwright journey that exists and contains tests.
 * The checklist is `design-spec/TRACEABILITY.md`; the map is `e2e/qa/trace.ts`. This is the CI check the issue asks for. (Whether the
 * journeys pass is the e2e job's verdict; this check is that none is missing.)
 */

const ROOT = process.cwd();

function v1Ids(): string[] {
  const md = readFileSync(join(ROOT, "design-spec/TRACEABILITY.md"), "utf8");
  const ids: string[] = [];
  for (const line of md.split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length > 4 && /^[A-Z]+[0-9M]*(#2)?$/.test(cells[1]) && cells[3] === "V1") ids.push(cells[1]);
  }
  return ids;
}

const specFile = (name: string) => join(ROOT, "e2e", `${name}.spec.ts`);

describe("V1 screen checklist is traced to journeys", () => {
  const ids = v1Ids();

  it("reads the 54 V1 rows of the checklist", () => {
    expect(ids).toHaveLength(54);
  });

  it("every V1 ID has at least one journey", () => {
    expect(ids.filter((id) => !(V1_TRACE[id]?.length > 0))).toEqual([]);
  });

  it("the map names no ID the checklist does not have as V1", () => {
    expect(Object.keys(V1_TRACE).filter((id) => !ids.includes(id))).toEqual([]);
  });

  it("every named journey file exists and contains tests", () => {
    const problems: string[] = [];
    for (const [id, files] of Object.entries(V1_TRACE)) {
      for (const f of files) {
        const path = specFile(f);
        if (!existsSync(path)) problems.push(`${id}: e2e/${f}.spec.ts does not exist`);
        else if (!/\btest(\.describe)?\(|\btest\(/.test(readFileSync(path, "utf8"))) problems.push(`${id}: e2e/${f}.spec.ts has no test`);
      }
    }
    expect(problems).toEqual([]);
  });
});
