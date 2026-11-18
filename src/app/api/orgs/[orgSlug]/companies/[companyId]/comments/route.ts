import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { addComment, listComments } from "@/services/commentService";

// Comments on one company (FIG-1044): anyone who can open the record can read and write them.
// `mentions` are member ids; only people who can open the record may be mentioned.
const AddCommentSchema = z.strictObject({
  body: z.string({ error: "body is required." }),
  mentions: z.array(z.string()).max(20).optional(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; companyId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, companyId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return listComments(ctx, "company", companyId);
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; companyId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, companyId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, AddCommentSchema);
    return addComment(ctx, "company", companyId, body);
  });
}
