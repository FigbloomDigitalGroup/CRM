import { itemHandlers } from "@/api/publicApi/handlers";

// Public REST API (FIG-805): bearer token, `companies:read` / `companies:write`.
const handlers = itemHandlers("companies");

export const GET = handlers.GET;
export const PATCH = handlers.PATCH;
