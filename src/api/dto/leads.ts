import { z } from "zod";
import type { AuthContext } from "../../auth/context";
import { LEAD_SORT_FIELDS } from "../../repositories/leads";
import {
  RecordMetaShape,
  isoDateTime,
  pageOf,
  recordAccess,
  relation,
} from "./common";

export const TemperatureSchema = z.enum(["HOT", "WARM", "COLD"]);

export const ListLeadsQuerySchema = z.object({
  q: z.string().optional(),
  ownerMembershipId: z.string().optional(),
  leadStatusId: z.string().optional(),
  leadSourceId: z.string().optional(),
  temperature: TemperatureSchema.optional(),
  includeArchived: z.enum(["true", "false"]).optional(),
});

export const LEAD_SORTS = LEAD_SORT_FIELDS;

export const CreateLeadBodySchema = z.object({
  leadStatusId: z
    .string({ error: "leadStatusId is required." })
    .min(1, "leadStatusId is required."),
  companyId: z.string().optional(),
  contactId: z.string().optional(),
  leadSourceId: z.string().optional(),
  temperature: TemperatureSchema.optional(),
  serviceInterestId: z.string().optional(),
  ownerMembershipId: z.string().optional(),
  // Arbitrary per-status qualification answers -- no fixed shape to
  // validate against (z.any, not z.unknown, so this stays assignable to
  // Prisma's InputJsonValue without a cast).
  qualificationData: z.any().optional(),
});

const idName = { id: z.string(), name: z.string() };

/** One lead as the API returns it, on the list. */
export const LeadSchema = z.strictObject({
  id: z.string(),
  organizationId: z.string(),
  companyId: z.string().nullable(),
  contactId: z.string().nullable(),
  leadSourceId: z.string().nullable(),
  leadStatusId: z.string(),
  temperature: TemperatureSchema,
  serviceInterestId: z.string().nullable(),
  ownerMembershipId: z.string().nullable(),
  qualificationData: z.any().nullable(),
  lostReasonId: z.string().nullable(),
  nextFollowUpAt: isoDateTime.nullable(),
  convertedAt: isoDateTime.nullable(),
  notes: z.string().nullable(),
  createdByMembershipId: z.string().nullable(),
  archivedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  company: relation(idName).nullable(),
  contact: relation({ id: z.string(), firstName: z.string() }).nullable(),
  leadStatus: relation({ ...idName, key: z.string() }),
  leadSource: relation({ ...idName, key: z.string() }).nullable(),
  ...RecordMetaShape,
});

export const ListLeadsResponseSchema = pageOf(LeadSchema);

/** The created lead plus any possible duplicates found (a warning, never a block). */
export const CreateLeadResponseSchema = z.strictObject({
  lead: relation({ id: z.string(), leadStatusId: z.string() }),
  possibleDuplicates: z.array(relation({ id: z.string() })),
});

/** Adds the standard `archived`, `masked` and `scope` fields to a lead row. */
export function toLeadDto<
  T extends { archivedAt: Date | null; ownerMembershipId: string | null },
>(ctx: AuthContext, lead: T) {
  return {
    ...lead,
    archived: lead.archivedAt !== null,
    masked: false,
    ...recordAccess(ctx, "leads", {
      ownerMembershipId: lead.ownerMembershipId,
    }),
  };
}
