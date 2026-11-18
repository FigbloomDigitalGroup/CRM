import type { OperationDef } from "./openapi";
import { TeamAttentionSchema, TeamMemberDetailSchema, TeamMembersQuerySchema, TeamMembersResponseSchema, TeamRangeQuerySchema, TeamSummarySchema } from "./dto/team";

/**
 * The Team page endpoints (P2-15, FIG-1598) in the OpenAPI document. Management only (`canViewTeamPage`); everyone else gets the explained 403.
 * Register with `...TEAM_OPERATIONS` where the other operation lists are spread (src/api/openapi.ts).
 */
const ORG = "/api/orgs/{orgSlug}/team";
const errors: OperationDef["errors"] = [400, 401, 403, 404];

export const TEAM_OPERATIONS: OperationDef[] = [
  { method: "get", path: `${ORG}/summary`, operationId: "getTeamSummary", summary: "The team summary strip and workload balance for a date range (today, 7d, 30d). Management only", tags: ["Team"], query: TeamRangeQuerySchema, response: TeamSummarySchema, errors },
  { method: "get", path: `${ORG}/members`, operationId: "listTeamMembers", summary: "Team members with per-person open leads, deals, tasks and last activity; filter by role, status and name; sortable and paged. Management only", tags: ["Team"], query: TeamMembersQuerySchema, response: TeamMembersResponseSchema, errors },
  { method: "get", path: `${ORG}/members/{membershipId}`, operationId: "getTeamMember", summary: "One member: recent sales activity from the audit trail, open leads, deals and tasks, 30-day trend. Management only", tags: ["Team"], query: TeamRangeQuerySchema, response: TeamMemberDetailSchema, errors },
  { method: "get", path: `${ORG}/attention`, operationId: "getTeamAttention", summary: "Quiet leads, overdue tasks and stuck deals across the team. Management only", tags: ["Team"], response: TeamAttentionSchema, errors },
];
