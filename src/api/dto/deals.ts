import { z } from "zod";
import type { AuthContext } from "../../auth/context";
import { archiveBanner, type ArchivableRecord } from "../../lib/archive";
import { flattenTags, type TagSummary } from "../../repositories/tags";
import { signalsForDeal, type StageRules } from "../../services/dealRuleService";
import {
  TagSummarySchema,
  RecordMetaShape,
  decimalString,
  isoDateTime,
  recordAccess,
  relation,
} from "./common";

export const DealOutcomeSchema = z.enum(["OPEN", "WON", "LOST"]);

const idName = { id: z.string(), name: z.string() };

/** One deal as the API returns it. `value` is null (and `masked` true) when the caller may not see it. */
export const DealSchema = z.strictObject({
  id: z.string(),
  organizationId: z.string(),
  companyId: z.string(),
  primaryContactId: z.string().nullable(),
  leadId: z.string().nullable(),
  serviceId: z.string().nullable(),
  ownerMembershipId: z.string(),
  pipelineStageId: z.string(),
  value: decimalString.nullable(),
  currency: z.string(),
  expectedCloseDate: isoDateTime.nullable(),
  outcome: DealOutcomeSchema,
  lostReasonId: z.string().nullable(),
  wonAt: isoDateTime.nullable(),
  lostAt: isoDateTime.nullable(),
  notes: z.string().nullable(),
  customFields: z.record(z.string(), z.any()),
  tags: z.array(TagSummarySchema),
  lastActivityAt: isoDateTime,
  /** Stalled, close date passed and how long (FIG-1035); the pipeline never moves a deal by itself. */
  signals: z
    .strictObject({
      stalled: z.boolean(),
      daysSinceActivity: z.number().int(),
      stalledAfterDays: z.number().int(),
      closeDatePassed: z.boolean(),
      closeDateOverdueDays: z.number().int(),
    })
    .nullable(),
  createdByMembershipId: z.string().nullable(),
  /** The data migration session that created this row, or null (FIG-1061). */
  importSessionId: z.string().nullable(),
  archivedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  company: relation(idName),
  primaryContact: relation({ id: z.string(), firstName: z.string() }).nullable(),
  lead: relation({ id: z.string() }).nullable(),
  service: relation(idName).nullable(),
  pipelineStage: relation({
    ...idName,
    key: z.string(),
    isWon: z.boolean(),
    isLost: z.boolean(),
  }),
  lostReason: relation(idName).nullable(),
  /** Pre-B0.06 name for `masked`; kept so the existing screens keep working. */
  valueMasked: z.boolean(),
  ...RecordMetaShape,
});

/** Adds the standard `archived`, `masked` and `scope` fields to a masked deal. */
export function toDealDto<
  T extends ArchivableRecord & {
    ownerMembershipId: string;
    outcome: "OPEN" | "WON" | "LOST";
    valueMasked: boolean;
    tagLinks?: { tag: TagSummary }[];
    pipelineStageId: string;
    lastActivityAt: Date;
    expectedCloseDate: Date | null;
  },
>(ctx: AuthContext, deal: T, rules?: StageRules) {
  return {
    ...flattenTags(deal),
    signals: rules ? signalsForDeal(deal, rules) : null,
    archived: deal.archivedAt !== null,
    archive: archiveBanner(ctx, "deal", deal),
    masked: deal.valueMasked,
    ...recordAccess(ctx, "deals", {
      ownerMembershipId: deal.ownerMembershipId,
      outcome: deal.outcome,
    }),
  };
}
