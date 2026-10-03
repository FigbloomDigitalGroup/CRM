import { parse } from "csv-parse";
import { parse as parseSync } from "csv-parse/sync";
import { stringify } from "csv-stringify";
import type { Readable } from "node:stream";

/**
 * Streams a CSV file row-by-row as objects keyed by the file's own header
 * row (`columns: true`) -- memory stays bounded by one row at a time
 * regardless of file size, which is what makes large imports safe without
 * a job queue (FIG-596). Column mapping (CRM field -> CSV header name) is
 * then just `row[csvHeaderName]` at the call site.
 */
export function parseCsvRows(
  input: Readable,
): AsyncIterable<Record<string, string>> {
  return input.pipe(
    parse({
      columns: true,
      bom: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    }),
  );
}

/** First line only, split naively on commas -- good enough to list the
 * available headers for a column-mapping UI without parsing the whole file. */
export function parseCsvHeaderLine(firstLine: string): string[] {
  const rows = parseSync(firstLine, { columns: false, trim: true }) as string[][];
  return rows[0] ?? [];
}

/**
 * Builds a streaming CSV Response body: rows are pulled from `source`
 * (an async generator) and written out incrementally, so the HTTP response
 * starts flowing before the whole export is serialized -- no single giant
 * in-memory string regardless of row count (FIG-596, "large files handled
 * without timeouts").
 */
export function csvResponseStream(
  columns: string[],
  rows: AsyncIterable<Record<string, unknown>>,
): ReadableStream<Uint8Array> {
  const stringifier = stringify({ header: true, columns });

  (async () => {
    try {
      for await (const row of rows) {
        if (!stringifier.write(row)) {
          await new Promise((resolve) => stringifier.once("drain", resolve));
        }
      }
      stringifier.end();
    } catch (err) {
      stringifier.destroy(err as Error);
    }
  })();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      stringifier.on("data", (chunk: Buffer) => controller.enqueue(chunk));
      stringifier.on("end", () => controller.close());
      stringifier.on("error", (err) => controller.error(err));
    },
    cancel() {
      stringifier.destroy();
    },
  });
}
