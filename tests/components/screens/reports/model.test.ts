import { describe, expect, it } from "vitest";
import { barRows, formatCell, isChartable, rangeFor, tableCells, tableToCsv, type ReportData } from "../../../../src/ui/screens/reports/model";

const REPORT: ReportData = {
  key: "PIPELINE_BY_STAGE",
  title: "Pipeline by stage",
  definition: "A live snapshot.",
  valueMasked: false,
  chart: { type: "bar", metric: "value", fallbackMetric: "deals", series: [{ label: "Proposal Sent", value: 600000 }, { label: "Negotiation", value: 300000 }] },
  table: {
    columns: [
      { key: "label", label: "Stage", type: "text" },
      { key: "deals", label: "Open deals", type: "number" },
      { key: "value", label: "Value", type: "money" },
    ],
    rows: [
      { label: "Proposal Sent", deals: 3, value: "600000.00" },
      { label: "Negotiation, late", deals: 1, value: "300000.00" },
    ],
    totals: { label: "Total", deals: 4, value: "900000.00" },
  },
};

describe("report model (F3.07)", () => {
  it("writes a CSV that is exactly the visible table, totals row last", () => {
    const cells = tableCells(REPORT.table.columns, REPORT.table.rows, REPORT.table.totals, false);
    const csv = tableToCsv(REPORT.table.columns, cells);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("Stage,Open deals,Value");
    // The same cells the table shows, with a comma inside a cell quoted.
    expect(lines.slice(1)).toEqual(['Proposal Sent,3,"600,000"', '"Negotiation, late",1,"300,000"', 'Total,4,"900,000"']);
    expect(cells).toHaveLength(REPORT.table.rows.length + 1);
  });

  it("never prints a figure the role may not see", () => {
    const cells = tableCells(REPORT.table.columns, REPORT.table.rows, REPORT.table.totals, true);
    expect(cells.flat().join(" ")).not.toMatch(/600|300|900/);
    expect(cells[0]![2]).toBe("Hidden");
    expect(tableToCsv(REPORT.table.columns, cells)).not.toMatch(/600,000/);
  });

  it("scales bars from the API series and writes the table's own cell beside each", () => {
    const bars = barRows(REPORT);
    expect(bars.map((b) => [b.label, b.text, Math.round(b.width)])).toEqual([["Proposal Sent", "600,000", 100], ["Negotiation", "300,000", 50]]);
  });

  it("shows counts when values are masked and the API names a count series", () => {
    const masked: ReportData = { ...REPORT, valueMasked: true, chart: { ...REPORT.chart, metric: "deals", series: [{ label: "Proposal Sent", value: 3 }, { label: "Negotiation", value: 1 }] } };
    expect(barRows(masked).map((b) => b.text)).toEqual(["3", "1"]);
  });

  it("formats percentages, empties and money consistently", () => {
    expect(formatCell("percent", 40)).toBe("40%");
    expect(formatCell("number", null)).toBe("—");
    expect(formatCell("money", null)).toBe("Hidden");
    expect(formatCell("money", "12.50")).toBe("12.5");
  });

  it("keeps a table of mixed units a table", () => {
    expect(isChartable({ ...REPORT, key: "MONTH_VS_LAST" })).toBe(false);
    expect(isChartable(REPORT)).toBe(true);
    expect(isChartable({ ...REPORT, chart: { ...REPORT.chart, series: [] } })).toBe(false);
  });

  it("counts a range in whole days including today", () => {
    expect(rangeFor("7", new Date("2026-10-19T12:00:00Z"))).toEqual({ dateFrom: "2026-10-13", dateTo: "2026-10-19" });
    expect(rangeFor("30", new Date("2026-10-19T12:00:00Z")).dateFrom).toBe("2026-09-20");
  });
});
