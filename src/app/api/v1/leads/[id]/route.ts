import { itemHandlers } from "@/api/publicApi/handlers";

// Public REST API (FIG-805): bearer token, `leads:read` / `leads:write`.
const handlers = itemHandlers("leads");

export const GET = handlers.GET;
export const PATCH = handlers.PATCH;
