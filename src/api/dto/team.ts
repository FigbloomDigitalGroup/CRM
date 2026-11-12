import { z } from "zod";

/**
 * Team page DTOs (P2-15, FIG-1598). Zod is the source of truth: the routes parse queries with these, the OpenAPI document is generated
 * from them (src/api/teamOperations.ts) and the typed client gets its types from the contract.
 *
 * Masking: a figure the caller may not see is `null` (counts) or absent with `valueMasked: true` (money); it is never zero. Payments do not
 * appear anywhere on this page.
 */

export const TEAM_RANGES = ["today", "7d", "30d"] as const;
export const TeamRangeSchema = z.enum(TEAM_RANGES);
export type TeamRange = z.infer<typeof TeamRangeSchema>;

export const TEAM_MEMBER_SORTS = ["name", "role", "status", "lastActive", "openLeads", "openDeals", "overdueTasks", "tasksToday", "newLeads"] as const;
export const TEAM_STATUSES = ["ACTIVE", "INACTIVE", "PENDING"] as const;

export const TeamRangeQuerySchema = z.object({ range: TeamRangeSchema.optional() });

export const TeamMembersQuerySchema = z.object({
  range: TeamRangeSchema.optional(),
  q: z.string().max(100).optional(),
  role: z.string().max(64).optional().describe("A role key, for example SALES."),
  status: z.enum(TEAM_STATUSES).optional(),
  sort: z.string().max(32).optional().describe("A field, or -field for descending: name, role, status, lastActive, openLeads, openDeals, overdueTasks, tasksToday, newLeads."),
  page: z.string().regex(/^\d+$/).optional(),
  pageSize: z.string().regex(/^\d+$/).optional(),
});

const money = z.object({ amount: z.string().nullable(), masked: z.boolean() });

export const TeamAccessSchema = z.object({ leads: z.boolean(), deals: z.boolean(), tasks: z.boolean(), values: z.boolean() });

export const TeamSummarySchema = z.object({
  range: TeamRangeSchema,
  rangeStart: z.string(),
  generatedAt: z.string(),
  staleDays: z.number().int(),
  access: TeamAccessSchema,
  summary: z.object({
    membersActive: z.number().int(),
    membersTotal: z.number().int(),
    openLeads: z.number().int().nullable(),
    openDeals: z.number().int().nullable(),
    openDealsValue: money,
    overdueTasks: z.number().int().nullable(),
    newLeads: z.number().int().nullable(),
    dealsWon: z.object({ count: z.number().int().nullable(), value: money }),
    unassignedLeads: z.number().int().nullable(),
  }),
  workload: z.array(z.object({ membershipId: z.string(), name: z.string(), openLeads: z.number().int() })),
});

export const TeamMemberRowSchema = z.object({
  membershipId: z.string(),
  name: z.string(),
  email: z.string(),
  initials: z.string(),
  avatarUrl: z.string().nullable(),
  role: z.object({ key: z.string(), name: z.string() }),
  status: z.enum(TEAM_STATUSES),
  lastActiveAt: z.string().nullable(),
  openLeads: z.number().int().nullable(),
  openDeals: z.number().int().nullable(),
  openDealsValue: money,
  tasksDueToday: z.number().int().nullable(),
  overdueTasks: z.number().int().nullable(),
  newLeads: z.number().int().nullable(),
  stuckDeals: z.number().int().nullable(),
});

export const TeamMembersResponseSchema = z.object({
  range: TeamRangeSchema,
  access: TeamAccessSchema,
  items: z.array(TeamMemberRowSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  pageCount: z.number().int(),
  nextCursor: z.string().nullable(),
  roles: z.array(z.object({ key: z.string(), name: z.string() })),
});

export const TeamMemberDetailSchema = z.object({
  range: TeamRangeSchema,
  access: TeamAccessSchema,
  member: TeamMemberRowSchema,
  recentActivity: z.array(z.object({ id: z.string(), action: z.string(), label: z.string(), entityType: z.string(), entityId: z.string().nullable(), at: z.string(), path: z.string().nullable() })),
  openLeads: z.array(z.object({ id: z.string(), company: z.string().nullable(), contact: z.string().nullable(), temperature: z.string(), nextFollowUpAt: z.string().nullable(), stale: z.boolean() })).nullable(),
  openDeals: z.array(z.object({ id: z.string(), company: z.string().nullable(), stage: z.string(), expectedCloseDate: z.string().nullable(), stuck: z.boolean(), value: money })).nullable(),
  tasks: z.array(z.object({ id: z.string(), title: z.string(), dueAt: z.string().nullable(), overdue: z.boolean() })).nullable(),
  trend: z.array(z.object({ start: z.string(), count: z.number().int() })),
});

const attentionOwner = { ownerMembershipId: z.string().nullable(), ownerName: z.string().nullable() };
export const TeamAttentionSchema = z.object({
  staleDays: z.number().int(),
  access: TeamAccessSchema,
  staleLeads: z.object({ total: z.number().int(), items: z.array(z.object({ id: z.string(), company: z.string().nullable(), contact: z.string().nullable(), lastTouchAt: z.string().nullable(), ...attentionOwner })) }).nullable(),
  overdueTasks: z.object({ total: z.number().int(), items: z.array(z.object({ id: z.string(), title: z.string(), dueAt: z.string(), ...attentionOwner })) }).nullable(),
  stuckDeals: z.object({ total: z.number().int(), items: z.array(z.object({ id: z.string(), company: z.string().nullable(), stage: z.string(), daysQuiet: z.number().int(), value: money, ...attentionOwner })) }).nullable(),
});

export type TeamSummary = z.infer<typeof TeamSummarySchema>;
export type TeamMemberRow = z.infer<typeof TeamMemberRowSchema>;
export type TeamMembersResponse = z.infer<typeof TeamMembersResponseSchema>;
export type TeamMemberDetail = z.infer<typeof TeamMemberDetailSchema>;
export type TeamAttention = z.infer<typeof TeamAttentionSchema>;
