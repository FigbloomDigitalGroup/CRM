import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { csvResponseStream, neutraliseSpreadsheetFormula, stringifyCsv } from "../src/lib/csv";

/** G1.05: a cell that a spreadsheet would run as a formula is written as text (CSV injection), in every CSV the app produces. */
describe("CSV formula injection", () => {
  it.each([
    ["=HYPERLINK(\"http://evil.test\",\"x\")", "'=HYPERLINK(\"http://evil.test\",\"x\")"],
    ["@SUM(1+1)", "'@SUM(1+1)"],
    ["+cmd|' /C calc'!A0", "'+cmd|' /C calc'!A0"],
    ["-2+3+cmd|' /C calc'!A0", "'-2+3+cmd|' /C calc'!A0"],
    ["\tTAB", "'\tTAB"],
    ["\rCR", "'\rCR"],
  ])("neutralises %j", (input, expected) => {
    expect(neutraliseSpreadsheetFormula(input)).toBe(expected);
  });

  it("leaves ordinary text, numbers, phone numbers and amounts exactly as they are", () => {
    for (const ok of ["Acme Ltd", "", "O'Brien", "-12.50", "+254722000111", "1,234.50", "0722 000 111", "2026-11-02", "a=b", "x+y", "name@example.test"]) {
      expect(neutraliseSpreadsheetFormula(ok)).toBe(ok);
    }
  });

  it("applies to every cell of a whole CSV, header included", () => {
    const csv = stringifyCsv([{ name: "=1+1", note: "fine", amount: "-5.00" }], { header: true });
    expect(csv.split("\n")[1]).toBe("'=1+1,fine,-5.00");
  });

  it("applies to a streamed CSV (the lead, contact, company and deal exports)", async () => {
    async function* rows() {
      yield { name: "=cmd()", email: "a@example.test" };
    }
    const text = await new Response(csvResponseStream(["name", "email"], rows())).text();
    expect(text.split("\n")[1]).toBe("'=cmd(),a@example.test");
  });

  it("is the only way the app writes a CSV: no other file imports csv-stringify", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(name) && readFileSync(p, "utf8").includes('from "csv-stringify')) offenders.push(p.split("\\").join("/"));
      }
    };
    walk("src");
    // csv.ts is the writer; spreadsheet.ts reads an uploaded sheet into CSV for the importer and must keep cell text as typed.
    expect(offenders.sort()).toEqual(["src/lib/csv.ts", "src/lib/spreadsheet.ts"]);
  });
});
