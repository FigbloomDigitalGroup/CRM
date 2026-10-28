"use client";

import { useEffect, useState } from "react";
import type { Operations } from "@/api-client";

/** Shared reading helpers for the Conversations hub and Renewals screens (M8, F3.04 and F3.05). */

export type ConversationRow = Operations["listConversations"]["response"]["items"][number];
export type ConversationList = Operations["listConversations"]["response"];
export type NeedsLinkingList = Operations["listNeedsLinking"]["response"];
export type Retention = Operations["getRenewalsAndRetention"]["response"];

/** What the API sends on each row beyond the contract's typed fields (src/services/conversationService.ts is the source). */
export interface ConversationLink {
  companyId: string | null;
  companyName: string | null;
  contactId: string | null;
  contactName: string | null;
  leadId: string | null;
  dealId: string | null;
}
export interface Counterparty {
  name: string | null;
  email: string | null;
  phone: string | null;
}

export function linkOf(row: ConversationRow): ConversationLink {
  const l = (row.link ?? {}) as Partial<ConversationLink>;
  return { companyId: l.companyId ?? null, companyName: l.companyName ?? null, contactId: l.contactId ?? null, contactName: l.contactName ?? null, leadId: l.leadId ?? null, dealId: l.dealId ?? null };
}
export function counterpartyOf(row: ConversationRow): Counterparty {
  const c = (row.counterparty ?? {}) as Partial<Counterparty>;
  return { name: c.name ?? null, email: c.email ?? null, phone: c.phone ?? null };
}
export const ownerOf = (row: ConversationRow): string | null => (typeof row.ownerMembershipId === "string" ? row.ownerMembershipId : null);

/** The names the prototype's chan() gives each channel: label, icon, and the chip's soft background and ink. */
export interface ChannelStyle {
  label: string;
  icon: string;
  bg: string;
  fg: string;
}
export function channelStyle(channel: string): ChannelStyle {
  switch (channel.toUpperCase()) {
    case "PHONE":
    case "CALL":
      return { label: "Call", icon: "phone", bg: "var(--primary-soft)", fg: "var(--primary-text)" };
    case "WHATSAPP":
      return { label: "WhatsApp", icon: "whatsapp", bg: "var(--primary-soft)", fg: "var(--primary-text)" };
    case "EMAIL":
      return { label: "Email", icon: "mail", bg: "var(--blue-soft)", fg: "var(--blue)" };
    case "MEETING":
      return { label: "Meeting", icon: "users", bg: "var(--purple-soft)", fg: "var(--purple)" };
    case "SMS":
    case "SOCIAL":
      return { label: "Message", icon: "message", bg: "var(--orange-soft)", fg: "var(--orange-text)" };
    default:
      return { label: "Note", icon: "note", bg: "var(--surface-3)", fg: "var(--text-2)" };
  }
}

/** Where a conversation's record lives, for "open". The most specific record wins (deal, lead, contact, company). */
export function recordPath(link: ConversationLink): { path: string; label: string } | null {
  if (link.dealId) return { path: `/deals/${link.dealId}`, label: "deal" };
  if (link.leadId) return { path: `/leads/${link.leadId}`, label: "lead" };
  if (link.contactId) return { path: `/contacts/${link.contactId}`, label: "contact" };
  if (link.companyId) return { path: `/companies/${link.companyId}`, label: "customer" };
  return null;
}

/** The one record a quick-log names (the API wants exactly one of contact, lead, company or deal). */
export function quickLogTarget(link: ConversationLink): { dealId: string } | { leadId: string } | { contactId: string } | { companyId: string } | null {
  if (link.dealId) return { dealId: link.dealId };
  if (link.leadId) return { leadId: link.leadId };
  if (link.contactId) return { contactId: link.contactId };
  if (link.companyId) return { companyId: link.companyId };
  return null;
}

export function whoOf(row: ConversationRow): string {
  const link = linkOf(row);
  const cp = counterpartyOf(row);
  return link.companyName || link.contactName || cp.name || cp.email || cp.phone || "Unknown sender";
}

/** "TODAY", "YESTERDAY", "28 OCT": the day rule's label for a feed group, in the person's zone. */
export function dayLabel(iso: string, now: Date, timeZone: string | null): string {
  const key = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: timeZone ?? undefined, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const d = new Date(iso);
  if (key(d) === key(now)) return "TODAY";
  if (key(d) === key(new Date(now.getTime() - 86_400_000))) return "YESTERDAY";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timeZone ?? undefined, day: "numeric", month: "short" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")} ${get("month")}`.toUpperCase();
}

export function groupByDay<T extends { occurredAt: string }>(rows: T[], now: Date, timeZone: string | null): { label: string; items: T[] }[] {
  const groups: { label: string; items: T[] }[] = [];
  for (const r of rows) {
    const label = dayLabel(r.occurredAt, now, timeZone);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(r);
    else groups.push({ label, items: [r] });
  }
  return groups;
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function writeStore(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private window or blocked storage: the choice just is not remembered */
  }
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
