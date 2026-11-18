import { toCsv } from "./csv";

/**
 * Excel import for the lead, contact and company wizards (FIG-1680 follow-up). A .xlsx file is turned into CSV text in the browser, and from
 * there the wizards do exactly what they did for a CSV: map the columns, send the rows to the same validated import route, with the same
 * duplicate handling and permission checks. Nothing new reaches the server, so an Excel file can never do more than a CSV could.
 *
 * The workbook reader is loaded only when somebody chooses an .xlsx file, so the screens' first load does not carry it.
 */

/** What the file pickers accept. */
export const SHEET_ACCEPT = ".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const SHEET_LABEL = "CSV or Excel (.xlsx)";

const MAX_COLUMNS = 100;
const MAX_ROWS = 50_000;
/** An .xlsx is a zip, so a 25 MB file can hold far more once opened; this is the compressed size the wizards already allow. */
export const SHEET_MAX_BYTES = 25 * 1024 * 1024;

export class SheetError extends Error {
  constructor(
    readonly code: "OLD_EXCEL" | "NOT_XLSX" | "NO_SHEET" | "TOO_WIDE" | "TOO_LONG",
    message: string,
  ) {
    super(message);
  }
}

export function isXlsxName(name: string | undefined): boolean {
  return /\.xlsx$/i.test(name ?? "");
}

const readText = (file: Blob): Promise<string> =>
  typeof file.text === "function"
    ? file.text()
    : new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result ?? ""));
        r.onerror = () => reject(r.error);
        r.readAsText(file);
      });

const readBuffer = (file: Blob): Promise<ArrayBuffer> =>
  typeof file.arrayBuffer === "function"
    ? file.arrayBuffer()
    : new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as ArrayBuffer);
        r.onerror = () => reject(r.error);
        r.readAsArrayBuffer(file);
      });

/** One cell as the text a person sees: a formula gives its last result, a date is ISO, rich text and links give their words. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    const iso = value.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.slice(0, 19).replace("T", " ");
  }
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if ("result" in v) return cellText(v.result);
    if ("richText" in v && Array.isArray(v.richText)) return (v.richText as { text?: string }[]).map((r) => r.text ?? "").join("");
    if ("text" in v) return String(v.text ?? "");
    return "";
  }
  return String(value).trim();
}

/**
 * Finds the table inside a sheet that has a title, a summary band or notes above it (a "dashboard" style sheet: a heading, four totals, then
 * the real column names). The header row is the one with the most different text cells among the first 40 rows; a number is not a column
 * name, so a row of totals never wins. If the first row is nearly as wide as the winner it stays the header, so an ordinary sheet is read
 * exactly as before. Columns with no name are dropped, because nothing can be mapped to them.
 */
export function trimToTable(rows: string[][]): string[][] {
  if (rows.length < 2) return rows;
  const score = (r: string[]) => new Set(r.filter((c) => c !== "" && !/^[\d\s.,+\-:/%]+$/.test(c)).map((c) => c.toLowerCase())).size;
  const limit = Math.min(rows.length - 1, 40);
  let best = 0;
  let bestScore = score(rows[0]!);
  for (let i = 1; i < limit; i += 1) {
    const s = score(rows[i]!);
    if (s > bestScore) {
      best = i;
      bestScore = s;
    }
  }
  if (best !== 0 && score(rows[0]!) >= 0.7 * bestScore) best = 0;
  const table = rows.slice(best);
  const keep = table[0]!.map((h, i) => (h !== "" ? i : -1)).filter((i) => i >= 0);
  return keep.length === 0 ? table : table.map((r) => keep.map((i) => r[i] ?? ""));
}

/** The first sheet of a workbook as CSV text. Throws a SheetError the wizards turn into a plain message. */
export async function xlsxToCsvText(file: Blob): Promise<string> {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load((await readBuffer(file)) as never);
  } catch {
    throw new SheetError("NOT_XLSX", "That Excel file could not be read. Save it again as .xlsx or as CSV and try again.");
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new SheetError("NO_SHEET", "The Excel file has no sheets.");
  if (sheet.columnCount > MAX_COLUMNS) throw new SheetError("TOO_WIDE", `The sheet has more than ${MAX_COLUMNS} columns.`);
  if (sheet.rowCount > MAX_ROWS) throw new SheetError("TOO_LONG", `The sheet has more than ${MAX_ROWS.toLocaleString("en")} rows. Split it into smaller files.`);
  const columns = Math.max(sheet.columnCount, 1);
  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const line: string[] = [];
    for (let c = 1; c <= columns; c += 1) line.push(cellText(row.getCell(c).value));
    if (line.some((cell) => cell !== "")) rows.push(line);
  });
  return toCsv(trimToTable(rows));
}

/** The text of a chosen file as CSV, whether it is a CSV or an Excel workbook. */
export async function readSheetText(file: Blob & { name?: string }): Promise<string> {
  if (isXlsxName(file.name)) return xlsxToCsvText(file);
  if (/\.xls$/i.test(file.name ?? "")) throw new SheetError("OLD_EXCEL", "Old Excel files (.xls) are not supported. Open it in Excel and save it as .xlsx or CSV.");
  return readText(file);
}

/** A sentence for a failed read, for the wizard to show. */
export function sheetProblem(err: unknown): string | null {
  return err instanceof SheetError ? err.message : null;
}
