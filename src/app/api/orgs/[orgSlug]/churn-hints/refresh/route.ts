import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveGatedContext } from "@/app/api/_lib/gatedContext";
import { refreshChurnHintsNow } from "@/services/churnHintService";

// Looks at the organisation's customers again now (the nightly job does the same). Needs the assistant and its churn option on.
export async function POST(_request: Request, { params }: { params: Promise<{ orgSlug: string }> }) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    return refreshChurnHintsNow(await resolveGatedContext(orgSlug, "release.v2"));
  });
}
