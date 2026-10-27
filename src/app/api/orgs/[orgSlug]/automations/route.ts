import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { listAutomationRules } from "@/services/automationService";

// Settings > Automations (FIG-1059, B4.02, S5): every rule with its switch, thresholds, audience and recent runs. Management only.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  return handleRoute(async () => {
    const { orgSlug } = await params;
    const ctx = await resolveRequestContext(orgSlug);
    return listAutomationRules(ctx);
  });
}
