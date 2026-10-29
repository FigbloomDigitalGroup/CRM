import { notFound } from "next/navigation";
import { resolveRequestContext } from "@/auth/requestContext";
import { demoScreensEnabled } from "@/ui/demo/enabled";
import { QuoteList } from "@/ui/screens/commercial";

/** Quotes (Q1, FIG-1168), V1.1, on demo data until B6.11 and B6.12 are wired (docs/RESTRUCTURE_LOG.md). Permission is checked by the screen; the API will repeat it. */
export default async function QuotesPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  await resolveRequestContext(orgSlug);
  if (!demoScreensEnabled()) notFound();
  return <QuoteList />;
}
