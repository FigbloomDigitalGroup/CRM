import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveGatedContext } from "@/app/api/_lib/gatedContext";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { decideSupportAccess } from "@/services/supportAccessService";

const Body = z.strictObject({
  decision: z.enum(["approve", "deny"], { error: "decision must be approve or deny." }),
  note: z.string().optional(),
});

/** Approve or deny a waiting support request (OS2). Management. Approving opens nothing: the platform admin opens the session. FIG-1183 (V2). */
export async function POST(request: Request, { params }: { params: Promise<{ orgSlug: string; grantId: string }> }) {
  return handleRoute(async () => {
    const p = await params;
    const ctx = await resolveGatedContext(p.orgSlug, "release.v2");
    const body = await parseJsonBody(request, Body);
    return decideSupportAccess(ctx, p.grantId, body.decision, body.note);
  });
}
