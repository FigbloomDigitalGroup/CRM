import type { AuthContext } from "../auth/context";
import { ValidationError } from "../auth/errors";
import { assertWritable } from "../lib/archive";
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
 * Shared by Activities and Tasks: both link to an arbitrary subset of
 * Company/Contact/Lead/Deal, and both have a flat permission
 * (`activities.*`/`tasks.*`) that says nothing about *which* records the
 * caller may touch. Rather than inventing a parallel ownership model,
 * this reuses each parent's own service-layer view check, so a Sales rep
 * can't read or write an activity/task against a colleague's lead just by
 * holding the flat permission. `requireAtLeastOne` only applies to
 * Activities (DB-enforced via `activities_has_subject_chk`); Tasks may
 * stand alone.
 */
export async function assertCanAccessLinkedRecords(
  ctx: AuthContext,
  ids: LinkedRecordIds,
  {
    requireAtLeastOne = false,
    requireWritable = false,
  }: {
    requireAtLeastOne?: boolean;
    /** Creating something under an archived record is a write to it (B2.16): refuse with `ARCHIVED_READ_ONLY`. */
    requireWritable?: boolean;
  } = {},
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
  if (ids.companyId) {
    const company = await getCompany(ctx, ids.companyId);
    if (requireWritable) assertWritable(ctx, "company", company, "adding to it");
  }
  if (ids.contactId) {
    const contact = await getContact(ctx, ids.contactId);
    if (requireWritable) assertWritable(ctx, "contact", contact, "adding to it");
  }
  if (ids.leadId) {
    const lead = await getLead(ctx, ids.leadId);
    if (requireWritable) assertWritable(ctx, "lead", lead, "adding to it");
  }
  if (ids.dealId) {
    const deal = await getDeal(ctx, ids.dealId);
    if (requireWritable) assertWritable(ctx, "deal", deal, "adding to it");
  }
}
