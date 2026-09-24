import type { AuthContext } from "../auth/context";
import { ValidationError } from "../auth/errors";
import { getCompany } from "./companyService";
import { getContact } from "./contactService";
import { getDeal } from "./dealService";
import { getLead } from "./leadService";

export interface LinkedRecordIds {
  companyId?: string;
  contactId?: string;
  leadId?: string;
  dealId?: string;
}

/**
 * Shared by Activities and Tasks (FIG-441): both link to an arbitrary
 * subset of Company/Contact/Lead/Deal, and both have their own flat
 * permission (`activities.*`/`tasks.*`) that says nothing about *which*
 * records the caller may touch. Rather than inventing a parallel
 * ownership model, this reuses each parent's own service-layer view check
 * -- which is exactly where lead/deal ownership scoping already lives
 * (`leads.view.own` vs `.all`, etc.) -- so a Sales rep can't read or write
 * an activity/task against a colleague's lead just because they hold the
 * flat permission. `requireAtLeastOne` is only relevant for Activities
 * (the DB enforces "at least one" for that table via
 * `activities_has_subject_chk`); Tasks are allowed to stand alone.
 */
export async function assertCanAccessLinkedRecords(
  ctx: AuthContext,
  ids: LinkedRecordIds,
  { requireAtLeastOne = false }: { requireAtLeastOne?: boolean } = {},
) {
  if (
    requireAtLeastOne &&
    !ids.companyId &&
    !ids.contactId &&
    !ids.leadId &&
    !ids.dealId
  ) {
    throw new ValidationError(
      "Must be linked to at least one of company, contact, lead, or deal.",
    );
  }
  if (ids.companyId) await getCompany(ctx, ids.companyId);
  if (ids.contactId) await getContact(ctx, ids.contactId);
  if (ids.leadId) await getLead(ctx, ids.leadId);
  if (ids.dealId) await getDeal(ctx, ids.dealId);
}
