import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import {
  getWebsiteAssignmentSetting,
  setWebsiteAssignmentSetting,
} from "@/services/integrationService";

const SetAssignmentModeSchema = z.object({
  mode: z.enum(["ROUND_ROBIN", "UNASSIGNED"], {
    message: 'mode must be "ROUND_ROBIN" or "UNASSIGNED".',
  }),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return getWebsiteAssignmentSetting(ctx);
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, SetAssignmentModeSchema);
    return setWebsiteAssignmentSetting(ctx, body.mode);
  });
}
