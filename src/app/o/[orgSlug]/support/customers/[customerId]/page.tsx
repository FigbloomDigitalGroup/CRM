import { resolveRequestContext } from "@/auth/requestContext";
import { CustomerView } from "@/ui/screens/support/CustomerView";

/** FIG-1178: the role-limited customer view (no deal values, costs or payments). */
export default async function SupportCustomerPage({ params }: { params: Promise<{ orgSlug: string; customerId: string }> }) {
  const { orgSlug, customerId } = await params;
  await resolveRequestContext(orgSlug);
  return <CustomerView customerId={customerId} />;
}
