import { resolveRequestContext } from "@/auth/requestContext";
import { recordPageView } from "@/services/pageViewService";
import { CompaniesScreen } from "@/ui/screens/customers/CompaniesScreen";

/**
 * F3.01: the companies list (C1). The page is only the frame: it records the view and hands over to the screen, which reads the directory API.
 * A role that may not see companies gets the API's explained "no access".
 */
export default async function CompaniesPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  const ctx = await resolveRequestContext(orgSlug);
  await recordPageView(ctx, "companies");
  return <CompaniesScreen />;
}
