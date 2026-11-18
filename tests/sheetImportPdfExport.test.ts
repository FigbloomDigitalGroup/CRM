import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { parseCsv } from "../src/ui/screens/leads/csv";
import { csvToPdf, PDF_MAX_ROWS, PdfExportError, pdfSubtitle } from "../src/ui/screens/leads/pdfExport";
import { guessMapping } from "../src/ui/screens/leads/columnGuess";
import { cellText, isXlsxName, readSheetText, SheetError, SHEET_ACCEPT, trimToTable } from "../src/ui/screens/leads/sheet";

/**
 * Excel import and PDF export for the lead, contact and company lists (FIG-1680 follow-up, requested by Sales). Both run in the browser on
 * top of the existing CSV paths: an .xlsx is turned into the CSV text the import wizards already read, and a PDF is drawn from the CSV the
 * server already produced for that role. So the permission, scope, masking and duplicate rules stay the ones the CSV path has, and these tests
 * cover the two conversions themselves.
 */

async function workbook(build: (sheet: ExcelJS.Worksheet, wb: ExcelJS.Workbook) => void): Promise<File> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Leads");
  build(sheet, wb);
  const buffer = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  return new File([buffer], "leads.xlsx");
}

describe("Excel import: .xlsx becomes the CSV text the wizards read", () => {
  it("reads the first sheet, header row first, into rows a wizard can map", async () => {
    const file = await workbook((s) => {
      s.addRow(["Name", "Phone", "Email", "Source"]);
      s.addRow(["Acme Ltd", "+254700000001", "hello@acme.co", "Website"]);
      s.addRow(["Baraka, Sons", "0711 222 333", "", "Referral"]);
    });
    const rows = parseCsv(await readSheetText(file));
    expect(rows).toEqual([
      ["Name", "Phone", "Email", "Source"],
      ["Acme Ltd", "+254700000001", "hello@acme.co", "Website"],
      ["Baraka, Sons", "0711 222 333", "", "Referral"],
    ]);
  });

  it("keeps a comma, a quote and a line break inside a cell in one cell", async () => {
    const file = await workbook((s) => {
      s.addRow(["Name", "Notes"]);
      s.addRow(["Kamau", 'Said "call back", then\nlater'], );
    });
    expect(parseCsv(await readSheetText(file))[1]).toEqual(["Kamau", 'Said "call back", then\nlater']);
  });

  it("gives a formula's calculated value, a date as an ISO date, numbers as typed and skips blank rows", async () => {
    const file = await workbook((s) => {
      s.addRow(["Name", "Value", "Follow up", "Total"]);
      s.addRow(["A", 1200, new Date(Date.UTC(2026, 10, 20)), { formula: "B2*2", result: 2400 }]);
      s.addRow([]);
      s.addRow(["B", 15.5, new Date(Date.UTC(2026, 10, 21, 9, 30)), { formula: "B3*2", result: 31 }]);
    });
    expect(parseCsv(await readSheetText(file))).toEqual([
      ["Name", "Value", "Follow up", "Total"],
      ["A", "1200", "2026-11-20", "2400"],
      ["B", "15.5", "2026-11-21 09:30:00", "31"],
    ]);
  });

  it("reads rich text and hyperlink cells as their words", () => {
    expect(cellText({ richText: [{ text: "Hello " }, { text: "world" }] })).toBe("Hello world");
    expect(cellText({ text: "site", hyperlink: "https://example.com" })).toBe("site");
    expect(cellText(null)).toBe("");
    expect(cellText({ error: "#REF!" })).toBe("");
  });

  it("passes a plain CSV through untouched", async () => {
    const text = "name,phone\r\nAcme,+254700000001\r\n";
    expect(await readSheetText(new File([text], "leads.csv"))).toBe(text);
  });

  it("says plainly when a file that claims to be Excel is not", async () => {
    const bad = new File(["this is not a zip"], "leads.xlsx");
    await expect(readSheetText(bad)).rejects.toMatchObject({ code: "NOT_XLSX" });
    await expect(readSheetText(bad)).rejects.toBeInstanceOf(SheetError);
  });

  it("explains the old .xls format instead of mis-reading it", async () => {
    await expect(readSheetText(new File(["x"], "leads.xls"))).rejects.toMatchObject({ code: "OLD_EXCEL" });
  });

  it("refuses a sheet with more than 100 columns", async () => {
    const file = await workbook((s) => {
      s.addRow(Array.from({ length: 101 }, (_, i) => `c${i}`));
    });
    await expect(readSheetText(file)).rejects.toMatchObject({ code: "TOO_WIDE" });
  });

  it("offers .xlsx in the file pickers, and recognises the name case-insensitively", () => {
    expect(SHEET_ACCEPT).toContain(".xlsx");
    expect(SHEET_ACCEPT).toContain(".csv");
    expect(isXlsxName("Leads.XLSX")).toBe(true);
    expect(isXlsxName("leads.csv")).toBe(false);
  });
});

