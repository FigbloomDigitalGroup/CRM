import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { undoMyReset } from "@/services/preferenceService";

const UndoSchema = z.strictObject({ token: z.string({ error: "The undo token is required." }).min(1) });

export async function POST(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const body = await parseJsonBody(request, UndoSchema);
    return undoMyReset(ctx, body.token);
  });
}
