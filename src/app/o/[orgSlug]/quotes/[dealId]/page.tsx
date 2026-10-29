import { notFound } from "next/navigation";
import { resolveRequestContext } from "@/auth/requestContext";
import { demoScreensEnabled } from "@/ui/demo/enabled";
import { QuoteBuilder } from "@/ui/screens/commercial";

/** The quote builder for one deal (Q1, FIG-1168). Demo data: the deal id is one of the sample deals. */
export default async function QuotePage({ params }: { params: Promise<{ orgSlug: string; dealId: string }> }) {
  const { orgSlug, dealId } = await params;
  await resolveRequestContext(orgSlug);
  if (!demoScreensEnabled()) notFound();
  return <QuoteBuilder dealId={dealId} />;
}
