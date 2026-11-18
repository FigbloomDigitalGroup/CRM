import { handleRoute } from "@/app/api/_lib/handleRoute";
import { ValidationError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import { uploadMigrationFile } from "@/services/migrationService";

// Step 2 (upload): multipart with `file`, or the CSV as the raw body with a `?fileName=`. Answers with the headers, the row count and a suggested mapping.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; sessionId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, sessionId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const type = request.headers.get("content-type") ?? "";
    if (type.startsWith("multipart/form-data")) {
      const file = (await request.formData()).get("file");
      if (!(file instanceof File)) throw new ValidationError("A CSV file is required.", [{ path: "file", message: "Choose a CSV file." }]);
      return uploadMigrationFile(ctx, sessionId, { fileName: file.name || "migration.csv", data: Buffer.from(await file.arrayBuffer()) });
    }
    const fileName = new URL(request.url).searchParams.get("fileName") || "migration.csv";
    return uploadMigrationFile(ctx, sessionId, { fileName, data: Buffer.from(await request.arrayBuffer()) });
  });
}
