import { resolveRequestContext } from "@/auth/requestContext";
import { recordPageView } from "@/services/pageViewService";
import { LeadDetailScreen } from "@/ui/screens/leads/LeadDetailScreen";

/** The lead page (F2.02): progress strip, qualification, timeline, tasks. A lead the role may not open answers with the explained no-access. */
export default async function LeadDetailPage({ params }: { params: Promise<{ orgSlug: string; leadId: string }> }) {
  const { orgSlug, leadId } = await params;
  const ctx = await resolveRequestContext(orgSlug);
  await recordPageView(ctx, "leads_detail");
  return <LeadDetailScreen leadId={leadId} />;
}
