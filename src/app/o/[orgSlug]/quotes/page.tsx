import { resolveRequestContext } from "@/auth/requestContext";
import { QuoteList } from "@/ui/screens/commercial";

/** Quotes (Q1, FIG-1168), V1.1, on the real quote API. Permission is checked by the screen and repeated by the API. */
export default async function QuotesPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  await resolveRequestContext(orgSlug);
  return <QuoteList />;
}
