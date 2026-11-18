import { itemHandlers } from "@/api/publicApi/handlers";

// Public REST API (FIG-805): bearer token, `contacts:read` / `contacts:write`.
const handlers = itemHandlers("contacts");

export const GET = handlers.GET;
export const PATCH = handlers.PATCH;
