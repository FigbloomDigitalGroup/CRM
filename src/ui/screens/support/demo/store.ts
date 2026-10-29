"use client";

import { useSyncExternalStore } from "react";
import { DEMO_CUSTOMERS, DEMO_SURVEYS, DEMO_TICKETS, type DemoCustomer, type DemoSurvey, type DemoTicket, type TicketStatus } from "./data";

/** The one module the support screens read and write (demo convention, docs/RESTRUCTURE_LOG.md). In memory, per page load. Replace with the API (B6.23). */
interface State {
  tickets: DemoTicket[];
}

let state: State = { tickets: DEMO_TICKETS.map((t) => ({ ...t, thread: [...t.thread] })) };
const listeners = new Set<() => void>();
function set(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

export function useTickets(): DemoTicket[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state.tickets,
    () => state.tickets,
  );
}

export const supportDemo = {
  setStatus(id: string, status: TicketStatus) {
    set({ tickets: state.tickets.map((t) => (t.id === id ? { ...t, status } : t)) });
  },
  reply(id: string, text: string, internal: boolean, who: string) {
    set({ tickets: state.tickets.map((t) => (t.id === id ? { ...t, thread: [...t.thread, { from: who, at: "Just now", text, internal }] } : t)) });
  },
  customer(id: string): DemoCustomer | undefined {
    return DEMO_CUSTOMERS.find((c) => c.id === id);
  },
  surveys(): DemoSurvey[] {
    return DEMO_SURVEYS;
  },
};
