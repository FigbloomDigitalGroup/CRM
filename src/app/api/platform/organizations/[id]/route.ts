import { handleRoute } from "@/app/api/_lib/handleRoute";
import { getOrganizationSummary } from "@/services/platformConsoleService";
import { consoleGate } from "../../_console";

export const dynamic = "force-dynamic";

/** One CRM organisation, as Figbloom's console sees it. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleRoute(async () => {
    const closed = consoleGate(request);
    if (closed) return closed;
    const { id } = await params;
    return { organization: await getOrganizationSummary(id) };
  });
}
