import { resolveRequestContext } from "@/auth/requestContext";
import { MergeScreen } from "@/ui/screens/customers/merge/MergeScreen";

/** F3.03: the merge flow as a page (C4): `/merge?kind=company|contact|lead&id=…`. Company, contact and lead pages open the same dialog in place. */
export default async function MergePage({ params, searchParams }: { params: Promise<{ orgSlug: string }>; searchParams: Promise<{ kind?: string; id?: string }> }) {
  const { orgSlug } = await params;
  const { kind, id } = await searchParams;
  await resolveRequestContext(orgSlug);
  return <MergeScreen kind={kind === "contact" || kind === "lead" ? kind : "company"} id={id ?? ""} />;
}
