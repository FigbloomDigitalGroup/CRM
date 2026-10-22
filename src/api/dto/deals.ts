import { z } from "zod";
import type { AuthContext } from "../../auth/context";
import {
  RecordMetaShape,
  decimalString,
  isoDateTime,
  recordScope,
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
  createdByMembershipId: z.string().nullable(),
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
  T extends {
    archivedAt: Date | null;
    ownerMembershipId: string;
    valueMasked: boolean;
  },
>(ctx: AuthContext, deal: T) {
  return {
    ...deal,
    archived: deal.archivedAt !== null,
    masked: deal.valueMasked,
    scope: recordScope(
      ctx,
      {
        viewAll: "deals.view.all",
        editAll: "deals.edit.all",
        editOwn: "deals.edit.own",
      },
      deal.ownerMembershipId,
    ),
  };
}
