import { handleRoute } from "@/app/api/_lib/handleRoute";
import { resolveRequestContext } from "@/auth/requestContext";
import { getSupportCustomerView } from "@/services/ticketService";

/** The role-limited customer view for Customer Support: contacts, services, tickets and satisfaction. No deals, values, costs or payments. */
export async function GET(_request: Request, { params }: { params: Promise<{ orgSlug: string; companyId: string }> }) {
  return handleRoute(async () => {
    const { orgSlug, companyId } = await params;
    return getSupportCustomerView(await resolveRequestContext(orgSlug), companyId);
  });
}
