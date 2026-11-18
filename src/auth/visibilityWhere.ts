import type { Prisma } from "@prisma/client";
import type { AuthContext } from "./context";
import { hasPermission } from "./context";

/**
 * Database filters that mirror `canView` (src/auth/permissions.ts), for lists that cross record types. A filter of
 * `null` means the caller may not see any record of that type; `{}` means every record.
 *
 * Use these whenever a query can reach a record through a link (a message linked to a lead, a note linked to a deal),
 * so a caller never lists something attached to a record they could not open themselves.
 */

export function leadVisibleWhere(ctx: AuthContext): Prisma.LeadWhereInput | null {
  if (hasPermission(ctx, "leads.view.all")) return {};
  const or: Prisma.LeadWhereInput[] = [];
  if (hasPermission(ctx, "leads.view.own")) or.push({ ownerMembershipId: ctx.membershipId });
  if (hasPermission(ctx, "leads.view.shared")) or.push({ ownerMembershipId: null });
  return or.length > 0 ? { OR: or } : null;
}

export function dealVisibleWhere(ctx: AuthContext): Prisma.DealWhereInput | null {
  if (hasPermission(ctx, "deals.view.all")) return {};
  const or: Prisma.DealWhereInput[] = [];
  if (hasPermission(ctx, "deals.view.own")) or.push({ ownerMembershipId: ctx.membershipId });
  if (hasPermission(ctx, "deals.view.won")) or.push({ outcome: "WON" });
  return or.length > 0 ? { OR: or } : null;
}

/**
 * For a row that links to up to four records (lead, deal, company, contact): the row is visible only when the caller
 * may open every record it links to. A row with no link on a given column passes that column.
 */
export function linkedRecordsVisibleWhere(ctx: AuthContext): Prisma.CommunicationWhereInput & Prisma.ActivityWhereInput {
  const and: Prisma.CommunicationWhereInput[] = [];

  const lead = leadVisibleWhere(ctx);
  if (lead === null) and.push({ leadId: null });
  else if (Object.keys(lead).length > 0) and.push({ OR: [{ leadId: null }, { lead }] });

  const deal = dealVisibleWhere(ctx);
  if (deal === null) and.push({ dealId: null });
  else if (Object.keys(deal).length > 0) and.push({ OR: [{ dealId: null }, { deal }] });

  if (!hasPermission(ctx, "companies.view")) and.push({ companyId: null });
  if (!hasPermission(ctx, "contacts.view")) and.push({ contactId: null });

  return and.length > 0 ? { AND: and } : {};
}
