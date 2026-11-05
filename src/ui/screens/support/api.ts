"use client";

import type { UseQueryResult } from "@tanstack/react-query";
import { useApiMutation, useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";

/**
 * The data layer of the Customer Support screens (FIG-1178, wired to FIG-1155): tickets, their messages, the role-limited customer view and the
 * satisfaction surveys, through the typed client. The contract types these answers as `unknown`, so the shapes (from `src/services/ticketService.ts`)
 * are written here once.
 */

export type TicketStatus = "OPEN" | "WAITING_ON_CLIENT" | "RESOLVED";
export const STATUSES: TicketStatus[] = ["OPEN", "WAITING_ON_CLIENT", "RESOLVED"];
export const STATUS_LABEL: Record<string, string> = { OPEN: "Open", WAITING_ON_CLIENT: "Waiting on client", RESOLVED: "Resolved" };
export const PRIORITY_LABEL: Record<string, string> = { HIGH: "High", MEDIUM: "Medium", LOW: "Low" };

export interface Ticket {
  id: string;
  number: number;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  company: { id: string; name: string };
  contact: { id: string; name: string } | null;
  owner: { membershipId: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}
export interface TicketMessage {
  id: string;
  kind: "CUSTOMER" | "STAFF" | "INTERNAL" | string;
  author: string;
  body: string;
  at: string;
}
export interface Survey {
  id: string;
  companyId: string;
  ticketId: string | null;
  sentAt: string;
  expiresAt: string;
  status: "WAITING" | "ANSWERED" | "EXPIRED";
  score: number | null;
  comment: string | null;
}
export interface Page<T> {
  items: T[];
  total: number;
}
export interface SurveyPage extends Page<Survey> {
  summary: { sent: number; answered: number; averageScore: number | null };
}
export interface SupportCustomer {
  company: { id: string; name: string; industry: string | null; location: string | null; phone: string | null; email: string | null; lifecycle: string | null };
  contacts: { id: string; name: string; jobTitle: string | null; email: string | null; phone: string | null }[];
  services: { id: string; name: string; status: string; since: string | null }[];
  tickets: { id: string; number: number; title: string; status: string; priority: string; openedAt: string }[];
  satisfaction: { id: string; score: number | null; comment: string | null; answeredAt: string | null }[];
}

/** Date and time the way the rest of the app writes them, in the person's time zone. */
export function useWhen() {
  const { timeZone, hour12 } = useMember();
  return (iso: string) =>
    new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12, timeZone: timeZone ?? undefined });
}

export function useTicketList() {
  const { orgSlug } = useMember();
  return useApiQuery("getTickets", { params: { orgSlug }, query: { pageSize: "100" } }) as unknown as UseQueryResult<Page<Ticket>>;
}
export function useTicket(ticketId: string) {
  const { orgSlug } = useMember();
  return useApiQuery("getTicketsByTicketId", { params: { orgSlug, ticketId } }) as unknown as UseQueryResult<Ticket & { messages: TicketMessage[] }>;
}
export function useSupportCustomer(companyId: string | undefined) {
  const { orgSlug } = useMember();
  return useApiQuery("getSupportCustomersByCompanyId", { params: { orgSlug, companyId: companyId ?? "" } }, { enabled: !!companyId }) as unknown as UseQueryResult<SupportCustomer>;
}
export function useSurveyList() {
  const { orgSlug } = useMember();
  return useApiQuery("getSurveys", { params: { orgSlug }, query: { pageSize: "100" } }) as unknown as UseQueryResult<SurveyPage>;
}

const TICKET_READS = [["getTickets"], ["getTicketsByTicketId"], ["getSupportCustomersByCompanyId"], ["getSurveys"]];

/** Change a ticket's status (or priority, owner) in place; the list, the ticket and the customer view are read again afterwards. */
export function usePatchTicket() {
  return useApiMutation("patchTicketsByTicketId", { invalidate: TICKET_READS });
}
/** Add a reply (STAFF) or an internal note (INTERNAL) to the thread. Staff-recorded: email delivery of replies is not built (docs/SUPPORT_TICKETS.md). */
export function useAddTicketMessage() {
  return useApiMutation("postTicketsByTicketIdMessages", { invalidate: TICKET_READS });
}
/** Email the satisfaction survey for a resolved ticket to its contact. */
export function useSendSurvey() {
  return useApiMutation("postSurveys", { invalidate: TICKET_READS });
}
