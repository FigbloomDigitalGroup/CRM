import { Suspense } from "react";
import { resolveRequestContext } from "@/auth/requestContext";
import { HandoffsScreen } from "@/ui/screens/deals/HandoffsScreen";

/** F2.06: the Delivery Handoffs view (P4). Which handoffs a person sees, and what they may do with each, is decided by the API. */
export default async function HandoffsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  await resolveRequestContext(orgSlug); // a person outside the organisation is turned away here
  return (
    <Suspense fallback={null}>
      <HandoffsScreen />
    </Suspense>
  );
}
