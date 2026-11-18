import { itemHandlers } from "@/api/publicApi/handlers";

// Public REST API (FIG-805): bearer token, `deals:read` / `deals:write`.
const handlers = itemHandlers("deals");

export const GET = handlers.GET;
export const PATCH = handlers.PATCH;
