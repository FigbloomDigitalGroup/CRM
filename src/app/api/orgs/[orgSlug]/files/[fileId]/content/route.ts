import { handleCsvRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { INLINE_PURPOSES } from "@/storage/policy";
import { readFileContent } from "@/services/fileService";

// The bytes, served through the session so every request is authorised and
// status-checked (an avatar in an <img> uses this; downloads use signed links).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; fileId: string }> },
) {
  return handleCsvRoute(async () => {
    const { orgSlug, fileId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const { file, data } = await readFileContent(ctx, fileId);
    const inline = INLINE_PURPOSES.includes(file.purpose);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Length": String(data.length),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=300",
      },
    });
  });
}
