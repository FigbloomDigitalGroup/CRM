import { resolveRequestContext } from "@/auth/requestContext";
import { Approvals } from "@/ui/screens/commercial";

/** Approvals inbox (Q3, FIG-1169), V1.1, on the real approvals API. */
export default async function ApprovalsPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params;
  await resolveRequestContext(orgSlug);
  return <Approvals />;
}
