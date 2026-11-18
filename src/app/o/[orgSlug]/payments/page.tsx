import { Suspense } from "react";
import { resolveRequestContext } from "@/auth/requestContext";
import { PaymentsScreen } from "@/ui/screens/finance/PaymentsScreen";

/**
 * F3.06: the Payments tracker (F1). The page is only the frame; the screen reads the payments API, which answers Finance and Management and
 * refuses everyone else with the explained no-access state. (There is no page-view label for it: the label list belongs to the usage metric.)
 */
export default async function PaymentsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  await resolveRequestContext(orgSlug); // a person outside the organisation is turned away here
  return (
    <Suspense fallback={null}>
      <PaymentsScreen />
    </Suspense>
  );
}
