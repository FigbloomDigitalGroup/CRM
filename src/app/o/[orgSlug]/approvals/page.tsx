import { notFound } from "next/navigation";
import { resolveRequestContext } from "@/auth/requestContext";
import { demoScreensEnabled } from "@/ui/demo/enabled";
import { Approvals } from "@/ui/screens/commercial";

/** Approvals inbox (Q3, FIG-1169), V1.1, on demo data until B6.13 is wired. */
export default async function ApprovalsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  await resolveRequestContext(orgSlug);
  if (!demoScreensEnabled()) notFound();
  return <Approvals />;
}
