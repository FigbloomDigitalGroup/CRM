import { notFound } from "next/navigation";
import { resolveRequestContext } from "@/auth/requestContext";
import { demoScreensEnabled } from "@/ui/demo/enabled";
import { CustomerView } from "@/ui/screens/support/CustomerView";

/** FIG-1178: the role-limited customer view (no deal values, costs or payments), on demo data. */
export default async function SupportCustomerPage({ params }: { params: Promise<{ orgSlug: string; customerId: string }> }) {
  if (!demoScreensEnabled()) notFound();
  const { orgSlug, customerId } = await params;
  await resolveRequestContext(orgSlug);
  return <CustomerView customerId={customerId} />;
}
