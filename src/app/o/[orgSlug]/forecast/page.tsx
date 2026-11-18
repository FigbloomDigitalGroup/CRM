import { resolveRequestContext } from "@/auth/requestContext";
import { Forecast } from "@/ui/screens/commercial";

/** Forecast and targets (Q4, FIG-1170), V1.1, wired to the forecast API (FIG-1146). A V1 organisation sees the explained "not available yet". */
export default async function ForecastPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  await resolveRequestContext(orgSlug);
  return <Forecast />;
}
