import { z } from "zod";
import type { AuthContext } from "../../auth/context";
import { archiveBanner, type ArchivableRecord } from "../../lib/archive";
import { flattenTags, type TagSummary } from "../../repositories/tags";
import { LEAD_SORT_FIELDS } from "../../repositories/leads";
import { leadScoreForRow } from "../../services/scoreService";
import {
  ScoreViewSchema,
  TagSummarySchema,
  DuplicateCandidateSchema,
  RecordMetaShape,
  isoDateTime,
  pageOf,
  recordAccess,
  relation,
} from "./common";

export const TemperatureSchema = z.enum(["HOT", "WARM", "COLD"]);

export const ListLeadsQuerySchema = z.object({
  /** Records carrying any of these tags (comma-separated tag ids). */
  tagId: z.string().max(400).optional(),
  q: z.string().optional(),
  ownerMembershipId: z.string().optional(),
  leadStatusId: z.string().optional(),
  leadSourceId: z.string().optional(),
  temperature: TemperatureSchema.optional(),
  includeArchived: z.enum(["true", "false"]).optional(),
  /** The archived tab: only archived leads. */
  archivedOnly: z.enum(["true", "false"]).optional(),
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
  /** Organisation-defined custom field values (FIG-803). */
  customFields: z.record(z.string(), z.any()).optional(),
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
  customFields: z.record(z.string(), z.any()),
  tags: z.array(TagSummarySchema),
  /** Rules-based lead score with the reasons, as this caller may see it (FIG-1032); null until first computed. */
  score: ScoreViewSchema.nullable(),
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
  /** The fuller check (B2.04): candidates with reasons and a confidence band. */
  duplicates: z.array(DuplicateCandidateSchema),
  /** Candidates the caller may not open: counted, never described. */
  hiddenDuplicates: z.number().int(),
});

/** Adds the standard `archived`, `masked` and `scope` fields to a lead row. */
export function toLeadDto<
  T extends ArchivableRecord & {
    ownerMembershipId: string | null;
    tagLinks?: { tag: TagSummary }[];
    scoreValue: number | null;
    scoreBand: string | null;
    scoreFactors: unknown;
    scoredAt: Date | null;
  },
>(ctx: AuthContext, lead: T) {
  return {
    ...withoutRawScore(flattenTags(lead)),
    score: leadScoreForRow(ctx, lead),
    archived: lead.archivedAt !== null,
    archive: archiveBanner(ctx, "lead", lead),
    masked: false,
    ...recordAccess(ctx, "leads", {
      ownerMembershipId: lead.ownerMembershipId,
    }),
  };
}

/** The raw score columns hold every factor, including ones some roles may not see; only `score` (filtered) goes out. */
function withoutRawScore<T extends { scoreValue: unknown; scoreBand: unknown; scoreFactors: unknown; scoredAt: unknown }>(row: T) {
  const { scoreValue: _v, scoreBand: _b, scoreFactors: _f, scoredAt: _a, ...rest } = row;
  void _v;
  void _b;
  void _f;
  void _a;
  return rest;
}
