import { notFound } from "next/navigation";
import { resolveRequestContext } from "@/auth/requestContext";
import { SocialOverview, socialScreensEnabled } from "@/ui/screens/social";

/** Social media, overview (UC-S4 to UC-S6), on demo data: a 404 unless demo screens are switched on. The screen explains no-access itself. */
export default async function Page({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  await resolveRequestContext(orgSlug);
  if (!socialScreensEnabled()) notFound();
  return <SocialOverview />;
}
