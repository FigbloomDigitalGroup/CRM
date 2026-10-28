import { resolveRequestContext } from "@/auth/requestContext";
import { recordPageView } from "@/services/pageViewService";
import { ReportsScreen } from "@/ui/screens/reports/ReportsScreen";

/**
 * F3.07: Reports (R1). The page is only the frame: it records the view and hands over to the screen, which reads the reporting API.
 * Management gets the organisation reports, roles that see only their own work get My metrics, and a role with no reporting permission gets the
 * explained no-access state.
 */
export default async function ReportsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await resolveRequestContext(orgSlug);
  await recordPageView(ctx, "reports");
  return <ReportsScreen />;
}
