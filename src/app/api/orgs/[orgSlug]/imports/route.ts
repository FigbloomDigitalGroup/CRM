import { handleRoute } from "@/app/api/_lib/handleRoute";
import { ValidationError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import { startImport } from "@/services/dataRunService";

// Starts a background import (FIG-1034): multipart with `entity` (LEAD, CONTACT or COMPANY), `file`,
// `mapping` (JSON, CRM field to CSV header) and `duplicateStrategy` (skip or create). Answers at once
// with the run; watch it under /data-runs/{id}. `tags` and `cf:<key>` columns are read as they are.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ValidationError("A CSV file is required.", [{ path: "file", message: "Choose a CSV file." }]);
    const entity = String(form.get("entity") ?? "").toUpperCase();
    if (entity !== "LEAD" && entity !== "CONTACT" && entity !== "COMPANY") {
      throw new ValidationError("Choose what to import.", [{ path: "entity", message: "Use LEAD, CONTACT or COMPANY." }]);
    }
    let mapping: Record<string, string | undefined> = {};
    const raw = form.get("mapping");
    if (typeof raw === "string" && raw.trim()) {
      try {
        mapping = JSON.parse(raw);
      } catch {
        throw new ValidationError("mapping must be valid JSON.", [{ path: "mapping", message: "Not valid JSON." }]);
      }
    }
    return startImport(ctx, {
      entity,
      fileName: file.name || "import.csv",
      csv: Buffer.from(await file.arrayBuffer()),
      mapping,
      duplicateStrategy: form.get("duplicateStrategy") === "create" ? "create" : "skip",
    });
  });
}
