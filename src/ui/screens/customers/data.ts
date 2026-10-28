"use client";

import { useMemo } from "react";
import type { Operations } from "@/api-client";
import { useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { useDebounced } from "../leads/data";
import { makeFormat } from "../leads/format";

export { useDebounced };

/** One company row from the directory (the contract types the row loosely, so the fields the screens read are written out here). */
export interface CompanyRow {
  id: string;
  name: string;
  industry: string | null;
  website: string | null;
  location: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  ownerMembershipId: string | null;
  owner: { id: string; user: { name: string } } | null;
  lifecycleState: { id: string; key: string; name: string } | null;
  archivedAt: string | null;
  mergedIntoId?: string | null;
  _count?: { contacts: number };
}

export interface ContactRow {
  id: string;
  firstName: string;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  jobTitle: string | null;
  department?: string | null;
  notes?: string | null;
  companyId: string | null;
  company?: { id: string; name: string } | null;
  ownerMembershipId: string | null;
  owner?: { id: string; user: { name: string } } | null;
  archivedAt: string | null;
}

export type SectionResult<T> =
  | { status: "ok"; scope: "organisation" | "own" | "read-only"; data: T }
  | { status: "no_access"; requires: string[]; reason: string; yourRole: string; ownerRoles: string[] }
  | { status: "not_available"; reason: string };

export interface Profile {
  id: string;
  name: string;
  industry: string | null;
  website: string | null;
  location: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  archived: boolean;
  archivedAt: string | null;
  archiveReason: string | null;
  mergedIntoId: string | null;
  owner: { membershipId: string; name: string } | null;
  lifecycle: { state: { id: string; key: string; name: string } | null; changedAt: string | null; manual: boolean };
  contacts: { id: string; name: string; email: string | null; phone: string | null; jobTitle: string | null }[];
  tags: { id: string; name: string }[];
  health: { score: number; band: string; factors: { key: string; label: string; points: number }[] } | null;
  createdAt: string;
}

export interface ServiceLink {
  id: string;
  serviceId: string;
  name: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  notes: string | null;
}
export interface RecurringView {
  id: string;
  serviceName: string;
  billingCycle: string;
  value: string | null;
  valueMasked: boolean;
  currency: string;
  startsOn: string | null;
  renewsOn: string | null;
  daysToRenewal: number | null;
  state: string;
  cancelledAt: string | null;
  autoRenew: boolean;
}
export interface ServicesData {
  services: ServiceLink[];
  recurring: RecurringView[];
}

export interface DealItem {
  id: string;
  stage: string;
  outcome: string | null;
  service: string | null;
  value: string | null;
  valueMasked: boolean;
  currency: string;
  expectedCloseDate: string | null;
  wonAt: string | null;
  lostAt: string | null;
  archived: boolean;
  owner: { membershipId: string; name: string } | null;
}
export interface DealsData {
  total: number;
  items: DealItem[];
}

export interface TaskItem {
  id: string;
  title: string;
  priority: string;
  status: string;
  dueAt: string | null;
  assignee: { membershipId: string; name: string } | null;
  dealId?: string | null;
}
export interface TasksData {
  total: number;
  items: TaskItem[];
}

export interface TimelineItem {
  kind: "ACTIVITY" | "COMMUNICATION" | "LIFECYCLE" | "AUDIT";
  id: string;
  at: string;
  title: string;
  detail: string | null;
  type?: string;
  channel?: string;
  direction?: string;
  outcome?: string | null;
  actorName?: string | null;
  authorName?: string | null;
  [key: string]: unknown;
}
export interface TimelineData {
  items: TimelineItem[];
  nextCursor: string | null;
  limit: number;
}

export interface InvoiceItem {
  id: string;
  number: string;
  dealId: string | null;
  status: string;
  amount: string;
  currency: string;
  paid: string;
  balance: string;
  dueOn: string | null;
}
export interface PaymentsData {
  totals: { invoiced: string; received: string; outstanding: string; overdueInvoices: number };
  items: InvoiceItem[];
  followUpNotes: { dealId: string; note: string; ownerMembershipId: string | null; nextOn: string | null }[];
}

export interface HandoffsData {
  items: { id: string; dealId: string; status: string; startDate: string | null; deliveryOwner: { membershipId: string; name: string } | null; requirements?: string[] }[];
}

export interface Customer360 {
  company: { id: string; name: string; archived: boolean; readOnly: boolean };
  sections: {
    profile?: SectionResult<Profile>;
    services?: SectionResult<ServicesData>;
    deals?: SectionResult<DealsData>;
    tasks?: SectionResult<TasksData>;
    timeline?: SectionResult<TimelineData>;
    handoffs?: SectionResult<HandoffsData>;
    payments?: SectionResult<PaymentsData>;
    nextFollowUp?: SectionResult<{ next: { source: string; id: string; title: string; at: string | null; overdue: boolean } | null }>;
    tickets?: SectionResult<unknown>;
  };
  requested: string[];
}

export type Reference = Operations["getReferenceData"]["response"];

export interface LifecycleState {
  id: string;
  key: string;
  name: string;
}

/** The organisation's lifecycle states and members, from the one reference call. */
export function useCustomerReference() {
  const { orgSlug, membershipId, userName, roleName } = useMember();
  const q = useApiQuery("getReferenceData", { params: { orgSlug } }, { staleTime: 5 * 60_000 });
  return useMemo(() => {
    const ref = q.data;
    const states = [...((ref?.lifecycleStates ?? []) as (LifecycleState & { isActive: boolean; sequence: number })[])].filter((s) => s.isActive).sort((a, b) => a.sequence - b.sequence);
    const members = [
      ...((ref?.members ?? []) as { membershipId: string; userName: string; roleName: string }[]).filter((m) => m.membershipId !== membershipId),
      { membershipId, userName, roleName },
    ];
    const names = new Map(members.map((m) => [m.membershipId, m.userName]));
    return { loaded: Boolean(ref), states, members, ownerName: (id: string | null | undefined) => (id ? (names.get(id) ?? null) : null) };
  }, [q.data, membershipId, userName, roleName]);
}

export function useFormatters() {
  const m = useMember();
  return useMemo(() => makeFormat({ timeZone: m.timeZone, hour12: m.hour12 }), [m.timeZone, m.hour12]);
}

/** The lifecycle pill colours, by the state's key (the names are the organisation's own and can be renamed). */
export function lifecycleTone(key: string | null | undefined): [string, string] {
  switch (key) {
    case "CUSTOMER":
    case "ACTIVE_CUSTOMER":
      return ["var(--primary-soft)", "var(--primary-text)"];
    case "ONBOARDING":
      return ["var(--blue-soft)", "var(--blue)"];
    case "DORMANT_CUSTOMER":
      return ["var(--orange-soft)", "var(--orange-text)"];
    case "RENEWAL":
      return ["var(--purple-soft)", "var(--purple)"];
    default:
      return ["var(--surface-3)", "var(--text-2)"];
  }
}

/** Invoice status colours (the design's `invTone`). */
export function invoiceTone(status: string): [string, string] {
  switch (status.toUpperCase()) {
    case "PAID":
      return ["var(--primary-soft)", "var(--primary-text)"];
    case "SENT":
    case "PARTIALLY_PAID":
      return ["var(--blue-soft)", "var(--blue)"];
    case "OVERDUE":
      return ["var(--red-soft)", "var(--red)"];
    default:
      return ["var(--surface-3)", "var(--text-2)"];
  }
}

/** A deal stage's dot colour (the design's `stageTone`). */
export function stageDot(stage: string, outcome?: string | null): string {
  if (outcome === "WON" || /won/i.test(stage)) return "var(--primary)";
  if (outcome === "LOST" || /lost/i.test(stage)) return "var(--red)";
  if (/proposal/i.test(stage)) return "var(--orange)";
  if (/negotiation/i.test(stage)) return "var(--primary)";
  return "var(--blue)";
}

export function humanise(key: string): string {
  const s = key.replace(/_/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function initialsFrom(name: string | null | undefined): string {
  const parts = (name ?? "").replace(/^Dev /, "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "–";
  return ((parts[0]![0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]![0] ?? "") : "")).toUpperCase();
}

export function contactFullName(c: { firstName: string; lastName?: string | null }): string {
  return [c.firstName, c.lastName].filter(Boolean).join(" ");
}

/** The numbers and links a call or WhatsApp action needs. */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}
export function waHref(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  const intl = digits.startsWith("0") ? `254${digits.slice(1)}` : digits;
  return `https://wa.me/${intl}`;
}
