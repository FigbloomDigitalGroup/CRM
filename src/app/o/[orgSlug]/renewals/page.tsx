import { resolveRequestContext } from "@/auth/requestContext";
import { RenewalsScreen } from "@/ui/screens/engage/RenewalsScreen";

/**
 * F3.05: Renewals and retention. The page is only the frame; the screen reads the retention lists and the recurring services from the API,
 * and a role the API refuses gets the explained "no access". There is no page-view label for this page (the label list belongs to the usage
 * metric).
 */
export default async function RenewalsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  await resolveRequestContext(orgSlug);
  return <RenewalsScreen />;
}
