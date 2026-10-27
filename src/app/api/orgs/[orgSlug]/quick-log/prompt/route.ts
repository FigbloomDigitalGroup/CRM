import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseQueryParams } from "@/app/api/_lib/validation";
import { resolveRequestContext } from "@/auth/requestContext";
import { getQuickLogPrompt } from "@/services/quickLogService";

const QuerySchema = z.object({
  contactId: z.string().optional(),
  leadId: z.string().optional(),
  companyId: z.string().optional(),
  dealId: z.string().optional(),
});

// What the call or WhatsApp prompt needs: the number to dial and its links, or `code: NO_PHONE_ON_FILE` (FIG-1054).
export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const query = parseQueryParams(new URL(request.url).searchParams, QuerySchema);
    return getQuickLogPrompt(ctx, query);
  });
}
