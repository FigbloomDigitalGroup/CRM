import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { pageQueryShape, toPageRequest } from "@/app/api/_lib/pageQuery";
import { parseJsonBody, parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { withIdempotency } from "@/lib/idempotency";
import { createDataSubjectRequest, listDataSubjectRequests } from "@/services/privacyService";

const Create = z.strictObject({ kind: z.string({ error: "kind is required." }), contactId: z.string({ error: "contactId is required." }), evidenceNotes: z.string().optional(), dueOn: z.string().optional() });
const List = z.object({ status: z.string().optional(), kind: z.string().optional(), overdue: z.enum(["true", "false"]).optional(), ...pageQueryShape });

// Data-subject requests (access, rectification, erasure) with status, due date and evidence notes.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> } ,
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, List);
    return listDataSubjectRequests(ctx, { status: query.status, kind: query.kind, overdue: query.overdue === "true", paging: toPageRequest(query) });
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> } ,
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, Create);
    return withIdempotency(ctx, request, body, () => createDataSubjectRequest(ctx, body));
  });
}
