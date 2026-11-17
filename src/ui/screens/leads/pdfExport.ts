import { parseCsv } from "./csv";

/**
 * PDF export for the record lists (leads, contacts, companies, deals). The PDF is drawn from the CSV the server already produced for this
 * person, so it holds exactly the rows and columns their role may see: the same permission check, scope, masking, row cap, rate limit and
 * audit entry as the CSV. It is a second way to read the same export, never a second export path.
 *
 * Drawn with pdf-lib (plain JavaScript, no fonts to ship), loaded only when somebody asks for a PDF. A4 landscape, a header row on every
 * page, long text cut with "...", page numbers. The standard PDF fonts cover Western European letters; any other character prints as "?".
 */

/** Past this a PDF is unreadable and slow to build in the browser, so the person is pointed at the CSV. */
export const PDF_MAX_ROWS = 1000;

const PAGE_W = 841.89;
const PAGE_H = 595.28;
const MARGIN = 34;
const ROW_H = 15;
const FONT_SIZE = 7.5;
const PAD = 3;

export class PdfExportError extends Error {}

export interface PdfInput {
  title: string;
  /** Under the title: who exported it, when, how many rows. */
  subtitle?: string;
  csv: string;
}

/** The server marks a cell that starts like a formula with a leading apostrophe for spreadsheets; in a PDF there is nothing to protect. */
function plain(cell: string): string {
  return /^'[=+\-@]/.test(cell) ? cell.slice(1) : cell;
}

export async function csvToPdf({ title, subtitle, csv }: PdfInput): Promise<Uint8Array> {
  const [head, ...body] = parseCsv(csv);
  if (!head || head.length === 0) throw new PdfExportError("There is nothing to export.");
  if (body.length === 0) throw new PdfExportError("There are no rows to export.");
  if (body.length > PDF_MAX_ROWS) throw new PdfExportError(`A PDF holds up to ${PDF_MAX_ROWS.toLocaleString("en")} rows and this has ${body.length.toLocaleString("en")}. Narrow the filters, or export it as CSV.`);

  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const supported = new Set(font.getCharacterSet());
  const clean = (s: string) =>
    Array.from(s.replace(/[\r\n\t]+/g, " "))
      .map((ch) => (supported.has(ch.codePointAt(0)!) ? ch : ch === "’" ? "'" : "?"))
      .join("");
  const width = (s: string, f = font) => f.widthOfTextAtSize(s, FONT_SIZE);
  const fit = (s: string, max: number, f = font) => {
    if (width(s, f) <= max) return s;
    let out = s;
    while (out.length > 1 && width(`${out}...`, f) > max) out = out.slice(0, -1);
    return `${out.trimEnd()}...`;
  };

  const header = head.map((h) => clean(h));
  const rows = body.map((r) => header.map((_, i) => clean(plain(r[i] ?? ""))));

  // Column widths: what the content needs (sampled), kept between a floor and a ceiling, then scaled to the page.
  const usable = PAGE_W - MARGIN * 2;
  const sample = rows.slice(0, 200);
  const natural = header.map((h, i) => {
    const longest = Math.max(width(h, bold), ...sample.map((r) => width(r[i]!)));
    return Math.min(Math.max(longest + PAD * 2, 34), 190);
  });
  const total = natural.reduce((a, b) => a + b, 0);
  const scale = usable / total;
  const widths = natural.map((w) => w * scale);

  const dark = rgb(0.13, 0.13, 0.16);
  const grey = rgb(0.42, 0.42, 0.47);
  const bandFill = rgb(0.965, 0.965, 0.975);
  const headFill = rgb(0.9, 0.9, 0.94);

  const perPage = Math.floor((PAGE_H - MARGIN * 2 - 44 - ROW_H) / ROW_H);
  const firstPerPage = perPage;
  const pageCount = Math.max(1, Math.ceil(rows.length / firstPerPage));

  for (let p = 0; p < pageCount; p += 1) {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    let y = PAGE_H - MARGIN;
    page.drawText(clean(title), { x: MARGIN, y: y - 12, size: 14, font: bold, color: dark });
    if (subtitle) page.drawText(clean(subtitle), { x: MARGIN, y: y - 26, size: 8, font, color: grey });
    y -= 44;
    // header row
    page.drawRectangle({ x: MARGIN, y: y - ROW_H, width: usable, height: ROW_H, color: headFill });
    let x = MARGIN;
    header.forEach((h, i) => {
      page.drawText(fit(h, widths[i]! - PAD * 2, bold), { x: x + PAD, y: y - ROW_H + 4.5, size: FONT_SIZE, font: bold, color: dark });
      x += widths[i]!;
    });
    y -= ROW_H;
    rows.slice(p * firstPerPage, (p + 1) * firstPerPage).forEach((r, n) => {
      if (n % 2 === 1) page.drawRectangle({ x: MARGIN, y: y - ROW_H, width: usable, height: ROW_H, color: bandFill });
      let cx = MARGIN;
      r.forEach((cell, i) => {
        if (cell) page.drawText(fit(cell, widths[i]! - PAD * 2), { x: cx + PAD, y: y - ROW_H + 4.5, size: FONT_SIZE, font, color: dark });
        cx += widths[i]!;
      });
      y -= ROW_H;
    });
    page.drawText(`Page ${p + 1} of ${pageCount}`, { x: PAGE_W - MARGIN - 50, y: MARGIN - 14, size: 7.5, font, color: grey });
  }
  doc.setTitle(clean(title));
  doc.setProducer("Figbloom CRM");
  doc.setCreator("Figbloom CRM");
  return doc.save();
}

/** Hands the bytes to the browser as a download. */
export function downloadPdf(filename: string, bytes: Uint8Array) {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The "Leads · exported by Given on 16 Nov 2026 · 42 rows" line under the title. */
export function pdfSubtitle(by: string | null | undefined, csv: string): string {
  const rows = Math.max(parseCsv(csv).length - 1, 0);
  const when = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return `Exported${by ? ` by ${by}` : ""} on ${when}  |  ${rows.toLocaleString("en")} row${rows === 1 ? "" : "s"}`;
}
