import { notFound } from "next/navigation";
import { resolveRequestContext } from "@/auth/requestContext";
import { demoScreensEnabled } from "@/ui/demo/enabled";
import { Forecast } from "@/ui/screens/commercial";

/** Forecast and targets (Q4, FIG-1170), V1.1, on demo data until B6.14 is wired. */
export default async function ForecastPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  await resolveRequestContext(orgSlug);
  if (!demoScreensEnabled()) notFound();
  return <Forecast />;
}
