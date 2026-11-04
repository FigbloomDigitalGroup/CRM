import { schedulePageView } from "@/services/pageViewService";
import { DealsScreen } from "@/ui/screens/deals/DealsScreen";

/**
 * F2.04: the deals board and list. The page is only the frame: it records the view and hands over to the screen, which reads the API. Roles
 * that may not see deals get the API's explained "no access"; Delivery and Finance see won deals only (P1).
 */
export default async function DealsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  await schedulePageView(orgSlug, "deals");
  return <DealsScreen />;
}
