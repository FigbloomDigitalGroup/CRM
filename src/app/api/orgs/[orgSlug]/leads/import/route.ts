import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseCsvImportRequest } from "@/app/api/_lib/parseCsvImportRequest";
import { resolveRequestContext } from "@/auth/requestContext";
import { importLeads } from "@/services/importService";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const parsed = await parseCsvImportRequest(request);
    return importLeads(ctx, parsed);
  });
}
