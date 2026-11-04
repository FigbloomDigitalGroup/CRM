import { schedulePageView } from "@/services/pageViewService";
import { CompanyDetailScreen } from "@/ui/screens/customers/CompanyDetailScreen";

/** F3.01: Customer 360 (C2). Each part of the page is loaded and permitted on its own; the screen explains what a role cannot see. */
export default async function CompanyDetailPage({ params }: { params: Promise<{ orgSlug: string; companyId: string }> }) {
  const { orgSlug, companyId } = await params;
  await schedulePageView(orgSlug, "companies_detail");
  return <CompanyDetailScreen companyId={companyId} />;
}
