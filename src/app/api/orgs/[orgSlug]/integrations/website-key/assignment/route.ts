import { handleRoute } from "@/app/api/_lib/handleRoute";
import { ValidationError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import {
  getWebsiteAssignmentSetting,
  setWebsiteAssignmentSetting,
} from "@/services/integrationService";

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
    const body = (await request.json()) as { mode?: string };
    if (body.mode !== "ROUND_ROBIN" && body.mode !== "UNASSIGNED") {
      throw new ValidationError('mode must be "ROUND_ROBIN" or "UNASSIGNED".');
    }
    return setWebsiteAssignmentSetting(ctx, body.mode);
  });
}
