import { z } from "zod";
import type { OperationDef } from "./openapi";

/**
 * M17 lane D endpoints in the OpenAPI document: the roles and field access editor (FIG-1188, B7.06) and churn hints (FIG-1190, B7.08).
 * Both are V2: an organisation below V2 gets 403 FEATURE_UNAVAILABLE before anything else. Register with `...V2_OPERATIONS_D`
 * where the other operation lists are spread (src/api/openapi.ts). The frozen V1 contract is not touched; the V2 contract is frozen by G3.01.
 */

const ORG = "/api/orgs/{orgSlug}";
const obj = z.looseObject({});

type Errors = OperationDef["errors"];

function op(
  method: OperationDef["method"],
  path: string,
  operationId: string,
  summary: string,
  tag: string,
  extra: { query?: z.ZodObject; body?: z.ZodType; response?: z.ZodType; errors?: Errors; idempotent?: boolean } = {},
): OperationDef {
  return {
    method,
    path: `${ORG}${path}`,
    operationId,
    summary,
    tags: [tag],
    query: extra.query,
    body: extra.body,
    response: extra.response ?? obj,
    errors: extra.errors ?? (extra.body ? [400, 401, 403, 404] : [401, 403, 404]),
    idempotent: extra.idempotent,
  };
}

const roleBody = {
  description: z.string().nullable().optional(),
  permissionKeys: z.array(z.string()).optional(),
  fieldRules: z.record(z.string(), z.string()).optional().describe("Only `deal.value` is editable: all, own or hidden."),
};

export const V2_OPERATIONS_D: OperationDef[] = [
  op("get", "/roles", "listRoles", "The platform roles and this organisation's custom roles with their permissions, field rules and member counts (roles.manage or role.assign; V2)", "Roles", { query: z.object({ includeArchived: z.string().optional() }) }),
  op("post", "/roles", "createRole", "Create a custom role, optionally starting from a platform role; reserved keys are refused (roles.manage; V2)", "Roles", { body: z.strictObject({ name: z.string(), basedOnRoleKey: z.string().optional(), ...roleBody }), idempotent: true }),
  op("get", "/roles/catalog", "getRoleCatalog", "Every permission with whether it may be granted to a custom role and why not, the controllable fields and the starting-point roles (roles.manage; V2)", "Roles"),
  op("post", "/roles/preview", "previewRole", "The effect of a role change before saving: keys gained and lost, what the role can see and change per screen family, the people reached, warnings. Writes nothing (roles.manage; V2)", "Roles", { body: z.strictObject({ roleId: z.string().optional(), basedOnRoleKey: z.string().optional(), permissionKeys: z.array(z.string()).optional(), fieldRules: z.record(z.string(), z.string()).optional() }) }),
  op("get", "/roles/{roleId}", "getRole", "One role", "Roles"),
  op("patch", "/roles/{roleId}", "updateRole", "Rename a custom role or change its permissions and field rules; effective on the next request, audited. Platform roles are fixed (roles.manage; V2)", "Roles", { body: z.strictObject({ name: z.string().optional(), ...roleBody }) }),
  op("delete", "/roles/{roleId}", "archiveRole", "Archive a custom role nobody holds any more (roles.manage; V2)", "Roles"),

  op("get", "/churn-hints", "listChurnHints", "Churn hints for the customers you own (Management: all), each with its reasons, shown only as far as your role may see the data behind them (ai.use; V2; assistant and its churn option on)", "Assistant", { query: z.object({ status: z.string().optional(), companyId: z.string().optional(), mine: z.string().optional() }) }),
  op("post", "/churn-hints/refresh", "refreshChurnHints", "Look at the organisation's customers again now (the nightly job does the same)", "Assistant", { body: z.strictObject({}).optional() }),
  op("post", "/churn-hints/{hintId}/dismiss", "dismissChurnHint", "Dismiss a hint; it returns only when the customer's situation changes", "Assistant", { body: z.strictObject({ reason: z.string().max(300).optional() }) }),
  op("post", "/churn-hints/{hintId}/feedback", "rateChurnHint", "Say whether a hint was useful", "Assistant", { body: z.strictObject({ value: z.enum(["HELPFUL", "NOT_HELPFUL"]), note: z.string().max(500).optional() }) }),
];
