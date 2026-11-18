import { schedulePageView } from "@/services/pageViewService";
import { DealDetailScreen } from "@/ui/screens/deals/DealDetailScreen";

/** F2.05: one deal. The screen reads the API, which answers 403 and 404 with the explained states (never a value the role may not see). */
export default async function DealDetailPage({ params }: { params: Promise<{ orgSlug: string; dealId: string }> }) {
  const { orgSlug, dealId } = await params;
  await schedulePageView(orgSlug, "deals_detail");
  return <DealDetailScreen dealId={dealId} />;
}
