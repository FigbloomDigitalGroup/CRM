import { Suspense } from "react";
import { resolveRequestContext } from "@/auth/requestContext";
import { SearchResults } from "@/ui/screens/home/Search";

/** The full results page (G2). The search itself is `GET /api/orgs/{org}/search`, which limits every result to what the role may open. */
export default async function SearchPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  await resolveRequestContext(orgSlug);
  return (
    <Suspense fallback={null}>
      <SearchResults />
    </Suspense>
  );
}
