import type { z } from "zod";
import { handleRoute } from "@/app/api/_lib/handleRoute";
import { customFieldFilters, pageQueryShape, toPageRequest } from "@/app/api/_lib/pageQuery";
import { parseJsonBody, parseQueryParams } from "@/app/api/_lib/validation";
import { authenticateApiToken, type ApiEntity } from "@/auth/apiToken";
import type { AuthContext } from "@/auth/context";
import { ValidationError } from "@/auth/errors";
import { withIdempotency } from "@/lib/idempotency";
import { parseSort } from "@/lib/listQuery";
import { flattenTags } from "@/repositories/tags";
import { buildCustomFieldWhere } from "@/services/customFieldService";
import { createActivity, listActivitiesPage, listTimelineActivitiesPage } from "@/services/activityService";
import { createCompany, getCompany, listCompaniesPage, updateCompany } from "@/services/companyService";
import { createContact, getContact, listContactsPage, updateContact } from "@/services/contactService";
import { createDeal, getDeal, listDealsPage } from "@/services/dealService";
import { loadStageRules, updateDealChecked } from "@/services/dealRuleService";
import { createLead, getLead, listLeadsPage, updateLead } from "@/services/leadService";
import { createTask, getTask, listTasksPage, updateTask } from "@/services/taskService";
import { CreateLeadBodySchema, LEAD_SORTS, ListLeadsQuerySchema, toLeadDto } from "../dto/leads";
import { DealSchema, toDealDto } from "../dto/deals";
import { respond } from "../respond";
import * as S from "./schemas";

/**
 * The public REST API (FIG-805): `/api/v1/<entity>` and `/api/v1/<entity>/{id}`. Every handler authenticates a bearer token
 * (`src/auth/apiToken.ts`), which yields the owning membership's context, and then calls the same service the application's own routes call.
 * So permissions, ownership rules, masking, archive rules, audit and RLS are exactly those of the person who owns the token.
 *
 * Reading needs the `<entity>:read` scope and writing needs `<entity>:write`; the two are independent.
 */

type Params = { params: Promise<{ id: string }> };

const bool = (v: string | undefined) => v === "true";

/** Authenticates, then runs `fn` inside the standard error mapping. */
function run(request: Request, scope: string, fn: (ctx: AuthContext) => Promise<unknown>) {
  return handleRoute(async () => fn((await authenticateApiToken(request, scope)).ctx));
}

type Entity = {
  list: (ctx: AuthContext, sp: URLSearchParams) => Promise<unknown>;
  get: (ctx: AuthContext, id: string) => Promise<unknown>;
  create: (ctx: AuthContext, request: Request) => Promise<unknown>;
  update: (ctx: AuthContext, id: string, request: Request) => Promise<unknown>;
};

/** A create that honours `Idempotency-Key`, like the application's own create routes. */
async function idempotentCreate<T extends z.ZodType>(ctx: AuthContext, request: Request, schema: T, make: (body: z.output<T>) => Promise<unknown>) {
  const body = await parseJsonBody(request, schema);
  return withIdempotency(ctx, request, body, () => make(body));
}

