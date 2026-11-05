"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useApiMutation, useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";

/**
 * The one data module of the Communication screens (Chat, Mail, Video Conference), on the real V1.1 API (docs/COMMUNICATION.md,
 * MAIL_AND_CALENDAR_SYNC.md, OAUTH_CONNECTIONS.md). The contract types most of these answers as `unknown`, so the shapes the screens read are
 * written out here from the services that produce them. Chat polls (the transport the API chose); nothing here calls `fetch`.
 */

/* Chat ------------------------------------------------------------------------------------------------------------------------------ */

export type Presence = "ONLINE" | "AWAY" | "OFFLINE";
export interface CardView {
  type: "DEAL" | "COMPANY" | "LEAD" | "INVOICE";
  id: string;
  noAccess: boolean;
  name: string | null;
  stage?: string | null;
  value?: number | null;
  paymentDue?: number | null;
}
export interface ChannelItem {
  id: string;
  kind: "PUBLIC" | "PRIVATE" | "DIRECT" | "RECORD";
  name: string | null;
  description: string | null;
  private: boolean;
  record: { type: "DEAL" | "COMPANY" | "LEAD"; id: string } | null;
  archived: boolean;
  memberCount: number;
  joined: boolean;
  unread: number;
  mentions: number;
  lastSeq: number;
  partner: { membershipId: string; name: string } | null;
}
export interface MessageItem {
  id: string;
  channelId: string;
  seq: number;
  authorMembershipId: string | null;
  authorName: string | null;
  body: string | null;
  deleted: boolean;
  erased: boolean;
  card: CardView | null;
  mentions: string[];
  attachments: { fileId: string; name: string; sizeBytes: number; mimeType: string }[];
  reactions: { emoji: string; count: number; mine: boolean }[];
  canDelete: boolean;
  createdAt: string;
}
export interface PersonItem {
  membershipId: string;
  name: string;
  roleName: string;
  presence: Presence;
  you: boolean;
}

export const EMOJI = ["👍", "🎉", "✅", "🙏", "😀", "👀"];
export const channelTitle = (c: Pick<ChannelItem, "name" | "partner" | "kind">) => (c.kind === "DIRECT" ? (c.partner?.name ?? "Direct message") : (c.name ?? "channel"));
export const formatKes = (n: number) => `KES ${n.toLocaleString("en-KE")}`;

/** The partial `@word` at the end of a draft, if any, so the composer can offer people to complete it. */
export function mentionQuery(draft: string): string | null {
  const match = /(?:^|\s)@([A-Za-z]*)$/.exec(draft);
  return match ? match[1]! : null;
}
/** The people named in full after an at sign in `text`. */
export function mentionsIn(text: string, people: readonly { membershipId: string; name: string }[]): string[] {
  return people.filter((p) => text.includes(`@${p.name}`)).map((p) => p.membershipId);
}

export function useChannels(enabled = true) {
  const { orgSlug } = useMember();
  const q = useApiQuery("getChatChannels", { params: { orgSlug }, query: {} }, { enabled, refetchInterval: 6000 });
  const data = q.data as { items: ChannelItem[]; unreadTotal: number } | undefined;
  return { ...q, channels: data?.items ?? [], unreadTotal: data?.unreadTotal ?? 0 };
}

export function usePeople(enabled = true) {
  const { orgSlug } = useMember();
  const q = useApiQuery("getChatPeople", { params: { orgSlug } }, { enabled, refetchInterval: 30_000 });
  return { ...q, people: ((q.data as { items: PersonItem[] } | undefined)?.items ?? []) };
}

export function useMessages(channelId: string | null) {
  const { orgSlug } = useMember();
  const q = useApiQuery("getChatChannelsByChannelIdMessages", { params: { orgSlug, channelId: channelId ?? "" }, query: { limit: "100" } }, { enabled: Boolean(channelId), refetchInterval: 3000 });
  const data = q.data as { items: MessageItem[]; hasMore: boolean } | undefined;
  return { ...q, messages: data?.items ?? [] };
}

export function useChannelMembers(channelId: string | null, enabled: boolean) {
  const { orgSlug } = useMember();
  const q = useApiQuery("getChatChannelsByChannelIdMembers", { params: { orgSlug, channelId: channelId ?? "" } }, { enabled: enabled && Boolean(channelId) });
  return { ...q, members: ((q.data as { items: { membershipId: string; name: string; role: string; presence: Presence }[] } | undefined)?.items ?? []) };
}

