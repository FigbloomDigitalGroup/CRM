import { notFound } from "next/navigation";
import { resolveRequestContext } from "@/auth/requestContext";
import { SocialPublishing, socialScreensEnabled } from "@/ui/screens/social";

/** Social media, publishing (UC-S4 to UC-S6), on demo data: a 404 unless demo screens are switched on. The screen explains no-access itself. */
export default async function Page({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  await resolveRequestContext(orgSlug);
  if (!socialScreensEnabled()) notFound();
  return <SocialPublishing />;
}
