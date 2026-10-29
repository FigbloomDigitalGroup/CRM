"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  DEMO_DMS,
  DEMO_MAIL,
  DEMO_MEETINGS,
  DEMO_MESSAGES,
  DEMO_UNREAD,
  ME,
  type DemoChannel,
  type DemoMail,
  type DemoMeeting,
  type DemoMessage,
  type MailLink,
  type RecordCard,
  DEMO_CHANNELS,
} from "./data";

/**
 * The one module the Communication screens read and write (demo convention, docs/RESTRUCTURE_LOG.md). In memory, per page load. Replace with the
 * API in M13: chat B6.24 and B6.25, mail FIG-807, meetings FIG-808. The hooks keep their shapes so the screens do not change.
 */

function createStore<T>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next: T) {
      state = next;
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

function useStore<T>(store: ReturnType<typeof createStore<T>>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

let nextId = 1000;
const newId = (prefix: string) => `${prefix}${nextId++}`;
const nowTime = () => new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/* Chat ------------------------------------------------------------------------------------------------------------------------------ */

interface ChatState {
  channels: DemoChannel[];
  messages: DemoMessage[];
  unread: Record<string, number>;
  /** People the member started a direct message with, besides the one the demo begins with. */
  dms: string[];
}

const chat = createStore<ChatState>({
  channels: DEMO_CHANNELS,
  messages: [...DEMO_MESSAGES, ...DEMO_DMS],
  unread: { ...DEMO_UNREAD },
  dms: ["p-amina"],
});

export const useChat = () => useStore(chat);

export const chatDemo = {
  post(channelId: string, text: string, opts: { attachments?: string[]; card?: RecordCard } = {}): DemoMessage | null {
    const body = text.trim();
    if (!body && !opts.attachments?.length && !opts.card) return null;
    const msg: DemoMessage = { id: newId("m"), channelId, authorId: ME, text: body, day: "Today", time: nowTime(), reactions: {}, attachments: opts.attachments, card: opts.card };
    const s = chat.get();
    chat.set({ ...s, messages: [...s.messages, msg] });
    return msg;
  },
  react(messageId: string, emoji: string) {
    const s = chat.get();
    chat.set({
      ...s,
      messages: s.messages.map((m) => {
        if (m.id !== messageId) return m;
        const who = m.reactions[emoji] ?? [];
        const next = who.includes(ME) ? who.filter((w) => w !== ME) : [...who, ME];
        const reactions = { ...m.reactions, [emoji]: next };
        if (next.length === 0) delete reactions[emoji];
        return { ...m, reactions };
      }),
    });
  },
  markRead(conversationId: string) {
    const s = chat.get();
    if (!s.unread[conversationId]) return;
    chat.set({ ...s, unread: { ...s.unread, [conversationId]: 0 } });
  },
  startDm(personId: string) {
    const s = chat.get();
    if (!s.dms.includes(personId)) chat.set({ ...s, dms: [...s.dms, personId] });
  },
  createChannel(name: string, isPrivate: boolean, description: string): DemoChannel {
    const clean = name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
    const ch: DemoChannel = { id: `ch-${clean}-${nextId++}`, name: clean, kind: "channel", private: isPrivate, description: description.trim() || "New channel", members: 1, addedLimited: true };
    const s = chat.get();
    chat.set({ ...s, channels: [...s.channels, ch] });
    return ch;
  },
};

/* Mail ------------------------------------------------------------------------------------------------------------------------------ */

const mail = createStore<DemoMail[]>(DEMO_MAIL);
export const useMail = () => useStore(mail);

export const mailDemo = {
  markRead(id: string) {
    mail.set(mail.get().map((m) => (m.id === id && m.unread ? { ...m, unread: false } : m)));
  },
  link(id: string, link: MailLink) {
    mail.set(mail.get().map((m) => (m.id === id ? { ...m, link } : m)));
  },
  send(input: { to: string; subject: string; body: string; link: MailLink | null; replyToId?: string }): DemoMail {
    const sent: DemoMail = { id: newId("ml"), folder: "sent", from: "you", fromEmail: "you@demo.figbloom.test", to: input.to, subject: input.subject, body: input.body, day: "Today", time: nowTime(), unread: false, link: input.link };
    mail.set([sent, ...mail.get()]);
    return sent;
  },
  saveDraft(input: { to: string; subject: string; body: string; link: MailLink | null }): DemoMail {
    const draft: DemoMail = { id: newId("ml"), folder: "draft", from: "you", fromEmail: "you@demo.figbloom.test", ...input, day: "Today", time: nowTime(), unread: false };
    mail.set([draft, ...mail.get()]);
    return draft;
  },
  /** A person sends a draft (an automation's draft included). It leaves Drafts and appears in Sent. */
  sendDraft(id: string) {
    mail.set(mail.get().map((m) => (m.id === id ? { ...m, folder: "sent", byAutomation: false, time: nowTime(), day: "Today" } : m)));
  },
  discardDraft(id: string) {
    mail.set(mail.get().filter((m) => m.id !== id));
  },
};

/* Meetings -------------------------------------------------------------------------------------------------------------------------- */

const meetings = createStore<DemoMeeting[]>(DEMO_MEETINGS);
export const useMeetings = () => useStore(meetings);

export const meetingsDemo = {
  create(input: Omit<DemoMeeting, "id" | "status" | "joinCode">): DemoMeeting {
    const id = newId("v");
    const m: DemoMeeting = { ...input, id, status: "upcoming", joinCode: `fbl-demo-${id}` };
    meetings.set([m, ...meetings.get()]);
    return m;
  },
  cancel(id: string) {
    meetings.set(meetings.get().map((m) => (m.id === id ? { ...m, status: "cancelled" } : m)));
  },
  reschedule(id: string, day: string, time: string) {
    meetings.set(meetings.get().map((m) => (m.id === id ? { ...m, day, time } : m)));
  },
};

/* Connections: the state Settings > Email and calendar keeps (FIG-1175) ------------------------------------------------------------- */

type Kind = "email" | "calendar";
const STEPS = 4;
const connectionKey = (org: string) => `figbloom-demo-connections:${org}`;

/**
 * Whether the person's mailbox or calendar is connected. It reads (and, from the "Connect" button, writes) the same device storage the
 * Settings screen uses, so connecting in either place shows in both. Connected = every step done. Until B6.21 lands this is simulated.
 */
export function useConnection(kind: Kind, orgSlug: string): { connected: boolean; ready: boolean; connect: () => void } {
  const [connected, setConnected] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(connectionKey(orgSlug));
      const saved = raw ? (JSON.parse(raw) as Partial<Record<Kind, number>>) : {};
      setConnected((saved[kind] ?? 0) >= STEPS);
    } catch {
      // Blocked storage: treated as not connected.
    }
    setReady(true);
  }, [kind, orgSlug]);

  const connect = useCallback(() => {
    try {
      const raw = localStorage.getItem(connectionKey(orgSlug));
      const saved = raw ? (JSON.parse(raw) as Partial<Record<Kind, number>>) : {};
      localStorage.setItem(connectionKey(orgSlug), JSON.stringify({ email: saved.email ?? 0, calendar: saved.calendar ?? 0, [kind]: STEPS }));
    } catch {
      // The demo state lasts until the page closes.
    }
    setConnected(true);
  }, [kind, orgSlug]);

  return { connected, ready, connect };
}

/** For tests: puts the demo back to how a fresh page load finds it. */
export function resetCommunicationDemo() {
  chat.set({ channels: DEMO_CHANNELS, messages: [...DEMO_MESSAGES, ...DEMO_DMS], unread: { ...DEMO_UNREAD }, dms: ["p-amina"] });
  mail.set(DEMO_MAIL);
  meetings.set(DEMO_MEETINGS);
}
