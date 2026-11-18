import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveGatedContext } from "@/app/api/_lib/gatedContext";
import { ValidationError } from "@/auth/errors";
import { listChurnHints } from "@/services/churnHintService";

const STATUSES = ["OPEN", "DISMISSED", "RESOLVED"] as const;

// Churn hints for account owners (FIG-1190, B7.08, design X2 and E2): what was seen and why, only the reasons the caller may see. V2; needs ai.use.
export async function GET(request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveGatedContext(orgSlug, "release.v2");
    const q = new URL(request.url).searchParams;
    const status = q.get("status");
    if (status && !(STATUSES as readonly string[]).includes(status)) throw new ValidationError(`status must be one of ${STATUSES.join(", ")}.`);
    return listChurnHints(ctx, {
      status: (status as (typeof STATUSES)[number] | null) ?? undefined,
      companyId: q.get("companyId") ?? undefined,
      mine: q.get("mine") === "true",
    });
  });
}