/** Every chat write, each refreshing what it changes. */
export function useChatActions(channelId: string | null) {
  const { orgSlug } = useMember();
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["getChatChannels"] });
    void qc.invalidateQueries({ queryKey: ["getChatChannelsByChannelIdMessages"] });
  };
  const opts = { onSuccess: refresh };
  const post = useApiMutation("postChatChannelsByChannelIdMessages", opts);
  const react = useApiMutation("postChatChannelsByChannelIdMessagesByMessageIdReactions", opts);
  const unreact = useApiMutation("deleteChatChannelsByChannelIdMessagesByMessageIdReactions", opts);
  const remove = useApiMutation("deleteChatChannelsByChannelIdMessagesByMessageId", opts);
  const read = useApiMutation("postChatChannelsByChannelIdRead", { onSuccess: () => void qc.invalidateQueries({ queryKey: ["getChatChannels"] }) });
  const join = useApiMutation("postChatChannelsByChannelIdJoin", opts);
  const create = useApiMutation("postChatChannels", { onSuccess: () => void qc.invalidateQueries({ queryKey: ["getChatChannels"] }) });
  const cid = channelId ?? "";
  return {
    post: (body: { body?: string; card?: { type: CardView["type"]; id: string }; mentions?: string[]; fileIds?: string[] }, h?: { onSuccess?: () => void; onError?: (e: unknown) => void }) =>
      post.mutate({ params: { orgSlug, channelId: cid }, body }, h),
    posting: post.isPending,
    toggleReaction: (messageId: string, emoji: string, mine: boolean) =>
      mine ? unreact.mutate({ params: { orgSlug, channelId: cid, messageId }, query: { emoji } }) : react.mutate({ params: { orgSlug, channelId: cid, messageId }, body: { emoji } }),
    deleteMessage: (messageId: string) => remove.mutate({ params: { orgSlug, channelId: cid, messageId } }),
    markRead: (upToSeq: number) => read.mutate({ params: { orgSlug, channelId: cid }, body: { upToSeq } }),
    join: () => join.mutate({ params: { orgSlug, channelId: cid } }),
    create: (body: Parameters<typeof create.mutate>[0] extends infer A ? (A extends { body: infer B } ? B : never) : never, h: { onSuccess: (c: ChannelItem) => void; onError: (e: unknown) => void }) =>
      create.mutate({ params: { orgSlug }, body } as never, { onSuccess: (c) => h.onSuccess(c as unknown as ChannelItem), onError: h.onError }),
  };
}

/* Records (for cards, mail links and meetings) ----------------------------------------------------------------------------------------- */

export interface RecordRef {
  kind: "deal" | "company" | "lead" | "contact";
  id: string;
  label: string;
}
export const recordKindLabel = (k: RecordRef["kind"]) => ({ deal: "Deal", company: "Company", lead: "Lead", contact: "Contact" })[k];
const GROUP_KIND: Record<string, RecordRef["kind"]> = { deals: "deal", companies: "company", leads: "lead", contacts: "contact" };

/** Records matching what the person typed, from global search (which already hides what their role may not open). */
export function useRecordSearch(text: string, kinds: RecordRef["kind"][]) {
  const { orgSlug } = useMember();
  const q = text.trim();
  const query = useApiQuery("search", { params: { orgSlug }, query: { q } }, { enabled: q.length >= 2, staleTime: 10_000 });
  const results = useMemo(() => {
    const out: RecordRef[] = [];
    for (const g of query.data?.groups ?? []) {
      const kind = GROUP_KIND[g.type];
      if (kind && kinds.includes(kind)) for (const i of g.items) out.push({ kind, id: i.id, label: i.label });
    }
    return out;
  }, [query.data, kinds]);
  return { results, loading: query.isFetching, searched: q.length >= 2 };
}

/** The record's id in the field the mail and meeting calls expect. */
export const mailLinkFields = (r: RecordRef | null) => (r ? { [`${r.kind}Id`]: r.id } : {});
export const meetingLink = (r: RecordRef) => ({ type: ({ deal: "Deal", company: "Company", lead: "Lead", contact: "Contact" } as const)[r.kind], id: r.id });

/* Connections ------------------------------------------------------------------------------------------------------------------------- */

export interface ConnectionItem {
  id: string | null;
  kind: "EMAIL" | "CALENDAR";
  provider: "GOOGLE" | "MICROSOFT" | null;
  state: "CONNECTED" | "NEEDS_RECONNECT" | "DISCONNECTED";
  stateReason: string;
  accountEmail: string | null;
}