describe("Excel import: a sheet with a title and a summary band above the table", () => {
  it("finds the real header row and drops the rows above it", async () => {
    const file = await workbook((s) => {
      s.getCell("B2").value = "Schools Outreach CRM";
      s.getCell("B4").value = "Outreach Target";
      s.mergeCells("B4:C4");
      s.getCell("D4").value = "Schools Logged";
      s.getCell("B5").value = 20;
      s.mergeCells("B5:C5");
      s.getCell("D5").value = 0;
      s.getRow(8).values = [undefined, "School Name", "Email Address", "Phone Number", "Urgency Level"];
      s.getRow(12).values = [undefined, "Rockside academy", "info@rocksideacademy.sc.ke", "254 734 808 355", "Medium"];
      s.getRow(13).values = [undefined, "Tassia School", "info@tassiaschool.co.ke", "254 722 603 400", "High"];
    });
    const rows = parseCsv(await readSheetText(file));
    expect(rows[0]).toEqual(["School Name", "Email Address", "Phone Number", "Urgency Level"]);
    expect(rows).toHaveLength(3);
    expect(rows[1]![0]).toBe("Rockside academy");
  });

  it("leaves an ordinary sheet alone: the first row stays the header", () => {
    const rows = [["name", "phone", "email"], ["Acme", "+254700000001", "a@acme.co"], ["Baraka", "+254700000002", "b@baraka.co"]];
    expect(trimToTable(rows)).toEqual(rows);
  });

  it("drops columns that have no heading, since nothing can be mapped to them", () => {
    const rows = [["name", "phone", ""], ["Acme", "+254700000001", "Nairobi"]];
    expect(trimToTable(rows)[0]).toEqual(["name", "phone"]);
  });
});

describe("Import wizards: columns are matched by name, loosely", () => {
  const fields = [
    { key: "company", label: "Company or person", synonyms: ["name", "company", "school", "schoolname"] },
    { key: "contactEmail", label: "Email", synonyms: ["email", "emailaddress"] },
    { key: "contactPhone", label: "Phone", synonyms: ["phone", "phonenumber"] },
    { key: "contactName", label: "Person's name (optional)", synonyms: ["contactperson", "contactname"] },
    { key: "temperature", label: "Temperature", synonyms: ["temperature", "urgency", "urgencylevel"] },
    { key: "notes", label: "Notes", synonyms: ["notes", "feedback", "clientfeedback"] },
  ];

  it("maps School Name, Email Address, Phone Number, Urgency Level and Client Feedback", () => {
    expect(guessMapping(fields, ["School Name", "Email Address", "Phone Number", "Date Contacted", "Contact Method", "Urgency Level", "Client Feedback", "Follow-up"])).toEqual({
      company: "School Name",
      contactEmail: "Email Address",
      contactPhone: "Phone Number",
      temperature: "Urgency Level",
      notes: "Client Feedback",
    });
  });

  it("prefers an exact header, and uses a column for one field only", () => {
    const m = guessMapping(fields, ["Contact Person Name", "Company", "Email"]);
    expect(m.company).toBe("Company");
    expect(m.contactEmail).toBe("Email");
    expect(m.contactName).toBe("Contact Person Name");
  });

  it("does not match on a short word by accident", () => {
    expect(guessMapping(fields, ["ID", "No", "Region"])).toEqual({});
  });
});

async function pageCount(bytes: Uint8Array): Promise<number> {
  return (await PDFDocument.load(bytes)).getPageCount();
}

const csvOf = (rows: string[][]) => rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\r\n");

describe("PDF export: drawn from the CSV the server produced for this role", () => {
  it("builds a real PDF from a list", async () => {
    const csv = csvOf([["Name", "Phone", "Owner"], ["Acme Ltd", "+254700000001", "Given Sales"], ["Baraka Sons", "+254711222333", "Given Sales"]]);
    const bytes = await csvToPdf({ title: "Leads", subtitle: "Exported", csv });
    expect(Buffer.from(bytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");
    expect(await pageCount(bytes)).toBe(1);
  });

  it("starts a new page with the header again when the rows run past one page", async () => {
    const rows = [["Name", "Phone"], ...Array.from({ length: 100 }, (_, i) => [`Lead ${i}`, `+2547000${String(i).padStart(5, "0")}`])];
    expect(await pageCount(await csvToPdf({ title: "Leads", csv: csvOf(rows) }))).toBeGreaterThan(1);
  });

  it("copes with long text, many columns, and characters the standard PDF font cannot draw", async () => {
    const header = Array.from({ length: 24 }, (_, i) => `Column ${i}`);
    const row = header.map((_, i) => (i === 0 ? "x".repeat(400) : i === 1 ? "Wanjiku 你好 ’s café ✓" : `v${i}`));
    const bytes = await csvToPdf({ title: "Wide", csv: csvOf([header, row]) });
    expect(await pageCount(bytes)).toBe(1);
  });

  it("shows a cell the CSV protected with a leading apostrophe as the text it was", async () => {
    // The CSV guard writes '=SUM(1) so a spreadsheet will not run it. A PDF cannot run anything, so it prints the original.
    const csv = csvOf([["Name"], ["'=HYPERLINK(\"x\")"], ["'-note"], ["O'Brien"]]);
    const bytes = await csvToPdf({ title: "Leads", csv });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });

  it("refuses an empty export with a clear message", async () => {
    await expect(csvToPdf({ title: "Leads", csv: "" })).rejects.toBeInstanceOf(PdfExportError);
    await expect(csvToPdf({ title: "Leads", csv: "Name,Phone\r\n" })).rejects.toThrow(/no rows/);
  });

  it("points a big list to the CSV instead of building a huge PDF", async () => {
    const rows = [["Name"], ...Array.from({ length: PDF_MAX_ROWS + 1 }, (_, i) => [`Lead ${i}`])];
    await expect(csvToPdf({ title: "Leads", csv: csvOf(rows) })).rejects.toThrow(/export it as CSV/);
  });

  it("writes who exported it and how many rows", () => {
    const line = pdfSubtitle("Given Sales", "Name\r\nA\r\nB\r\n");
    expect(line).toContain("by Given Sales");
    expect(line).toContain("2 rows");
    expect(pdfSubtitle(null, "Name\r\nA\r\n")).toContain("1 row");
  });
});
