"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { Operations } from "@/api-client";
import { useMember } from "../../data/member";

/** One row of the contact directory (`listContactDirectory`): the contract types the row loosely, so what the screens read is written out here. */
export interface ContactRow {
  id: string;
  firstName: string;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  companyId?: string | null;
  company?: { id: string; name: string } | null;
  ownerMembershipId: string;
  owner?: { id: string; user?: { name: string } | null } | null;
  archivedAt?: string | null;
  tags?: unknown[];
}

export type ContactDetail = Operations["getContactsByContactId"]["response"] & {
  socialProfiles?: unknown;
};

export interface DirectoryCounts {
  all?: number;
  standalone?: number;
  missingEmail?: number;
  missingPhone?: number;
  archived?: number;
}

export const contactName = (c: { firstName: string; lastName?: string | null }): string => [c.firstName, c.lastName].filter(Boolean).join(" ");

export const ownerName = (c: { owner?: { user?: { name: string } | null } | null }): string => c.owner?.user?.name ?? "Unassigned";

/** The design's own wording for the person's two-letter badge. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

/** Numbers without a country code are taken to be Kenyan (254), the same rule the quick-log endpoint applies. */
export function dialLinks(phone: string | null | undefined): { tel: string; whatsapp: string } | null {
  if (!phone) return null;
  const hasPlus = phone.trim().startsWith("+");
  let digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return null;
  if (!hasPlus) {
    if (digits.startsWith("00")) digits = digits.slice(2);
    else if (digits.startsWith("0")) digits = `254${digits.slice(1)}`;
    else if (digits.length <= 9) digits = `254${digits}`;
  }
  return { tel: `tel:+${digits}`, whatsapp: `https://wa.me/${digits}` };
}

/**
 * What this member may do with one contact: the same rules as `accountCapabilities` on the server (which still enforces them). Contacts are
 * shared across the organisation (no own/all split); handing one to someone else needs edit rights and `membership.manage`.
 */
export function useContactCaps() {
  const m = useMember();
  return (contact: { archivedAt?: unknown }) => {
    const archived = Boolean(contact.archivedAt);
    const mayEdit = m.can("contacts.edit");
    return {
      archived,
      canEdit: mayEdit && !archived,
      canArchive: m.can("contacts.archive") && !archived,
      canRestore: m.can("contacts.archive") && archived,
      canMerge: m.can("contacts.merge") && !archived,
      canReassign: mayEdit && m.can("membership.manage") && !archived,
      /** Call and WhatsApp are logged through the conversations endpoint, so that is the permission that decides. */
      canReach: m.can("communications.create"),
    };
  };
}

export type ContactCaps = ReturnType<ReturnType<typeof useContactCaps>>;

/** Everything a contact change can make stale: the list and its counts, the page, and what hangs off it. */
export function useRefreshContacts() {
  const qc = useQueryClient();
  return useCallback(
    () =>
      Promise.all(
        ["listContactDirectory", "getContacts", "getContactsByContactId", "getActivities", "getCommunications", "getTasks", "getAudit", "getCompaniesByCompanyId"].map((id) =>
          qc.invalidateQueries({ queryKey: [id] }),
        ),
      ),
    [qc],
  );
}