/** Whether the person's mailbox or calendar is connected, and the way to start connecting it (the provider's own sign-in page). */
export function useConnection(kind: ConnectionItem["kind"], enabled = true) {
  const { orgSlug } = useMember();
  const q = useApiQuery("getIntegrationsConnections", { params: { orgSlug } }, { enabled });
  const start = useApiMutation("postIntegrationsConnectionsStart");
  const item = ((q.data as { items: ConnectionItem[] } | undefined)?.items ?? []).find((c) => c.kind === kind) ?? null;
  const [starting, setStarting] = useState(false);
  return {
    item,
    connected: item?.state === "CONNECTED",
    ready: !q.isLoading,
    error: q.error,
    starting: starting || start.isPending,
    connect(provider: "GOOGLE" | "MICROSOFT", onError: (e: unknown) => void) {
      setStarting(true);
      start.mutate({ params: { orgSlug }, body: { kind, provider } as never }, {
        onSuccess: (r) => {
          const url = (r as { authorizationUrl?: string }).authorizationUrl;
          if (url) window.location.assign(url);
          else setStarting(false);
        },
        onError: (e) => {
          setStarting(false);
          onError(e);
        },
      });
    },
  };
}

/* Mail ------------------------------------------------------------------------------------------------------------------------------- */

export interface MailItem {
  id: string;
  folder: "inbox" | "sent" | "draft";
  counterparty: string;
  email: string | null;
  subject: string;
  preview: string;
  when: string;
  linked: boolean;
  linkLabel: string | null;
  draft?: DraftItem;
}
export interface DraftItem {
  id: string;
  to: string[];
  subject: string;
  body: string;
  status: string;
  replyToCommunicationId: string | null;
  companyId: string | null;
  contactId: string | null;
  leadId: string | null;
  dealId: string | null;
  updatedAt: string;
  lastError: string | null;
}
type ConvItem = { id: string; channel: string; direction: "INBOUND" | "OUTBOUND" | null; occurredAt: string; subject: string | null; summary: string | null; counterparty?: { name: string | null; email: string | null }; link?: { companyName?: string | null; contactName?: string | null; leadId?: string | null; dealId?: string | null; companyId?: string | null; contactId?: string | null }; needsLinking: boolean };

function linkLabelOf(l: ConvItem["link"]): string | null {
  if (!l) return null;
  if (l.dealId) return `Deal${l.companyName ? `: ${l.companyName}` : ""}`;
  if (l.leadId) return `Lead${l.contactName ? `: ${l.contactName}` : ""}`;
  if (l.contactId) return `Contact: ${l.contactName ?? ""}`.trim();
  if (l.companyId) return `Company: ${l.companyName ?? ""}`.trim();
  return null;
}
export function toMail(c: ConvItem, folder: MailItem["folder"]): MailItem {
  const label = linkLabelOf(c.link);
  return { id: c.id, folder, counterparty: c.counterparty?.name || c.counterparty?.email || "Unknown sender", email: c.counterparty?.email ?? null, subject: c.subject ?? "(no subject)", preview: c.summary ?? "", when: c.occurredAt, linked: Boolean(label), linkLabel: label };
}

export function useMailFolders(enabled: boolean) {
  const { orgSlug, can } = useMember();
  const view = can("communications.view");
  const on = enabled && view;
  const inbox = useApiQuery("listConversations", { params: { orgSlug }, query: { tab: "EMAIL", direction: "INBOUND", pageSize: "50" } }, { enabled: on, refetchInterval: 60_000 });
  const sent = useApiQuery("listConversations", { params: { orgSlug }, query: { tab: "EMAIL", direction: "OUTBOUND", pageSize: "50" } }, { enabled: on });
  const waiting = useApiQuery("listNeedsLinking", { params: { orgSlug }, query: { pageSize: "50" } }, { enabled: on });
  const drafts = useApiQuery("getCommunicationsMailDrafts", { params: { orgSlug } }, { enabled: enabled });
  const draftItems = ((drafts.data as { items: DraftItem[] } | undefined)?.items ?? []).filter((d) => d.status !== "SENT");
  const mail: Record<"inbox" | "unlinked" | "sent" | "draft", MailItem[]> = {
    inbox: ((inbox.data?.items ?? []) as ConvItem[]).map((c) => toMail(c, "inbox")),
    sent: ((sent.data?.items ?? []) as ConvItem[]).map((c) => toMail(c, "sent")),
    unlinked: ((waiting.data?.items ?? []) as ConvItem[]).filter((c) => c.channel === "EMAIL").map((c) => toMail(c, "inbox")),
    draft: draftItems.map((d) => ({ id: d.id, folder: "draft" as const, counterparty: d.to.join(", ") || "No recipient", email: d.to[0] ?? null, subject: d.subject || "(no subject)", preview: d.body.split("\n").find((l) => l.trim()) ?? "", when: d.updatedAt, linked: Boolean(d.companyId || d.contactId || d.leadId || d.dealId), linkLabel: null, draft: d })),
  };
  const errors = [inbox.error, sent.error, waiting.error, drafts.error].filter(Boolean);
  const loading = inbox.isLoading || sent.isLoading || waiting.isLoading || drafts.isLoading;
  return { mail, loading, error: view ? (errors[0] ?? null) : null, readable: view, refetch: () => void Promise.all([inbox.refetch(), sent.refetch(), waiting.refetch(), drafts.refetch()]) };
}

