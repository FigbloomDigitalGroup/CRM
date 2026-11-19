import { z } from "zod";
import { NextResponse } from "next/server";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody } from "@/app/api/_lib/validation";
import { createOrganizationFromConsole, listOrganizationSummaries } from "@/services/platformConsoleService";
import { consoleGate } from "../_console";

export const dynamic = "force-dynamic";

/** Every CRM organisation, as Figbloom's console sees it (ERP/CRM_PLATFORM_CONTRACT.md). */
export async function GET(request: Request) {
  return handleRoute(async () => {
    const closed = consoleGate(request);
    if (closed) return closed;
    return { organizations: await listOrganizationSummaries() };
  });
}

const CreateSchema = z.object({
  name: z.string(),
  slug: z.string().optional(),
  adminName: z.string(),
  adminEmail: z.string(),
  staffEmail: z.string(),
});

/** A new organisation for a customer, created by Figbloom staff from the console. */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const closed = consoleGate(request);
    if (closed) return closed;
    const body = await parseJsonBody(request, CreateSchema);
    const organization = await createOrganizationFromConsole(body);
    return NextResponse.json({ organization }, { status: 201 });
  });
}
