import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { parseVersionParam } from "@/app/api/_lib/quoteSchemas";
import { NotFoundError } from "@/auth/errors";
import { resolveRequestContext } from "@/auth/requestContext";
import { recordQuoteResponse } from "@/services/quoteService";

const ResponseSchema = z.strictObject({
  outcome: z.enum(["ACCEPTED", "DECLINED"], { error: "outcome must be ACCEPTED or DECLINED." }),
  note: z.string().optional(),
});

// A person records the client answer to a sent version (FIG-1143, B6.11). E-signature is V2.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string; quoteId: string; version: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug, quoteId, version } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    const n = parseVersionParam(version);
    if (!n) throw new NotFoundError("QuoteVersion", `${quoteId}/${version}`);
    return recordQuoteResponse(ctx, quoteId, n, await parseJsonBody(request, ResponseSchema));
  });
}
