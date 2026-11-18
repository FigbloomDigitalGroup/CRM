import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getRunDownload } from "@/services/dataRunService";

// A short-lived signed link to the export (`which=result`) or the import error report (`which=errors`).
const QuerySchema = z.object({ which: z.enum(["result", "errors"]).default("result") });

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; runId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, runId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, QuerySchema);
    const { file, download } = await getRunDownload(ctx, runId, query.which);
    return { fileName: file.name, download };
  });
}
