import { resolveRequestContext } from "@/auth/requestContext";
import { QuoteBuilder } from "@/ui/screens/commercial";

/** The quote builder for one deal (Q1, FIG-1168), on the real quote API. */
export default async function QuotePage({ params }: { params: Promise<{ orgSlug: string; dealId: string }> }) {
  const { orgSlug, dealId } = await params;
  await resolveRequestContext(orgSlug);
  return <QuoteBuilder dealId={dealId} />;
}
