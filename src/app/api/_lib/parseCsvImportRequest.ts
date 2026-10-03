import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { ValidationError } from "@/auth/errors";
import {
  assertCsvRequestSize,
  type DuplicateStrategy,
} from "@/services/importService";

/** Shared multipart-form parsing for the three CSV import routes (companies/contacts/leads). */
export async function parseCsvImportRequest(request: Request) {
  assertCsvRequestSize(
    request.headers.get("content-length")
      ? Number(request.headers.get("content-length"))
      : null,
  );

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    throw new ValidationError("A CSV file is required.");
  }

  const mappingRaw = form.get("mapping");
  let mapping: Record<string, string | undefined> = {};
  if (typeof mappingRaw === "string") {
    try {
      mapping = JSON.parse(mappingRaw);
    } catch {
      throw new ValidationError("mapping must be valid JSON.");
    }
  }

  const duplicateStrategy: DuplicateStrategy =
    form.get("duplicateStrategy") === "create" ? "create" : "skip";

  return {
    fileStream: Readable.fromWeb(file.stream() as NodeWebReadableStream),
    mapping,
    duplicateStrategy,
  };
}