const ENTITIES: Record<ApiEntity, Entity> = {
  companies: {
    async list(ctx, sp) {
      const q = parseQueryParams(sp, S.ListCompaniesQuery);
      const customFieldClauses = await buildCustomFieldWhere(ctx.organizationId, "COMPANY", customFieldFilters(sp));
      const page = await listCompaniesPage(ctx, { query: q.q, ownerMembershipId: q.ownerMembershipId, includeArchived: bool(q.includeArchived), customFieldClauses }, toPageRequest(q));
      return { ...page, items: page.items.map(flattenTags) };
    },
    async get(ctx, id) {
      return flattenTags(await getCompany(ctx, id));
    },
    create: (ctx, request) => idempotentCreate(ctx, request, S.CreateCompanyBody, (body) => createCompany(ctx, body)),
    async update(ctx, id, request) {
      return updateCompany(ctx, id, await parseJsonBody(request, S.UpdateCompanyBody));
    },
  },
  contacts: {
    async list(ctx, sp) {
      const q = parseQueryParams(sp, S.ListContactsQuery);
      const customFieldClauses = await buildCustomFieldWhere(ctx.organizationId, "CONTACT", customFieldFilters(sp));
      const page = await listContactsPage(ctx, { query: q.q, companyId: q.companyId, ownerMembershipId: q.ownerMembershipId, includeArchived: bool(q.includeArchived), customFieldClauses }, toPageRequest(q));
      return { ...page, items: page.items.map(flattenTags) };
    },
    async get(ctx, id) {
      return flattenTags(await getContact(ctx, id));
    },
    create: (ctx, request) => idempotentCreate(ctx, request, S.CreateContactBody, (body) => createContact(ctx, body)),
    async update(ctx, id, request) {
      return updateContact(ctx, id, await parseJsonBody(request, S.UpdateContactBody));
    },
  },
  leads: {
    async list(ctx, sp) {
      const q = parseQueryParams(sp, ListLeadsQuerySchema.extend(pageQueryShape));
      const customFieldClauses = await buildCustomFieldWhere(ctx.organizationId, "LEAD", customFieldFilters(sp));
      const page = await listLeadsPage(
        ctx,
        {
          query: q.q,
          ownerMembershipId: q.ownerMembershipId,
          leadStatusId: q.leadStatusId,
          leadSourceId: q.leadSourceId,
          temperature: q.temperature,
          includeArchived: bool(q.includeArchived),
          archivedOnly: bool(q.archivedOnly),
          customFieldClauses,
          tagIds: q.tagId ? q.tagId.split(",").filter(Boolean) : undefined,
          sort: parseSort(q.sort, LEAD_SORTS),
        },
        toPageRequest(q),
      );
      return { ...page, items: page.items.map((lead) => toLeadDto(ctx, lead)) };
    },
    async get(ctx, id) {
      return toLeadDto(ctx, await getLead(ctx, id));
    },
    create: (ctx, request) => idempotentCreate(ctx, request, CreateLeadBodySchema, (body) => createLead(ctx, body)),
    async update(ctx, id, request) {
      return updateLead(ctx, id, await parseJsonBody(request, S.UpdateLeadBody));
    },
  },
  deals: {
    async list(ctx, sp) {
      const q = parseQueryParams(sp, S.ListDealsQuery);
      const customFieldClauses = await buildCustomFieldWhere(ctx.organizationId, "DEAL", customFieldFilters(sp));
      const rules = await loadStageRules(ctx.organizationId);
      const page = await listDealsPage(
        ctx,
        { query: q.q, ownerMembershipId: q.ownerMembershipId, pipelineStageId: q.pipelineStageId, outcome: q.outcome, companyId: q.companyId, includeArchived: bool(q.includeArchived), customFieldClauses },
        toPageRequest(q),
      );
      return { ...page, items: page.items.map((d) => toDealDto(ctx, d, rules)) };
    },
    async get(ctx, id) {
      return respond(DealSchema, toDealDto(ctx, await getDeal(ctx, id), await loadStageRules(ctx.organizationId)));
    },
    create: (ctx, request) => idempotentCreate(ctx, request, S.CreateDealBody, (body) => createDeal(ctx, body)),
    async update(ctx, id, request) {
      // A change of stage goes through the same gates as in the application (valid quote, approval, required fields, lost reason).
      return updateDealChecked(ctx, id, await parseJsonBody(request, S.UpdateDealBody));
    },
  },
  tasks: {
    async list(ctx, sp) {
      const q = parseQueryParams(sp, S.ListTasksQuery);
      return listTasksPage(
        ctx,
        { status: q.status, companyId: q.companyId, contactId: q.contactId, leadId: q.leadId, dealId: q.dealId, overdueOnly: bool(q.overdueOnly), includeArchived: bool(q.includeArchived) },
        toPageRequest(q),
      );
    },
    get: (ctx, id) => getTask(ctx, id),
    create: (ctx, request) => idempotentCreate(ctx, request, S.CreateTaskBody, (body) => createTask(ctx, body)),
    async update(ctx, id, request) {
      return updateTask(ctx, id, await parseJsonBody(request, S.UpdateTaskBody));
    },
  },
  activities: {
    async list(ctx, sp) {
      const q = parseQueryParams(sp, S.ListActivitiesQuery);
      const page = toPageRequest(q);
      // A timeline belongs to exactly one record, as in the application.
      if (q.companyId) return listTimelineActivitiesPage(ctx, { companyId: q.companyId }, page);
      if (q.contactId) return listTimelineActivitiesPage(ctx, { contactId: q.contactId }, page);
      if (q.leadId) return listActivitiesPage(ctx, { leadId: q.leadId }, page);
      if (q.dealId) return listActivitiesPage(ctx, { dealId: q.dealId }, page);
      throw new ValidationError("One of companyId, contactId, leadId, or dealId is required.");
    },
    async get() {
      // Activities are read as a timeline of one record; there is no single-activity read in the application either.
      throw new ValidationError("Activities are listed per record: GET /api/v1/activities?dealId=...");
    },
    create: (ctx, request) => idempotentCreate(ctx, request, S.CreateActivityBody, (body) => createActivity(ctx, body)),
    async update() {
      throw new ValidationError("Activities cannot be changed.");
    },
  },
};

/** `GET` (list) and `POST` (create) of one entity, ready to export from a route file. */
export function collectionHandlers(entity: ApiEntity) {
  const e = ENTITIES[entity];
  return {
    GET: (request: Request) => run(request, `${entity}:read`, (ctx) => e.list(ctx, new URL(request.url).searchParams)),
    POST: (request: Request) => run(request, `${entity}:write`, (ctx) => e.create(ctx, request)),
  };
}

/** `GET` and `PATCH` of one record. */
export function itemHandlers(entity: ApiEntity) {
  const e = ENTITIES[entity];
  return {
    GET: async (request: Request, { params }: Params) => {
      const { id } = await params;
      return run(request, `${entity}:read`, (ctx) => e.get(ctx, id));
    },
    PATCH: async (request: Request, { params }: Params) => {
      const { id } = await params;
      return run(request, `${entity}:write`, (ctx) => e.update(ctx, id, request));
    },
  };
}
