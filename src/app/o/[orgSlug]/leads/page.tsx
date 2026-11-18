import { schedulePageView } from "@/services/pageViewService";
import { LeadsScreen } from "@/ui/screens/leads/LeadsScreen";

/** The Leads list (F2.01). The screen draws itself from the typed API; a role without access gets the explained no-access from the API's own answer. */
export default async function LeadsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  await schedulePageView(orgSlug, "leads");
  return <LeadsScreen />;
}
