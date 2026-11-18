import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { deleteComment, editComment } from "@/services/commentService";

// Edit (author only) or delete (author or Management) a comment; both are soft (FIG-1044).
const EditCommentSchema = z.strictObject({
  body: z.string({ error: "body is required." }),
  mentions: z.array(z.string()).max(20).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; commentId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, commentId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, EditCommentSchema);
    return editComment(ctx, commentId, body);
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string; commentId: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, commentId } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return deleteComment(ctx, commentId);
  });
}
