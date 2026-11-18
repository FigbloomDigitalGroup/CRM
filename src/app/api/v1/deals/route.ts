import { collectionHandlers } from "@/api/publicApi/handlers";

// Public REST API (FIG-805): bearer token, `deals:read` / `deals:write`. See docs/M17_LANE_C_PUBLIC_API_WEBHOOKS.md.
const handlers = collectionHandlers("deals");

export const GET = handlers.GET;
export const POST = handlers.POST;
