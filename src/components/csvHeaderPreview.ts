/**
 * Browser-only header-row parser for the import column-mapping UI -- reads
 * just the first ~64KB of the file (never the whole thing, however large)
 * and splits its first line, RFC4180-quote-aware. The full file is parsed
 * for real server-side (see `src/lib/csv.ts`); this only needs to be good
 * enough to populate the mapping dropdowns.
 */
export async function parseCsvHeaderLineBrowser(file: File): Promise<string[]> {
  const sample = await file.slice(0, 64 * 1024).text();
  const firstLine = sample.split(/\r\n|\r|\n/)[0] ?? "";

  const headers: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < firstLine.length; i++) {
    const ch = firstLine[i];
    if (inQuotes) {
      if (ch === '"' && firstLine[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      headers.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  headers.push(current.trim());
  return headers.filter((h) => h.length > 0);
}
