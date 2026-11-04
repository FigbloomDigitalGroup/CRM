import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { listOrganisationDataRequests, submitOrganisationDataRequest } from "@/services/privacyService";

const Schema = z.strictObject({ kind: z.enum(["EXPORT", "DELETE"], { error: "kind must be EXPORT or DELETE." }), note: z.string().optional() });

// Ask for the whole organisation's data to be exported, or the organisation deleted. Handed to the platform queue (B6.09); nothing happens here.
// Also reachable while the organisation is being offboarded (B6.05), so Management can follow the request.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> } ,
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug, undefined, { allowOffboarding: true });
    return listOrganisationDataRequests(ctx);
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> } ,
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug, undefined, { allowOffboarding: true });
    return submitOrganisationDataRequest(ctx, await parseJsonBody(request, Schema));
  });
}
