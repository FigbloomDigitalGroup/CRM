import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getReportSettings, updateReportSettings } from "@/services/customerReportService";

// The organisation's default dormancy threshold (FIG-793).
const UpdateSchema = z.object({ dormancyDays: z.number() });

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    return getReportSettings(await resolveRequestContext(orgSlug));
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return updateReportSettings(ctx, await parseJsonBody(request, UpdateSchema));
  });
}
