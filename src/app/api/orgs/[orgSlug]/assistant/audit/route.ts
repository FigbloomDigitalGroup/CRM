import { handleRoute } from "@/app/api/_lib/handleRoute";
import { z } from "zod";
import { pageQueryShape, toPageRequest } from "@/app/api/_lib/pageQuery";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveGatedContext } from "@/app/api/_lib/gatedContext";
import { listAssistantAudit } from "@/services/assistantService";

// Management: every question put to the assistant, what it saw (counts), what was neutralised and what it proposed.
export async function GET(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveGatedContext(orgSlug, "release.v11");
    return listAssistantAudit(ctx, toPageRequest(parseQueryParams(new URL(request.url).searchParams, z.object({ ...pageQueryShape }))));
  });
}
