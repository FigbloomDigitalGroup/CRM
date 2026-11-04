import { NextResponse } from "next/server";
import { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { parseJsonBody, parseQueryParams } from "@/app/api/_lib/validation";
import { requirePlatformApi } from "@/app/api/platform/_lib/platformRoute";
import { listOrganizations, provisionPlatformOrganization } from "@/services/platformOrganizationService";

const ListQuery = z.object({
  q: z.string().optional(),
  status: z.string().optional(),
  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),
  sort: z.enum(["name", "createdAt", "members", "status"]).optional(),
  direction: z.enum(["asc", "desc"]).optional(),
  page: z.coerce.number().int().optional(),
  pageSize: z.coerce.number().int().optional(),
});

/** Organisations with operational counts only (numbers, no records or values), filtered and paged (PL2). FIG-1136. */
export async function GET(request: Request) {
  return handleRoute(async () => {
    await requirePlatformApi("platform.organizations.view");
    return listOrganizations(parseQueryParams(new URL(request.url).searchParams, ListQuery));
  });
}

const ProvisionBody = z.strictObject({
  name: z.string({ error: "Name is required." }),
  slug: z.string({ error: "Slug is required." }),
  ownerName: z.string({ error: "The first Management user's name is required." }),
  ownerEmail: z.string({ error: "The first Management user's email is required." }),
});

/** Provision an organisation (PL3): seeded defaults, first Management invite. Honours Idempotency-Key. Audited. FIG-1136. */
export async function POST(request: Request) {
  return handleRoute(async () => {
    const platform = await requirePlatformApi("platform.organizations.provision");
    const body = await parseJsonBody(request, ProvisionBody);
    const done = await provisionPlatformOrganization(platform, body, {
      idempotencyKey: request.headers.get("idempotency-key"),
      requestId: request.headers.get("x-request-id"),
    });
    return NextResponse.json(done, { status: done.replayed ? 200 : 201, headers: done.replayed ? { "Idempotent-Replayed": "true" } : undefined });
  });
}
