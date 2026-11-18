/**
 * The pure part of the Reports screen (F3.07): how a report from the API becomes the table, the chart rows and the CSV a person sees.
 * One function builds the table and another the chart from the same rows, so a chart and its table can never disagree, and the CSV is the
 * table as shown (headings as labels, the totals row last), so a downloaded file always matches the screen.
 */

export type ColumnType = "text" | "number" | "percent" | "money" | string;

export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
}
export type ReportRow = Record<string, unknown>;

export interface ReportData {
  key: string;
  title: string;
  definition: string;
  valueMasked: boolean;
  chart: { type: "bar" | "donut"; metric: string; fallbackMetric?: string; series: { label: string; value: number | null }[] };
  table: { columns: ReportColumn[]; rows: ReportRow[]; totals: ReportRow | null };
}

/** The text of one cell. A money cell the role may not see is "Hidden", never a figure and never a dash that hides that something is there. */
export function formatCell(col: ColumnType, value: unknown, masked = false): string {
  if (col === "money") {
    if (masked || value === null || value === undefined) return "Hidden";
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : "Hidden";
  }
  if (value === null || value === undefined || value === "") return "—";
  if (col === "percent") return `${value}%`;
  if (col === "number") {
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString("en-US") : String(value);
  }
  return String(value);
}

/** The cells of the visible table, in order: the rows, then the totals row when there is one. */
export function tableCells(columns: ReportColumn[], rows: ReportRow[], totals: ReportRow | null, masked: boolean): string[][] {
  const line = (r: ReportRow) => columns.map((c) => formatCell(c.type, r[c.key], masked));
  return [...rows.map(line), ...(totals ? [line(totals)] : [])];
}

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** The CSV of what is on screen: the column labels, then exactly the cells the table shows. */
export function tableToCsv(columns: ReportColumn[], cells: string[][]): string {
  return [columns.map((c) => csvCell(c.label)), ...cells.map((r) => r.map(csvCell))].map((r) => r.join(",")).join("\r\n") + "\r\n";
}

export interface BarRow {
  label: string;
  /** 0 to 100, the bar's width. */
  width: number;
  /** The figure written beside the bar, formatted like the table's cell. */
  text: string;
  value: number;
}

/**
 * The bars of a report's chart. The series comes from the API (already the table's rows); the text beside each bar is the table's own cell
 * for that measure. When values are masked the API names a fallback measure (a count), so the bars show counts rather than nothing.
 */
export function barRows(report: ReportData): BarRow[] {
  const { chart, table, valueMasked } = report;
  const metric = chart.metric;
  const col = table.columns.find((c) => c.key === metric);
  const masked = valueMasked && col?.type === "money";
  const series = chart.series;
  const max = Math.max(0, ...series.map((s) => Number(s.value ?? 0)));
  return series.map((s) => {
    const v = Number(s.value ?? 0);
    return {
      label: s.label,
      value: v,
      width: max > 0 ? Math.max(2, (v / max) * 100) : 0,
      text: formatCell(col?.type ?? "number", s.value, masked),
    };
  });
}

/** One sentence for a screen reader, read in place of the picture. */
export function chartSummary(title: string, rows: BarRow[]): string {
  return rows.length === 0 ? `${title}: no data in this range.` : `${title}: ${rows.map((r) => `${r.label} ${r.text}`).join(", ")}.`;
}

/** A chart is only drawn for a measure that is comparable across rows: a table of mixed units (this month against last) stays a table. */
export function isChartable(report: ReportData): boolean {
  if (report.key === "MONTH_VS_LAST") return false;
  return report.chart.series.length > 0;
}

/** The preset ranges, as the design's period control offers them. */
export const PERIODS = [
  { id: "7", label: "Last 7 days", days: 7 },
  { id: "30", label: "Last 30 days", days: 30 },
  { id: "90", label: "Last 90 days", days: 90 },
  { id: "365", label: "Last 12 months", days: 365 },
] as const;
export type PeriodId = (typeof PERIODS)[number]["id"];

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Whole days inclusive of today: "last 7 days" is today and the six before it. */
export function rangeFor(period: PeriodId, now: Date = new Date()): { dateFrom: string; dateTo: string } {
  const days = PERIODS.find((p) => p.id === period)!.days;
  return { dateFrom: isoDay(new Date(now.getTime() - (days - 1) * 86_400_000)), dateTo: isoDay(now) };
}

export function percentOf(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 100) : 0;
}