export function useMailActions() {
  const { orgSlug } = useMember();
  const qc = useQueryClient();
  const all = () => {
    for (const k of ["listConversations", "listNeedsLinking", "getCommunicationsMailDrafts"]) void qc.invalidateQueries({ queryKey: [k] });
  };
  const send = useApiMutation("postCommunicationsMailSend", { onSuccess: all });
  const createDraft = useApiMutation("postCommunicationsMailDrafts", { onSuccess: all });
  const updateDraft = useApiMutation("patchCommunicationsMailDraftsByDraftId", { onSuccess: all });
  const sendDraft = useApiMutation("postCommunicationsMailDraftsByDraftIdSend", { onSuccess: all });
  const deleteDraft = useApiMutation("deleteCommunicationsMailDraftsByDraftId", { onSuccess: all });
  const link = useApiMutation("linkConversation", { onSuccess: all });
  type H = { onSuccess?: () => void; onError?: (e: unknown) => void };
  return {
    busy: send.isPending || createDraft.isPending || updateDraft.isPending || sendDraft.isPending || deleteDraft.isPending || link.isPending,
    send: (body: Record<string, unknown>, h: H) => send.mutate({ params: { orgSlug }, body: body as never }, h),
    saveDraft: (id: string | undefined, body: Record<string, unknown>, h: H) =>
      id ? updateDraft.mutate({ params: { orgSlug, draftId: id }, body: body as never }, h) : createDraft.mutate({ params: { orgSlug }, body: body as never }, h),
    sendDraft: (draftId: string, h: H) => sendDraft.mutate({ params: { orgSlug, draftId } }, h),
    deleteDraft: (draftId: string, h: H) => deleteDraft.mutate({ params: { orgSlug, draftId } }, h),
    link: (conversationId: string, r: RecordRef, h: H) => link.mutate({ params: { orgSlug, conversationId }, body: mailLinkFields(r) as never }, h),
  };
}

/* Meetings ----------------------------------------------------------------------------------------------------------------------------- */

export interface MeetingItem {
  id: string;
  title: string;
  start: string;
  link: { type: "Lead" | "Deal" | "Company" | "Contact"; id: string } | null;
  assigneeName: string | null;
}

/** Meetings in the person's calendar a month either side of today (the calendar feed is the API's only list of meetings). */
export function useMeetings(enabled: boolean) {
  const { orgSlug } = useMember();
  const range = useMemo(() => {
    const now = Date.now();
    return { from: new Date(now - 31 * 86_400_000).toISOString(), to: new Date(now + 31 * 86_400_000).toISOString() };
  }, []);
  const q = useApiQuery("getCalendar", { params: { orgSlug }, query: range }, { enabled });
  const meetings = ((q.data?.items ?? []) as { kind: string; type: string; id: string; title: string; start: string; link: MeetingItem["link"]; assigneeName: string | null }[])
    .filter((i) => i.kind === "activity" && i.type === "MEETING")
    .map<MeetingItem>((i) => ({ id: i.id, title: i.title, start: i.start, link: i.link, assigneeName: i.assigneeName }));
  return { ...q, meetings };
}

export interface ScheduledMeeting {
  activityId: string;
  title: string;
  start: string;
  attendees: string[];
  joinUrl: string | null;
  status: string;
}

export function useMeetingActions() {
  const { orgSlug } = useMember();
  const qc = useQueryClient();
  const done = () => void qc.invalidateQueries({ queryKey: ["getCalendar"] });
  const schedule = useApiMutation("postCommunicationsMeetings", { onSuccess: done });
  const move = useApiMutation("patchCommunicationsMeetingsByActivityId", { onSuccess: done });
  const cancel = useApiMutation("deleteCommunicationsMeetingsByActivityId", { onSuccess: done });
  type H<T> = { onSuccess?: (r: T) => void; onError?: (e: unknown) => void };
  return {
    busy: schedule.isPending || move.isPending || cancel.isPending,
    schedule: (body: Record<string, unknown>, h: H<ScheduledMeeting>) => schedule.mutate({ params: { orgSlug }, body: body as never }, { onSuccess: (r) => h.onSuccess?.(r as unknown as ScheduledMeeting), onError: h.onError }),
    reschedule: (activityId: string, start: string, h: H<unknown>) => move.mutate({ params: { orgSlug, activityId }, body: { start } as never }, h),
    cancel: (activityId: string, h: H<unknown>) => cancel.mutate({ params: { orgSlug, activityId } }, h),
  };
}
