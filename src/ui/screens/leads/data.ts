"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Operations } from "@/api-client";
import { useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { makeFormat } from "./format";

export type LeadRow = Operations["listLeads"]["response"]["items"][number];
export type LeadDetail = Operations["getLeadsByLeadId"]["response"];
export type Reference = Operations["getReferenceData"]["response"];
/** The qualification view, with the parts the contract leaves loose written out (src/services/qualificationService.ts is the source). */
export interface Qualification {
  leadId: string;
  questions: {
    key: string;
    label: string;
    fieldType: "TEXT" | "NUMBER" | "DATE" | "SELECT" | "MULTISELECT" | "BOOLEAN" | string;
    options: { label: string; value: string }[];
    helpText: unknown;
    required: boolean;
    requiredOnQualify: boolean;
    answer?: unknown;
    answered: boolean;
  }[];
  progress: {
    stages: { key: string; name: string; state: "done" | "current" | "todo" }[];
    offStrip?: { key: string; name: string } | null;
    missing: { key: string; label: string; message: string }[];
    canQualify: boolean;
    qualified: boolean;
  };
}

/** The contact on a lead, as much of it as the screens read (the contract types the rest loosely). */
export interface ContactLike {
  id: string;
  firstName: string;
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
  jobTitle?: string | null;
}

export function contactOf(lead: { contact?: unknown }): ContactLike | null {
  return (lead.contact as ContactLike | null | undefined) ?? null;
}

export function contactName(c: ContactLike | null | undefined): string {
  return c ? [c.firstName, c.lastName].filter(Boolean).join(" ") : "";
}

/** What a lead is called everywhere: its company, else its contact (a person we only know by name). */
export function leadName(lead: { company?: { name: string } | null; contact?: unknown }): string {
  return lead.company?.name || contactName(contactOf(lead)) || "Unnamed lead";
}

export function useFormatters() {
  const m = useMember();
  return useMemo(() => makeFormat({ timeZone: m.timeZone, hour12: m.hour12 }), [m.timeZone, m.hour12]);
}

export interface Owner {
  membershipId: string;
  name: string;
  roleName: string;
}

/**
 * The organisation's lists (statuses, sources, services, lost reasons, members) from the one reference call, with the lookups every
 * lead screen needs. Owners are the members who work leads (the API checks again on assign).
 */
export function useReference() {
  const { orgSlug, membershipId, userName, roleName, permissionKeys } = useMember();
  const q = useApiQuery("getReferenceData", { params: { orgSlug } }, { staleTime: 5 * 60_000 });
  const ref = q.data;
  return useMemo(() => {
    const statuses = [...(ref?.leadStatuses ?? [])].filter((s) => s.isActive).sort((a, b) => a.sequence - b.sequence);
    const sources = [...(ref?.leadSources ?? [])].filter((s) => s.isActive).sort((a, b) => a.sequence - b.sequence);
    const services = [...(ref?.services ?? [])].filter((s) => s.isActive).sort((a, b) => a.sequence - b.sequence);
    const lostReasons = [...(ref?.lostReasons ?? [])].filter((s) => s.isActive).sort((a, b) => a.sequence - b.sequence);
    // The reference call lists the other members; the signed-in person is added so their own name and their own leads read correctly.
    const members = (ref?.members ?? []).filter((m) => m.membershipId !== membershipId);
    const worksLeads = permissionKeys.some((k) => k === "leads.edit.own" || k === "leads.edit.all");
    // Every other member is offered, each with their role beside the name: which roles may own a lead is the server's rule (a screen never decides by role), and it refuses and explains if the choice cannot own one.
    const owners: Owner[] = [
      ...members.map((m) => ({ membershipId: m.membershipId, name: m.userName, roleName: m.roleName })),
      ...(worksLeads ? [{ membershipId, name: userName, roleName }] : []),
    ];
    const memberById = new Map<string, { userName: string }>([...members.map((m) => [m.membershipId, m] as const), [membershipId, { userName }]]);
    return {
      loaded: Boolean(ref),
      isError: q.isError,
      statuses,
      sources,
      services,
      lostReasons,
      owners,
      status: (id: string | null | undefined) => statuses.find((s) => s.id === id),
      statusByKey: (key: string) => statuses.find((s) => s.key === key),
      source: (id: string | null | undefined) => sources.find((s) => s.id === id),
      service: (id: string | null | undefined) => services.find((s) => s.id === id),
      memberName: (id: string | null | undefined) => (id ? (memberById.get(id)?.userName ?? null) : null),
    };
  }, [ref, q.isError, membershipId, userName, roleName, permissionKeys]);
}

export type ReferenceLookups = ReturnType<typeof useReference>;

/** What this member may do with one lead: the same rules as `leadCapabilities` on the server (which still enforces them). */
export function useLeadCaps() {
  const m = useMember();
  return (lead: { ownerMembershipId: string | null | undefined; archivedAt?: unknown; convertedAt?: unknown }) => {
    const archived = Boolean(lead.archivedAt);
    const converted = Boolean(lead.convertedAt);
    const isMine = lead.ownerMembershipId === m.membershipId;
    const mayEdit = m.can("leads.edit.all") || (m.can("leads.edit.own") && isMine);
    const mayArchive = m.can("leads.archive.all") || (m.can("leads.archive.own") && isMine);
    return {
      archived,
      converted,
      isMine,
      canEdit: mayEdit && !archived,
      canConvert: mayEdit && m.can("leads.convert") && !archived && !converted,
      canArchive: mayArchive && !archived,
      canRestore: mayArchive && archived,
      canReassign: m.can("leads.assign") && !archived && !converted,
      reassignLocked: !m.can("leads.assign"),
    };
  };
}

export type LeadCaps = ReturnType<ReturnType<typeof useLeadCaps>>;

/** Download a text file the browser already has (an error report, a CSV the API returned). */
export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Everything a lead change can make stale: the lists and counts, the pool, the lead page and what hangs off it. */
export function useRefreshLeads() {
  const qc = useQueryClient();
  return useCallback(
    () =>
      Promise.all(
        ["listLeads", "getLeadsPool", "getLeadsByLeadId", "getLeadsByLeadIdQualification", "getLeadsByLeadIdScore", "getActivities", "getTasks", "getAudit"].map((id) =>
          qc.invalidateQueries({ queryKey: [id] }),
        ),
      ),
    [qc],
  );
}

/** A value that follows `value` after `ms` of quiet, for search-as-you-type that should not call the API on every key. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** How an owner is written in a list of people, as the design does: the name and the role ("Dev Sales (Sales)"). */
export const ownerLabel = (o: Owner, selfId?: string): string => (o.membershipId === selfId ? `${o.name} (you)` : `${o.name} (${o.roleName})`);
