import { describe, expect, it } from "vitest";
import {
  ADOPTION_QUERIES,
  assertReadOnlyCountsOnly,
  formatAdoptionReport,
  percent,
  runAdoptionReport,
  type RunCount,
} from "../scripts/adoption-report";

// No database: a fake query function stands in for pg.
describe("adoption report (FIG-1130)", () => {
  it("every statement is one read-only, counts-only SELECT that never reads money", () => {
    expect(ADOPTION_QUERIES.length).toBeGreaterThan(15);
    for (const q of ADOPTION_QUERIES) expect(() => assertReadOnlyCountsOnly(q), q.id).not.toThrow();
  });

  it("has unique ids and covers A1, A3, A4, A5, A6, D2, D4, D5 and D6", () => {
    const ids = ADOPTION_QUERIES.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    const measures = new Set(ADOPTION_QUERIES.map((q) => q.measure));
    for (const m of ["A1", "A3", "A4", "A5", "A6", "D2", "D4", "D5", "D6"]) expect(measures.has(m)).toBe(true);
  });

  it("refuses a write, a second statement or a money column", () => {
    const bad = (sql: string) => ({ id: "x", label: "x", measure: "", sql });
    expect(() => assertReadOnlyCountsOnly(bad("DELETE FROM leads"))).toThrow();
    expect(() => assertReadOnlyCountsOnly(bad("SELECT count(*) FROM leads; DROP TABLE leads"))).toThrow();
    expect(() => assertReadOnlyCountsOnly(bad("SELECT count(*) FROM leads WHERE x = 1 AND update_me = 1 OR delete = 1"))).toThrow();
    expect(() => assertReadOnlyCountsOnly(bad("SELECT sum(value) FROM deals"))).toThrow();
    expect(() => assertReadOnlyCountsOnly(bad("SELECT count(*) FROM payments"))).toThrow();
    expect(() => assertReadOnlyCountsOnly(bad("SELECT id FROM leads"))).toThrow();
  });

  it("passes the slug and window as parameters and returns numbers only", async () => {
    const seen: unknown[][] = [];
    const run: RunCount = async (_sql, params) => {
      seen.push(params);
      return 4;
    };
    const rows = await runAdoptionReport(run, "figbloom", 14);
    expect(rows).toHaveLength(ADOPTION_QUERIES.length);
    expect(seen.every((p) => p[0] === "figbloom" && p[1] === 14)).toBe(true);
    expect(rows.every((r) => r.value === 4)).toBe(true);
  });

  it("keeps going when one query fails and reports only the error class", async () => {
    let i = 0;
    const run: RunCount = async () => {
      i += 1;
      if (i === 2) throw new TypeError("password=secret host=db");
      return 1;
    };
    const rows = await runAdoptionReport(run, "figbloom", 7);
    expect(rows[1]).toMatchObject({ value: null, error: "TypeError" });
    expect(JSON.stringify(rows)).not.toContain("secret");
  });

  it("rejects an odd slug or window", async () => {
    const run: RunCount = async () => 0;
    await expect(runAdoptionReport(run, "x'; drop", 14)).rejects.toThrow();
    await expect(runAdoptionReport(run, "figbloom", 0)).rejects.toThrow();
  });

  it("formats ratios and handles a zero denominator", () => {
    expect(percent(4, 5)).toBe("80%");
    expect(percent(1, 0)).toBe("n/a");
    const rows = ADOPTION_QUERIES.map((q) => ({ id: q.id, label: q.label, measure: q.measure, value: 5 }));
    const text = formatAdoptionReport(rows, "figbloom", 14);
    expect(text).toContain("A1 signed in / active members     100%");
    expect(text).toContain("counts only");
  });
});
