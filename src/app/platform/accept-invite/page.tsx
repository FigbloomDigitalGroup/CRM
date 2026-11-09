import { AcceptInvitePage } from "@/ui/screens/platform";

/** A new platform admin chooses a password from the single-use link (docs/PLATFORM_BOOTSTRAP.md). A new route; the frozen tenant pages are not touched. */
export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  return <AcceptInvitePage token={typeof token === "string" ? token : ""} />;
}
