import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { startConnection } from "@/services/oauthConnectionService";

const StartSchema = z.strictObject({
  kind: z.string(),
  provider: z.string(),
  /** Management only: the shared organisation mailbox or calendar. */
  shared: z.boolean().optional(),
  loginHint: z.string().max(200).optional(),
});

// Begins connecting a Google or Microsoft account (FIG-1153): returns the provider's sign-in address.
export async function POST(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return startConnection(ctx, await parseJsonBody(request, StartSchema));
  });
}
