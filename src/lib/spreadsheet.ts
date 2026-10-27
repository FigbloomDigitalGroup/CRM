import ExcelJS from "exceljs";
// Not the exported-CSV writer: this turns an uploaded sheet into the CSV the importer reads, so cell text must stay exactly as typed.
import { stringify } from "csv-stringify/sync";
import { ValidationError } from "../auth/errors";

/**
 * Spreadsheet uploads for the data migration (FIG-1061): the first sheet of an .xlsx file becomes the CSV the rest of the migration
 * reads, so there is one pipeline whatever the source. Limits keep a hostile or enormous workbook from costing more than a CSV would:
 * a size cap, one sheet, 100 columns, and the migration's own row limit. Formulas give their last calculated value, dates become ISO
 * dates, and nothing in the file is ever executed.
 */
export const XLSX_MAX_BYTES = 20 * 1024 * 1024;
const MAX_COLUMNS = 100;

export function isXlsx(fileName: string, data: Buffer): boolean {
  // An .xlsx is a zip archive: "PK" then 0x03 0x04.
  return fileName.toLowerCase().endsWith(".xlsx") && data.length > 4 && data[0] === 0x50 && data[1] === 0x4b;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    const iso = value.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.slice(0, 19).replace("T", " ");
  }
  if (typeof value === "object") {
    const v = value as unknown as Record<string, unknown>;
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue); // formula
    if ("richText" in v && Array.isArray(v.richText)) return (v.richText as { text: string }[]).map((r) => r.text).join("");
    if ("text" in v) return String(v.text ?? ""); // hyperlink
    if ("error" in v) return "";
    return "";
  }
  return String(value);
}

export async function xlsxToCsv(data: Buffer, maxRows: number): Promise<Buffer> {
  if (data.length > XLSX_MAX_BYTES) {
    throw new ValidationError("That spreadsheet is too large (20 MB at most). Save it as CSV, or split it.", [{ path: "file", message: "Too large.", code: "FILE_TOO_LARGE" }]);
  }
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(data as unknown as ExcelJS.Buffer);
  } catch {
    throw new ValidationError("That spreadsheet could not be read. Save it as CSV and try again.", [{ path: "file", message: "Not a readable .xlsx file.", code: "NOT_XLSX" }]);
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new ValidationError("The spreadsheet has no sheets.", [{ path: "file", message: "No sheets." }]);
  const columns = Math.min(sheet.columnCount, MAX_COLUMNS + 1);
  if (sheet.columnCount > MAX_COLUMNS) throw new ValidationError(`At most ${MAX_COLUMNS} columns.`, [{ path: "file", message: `At most ${MAX_COLUMNS} columns.` }]);
  if (sheet.rowCount > maxRows + 1) throw new ValidationError(`At most ${maxRows} rows in one migration. Split the file.`, [{ path: "file", message: `At most ${maxRows} rows.`, code: "TOO_MANY_ROWS" }]);
  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const line: string[] = [];
    for (let c = 1; c <= columns; c += 1) line.push(cellText(row.getCell(c).value));
    rows.push(line);
  });
  return Buffer.from(stringify(rows));
}
