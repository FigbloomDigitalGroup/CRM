import { itemHandlers } from "@/api/publicApi/handlers";

// Public REST API (FIG-805): bearer token, `tasks:read` / `tasks:write`.
const handlers = itemHandlers("tasks");

export const GET = handlers.GET;
export const PATCH = handlers.PATCH;
