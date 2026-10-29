"use client";

import { useSyncExternalStore } from "react";
import {
  DEMO_ANNOUNCEMENT,
  DEMO_DATA_REQUESTS,
  DEMO_MEMBERSHIPS,
  DEMO_SUPPORT,
  DEMO_TRUSTED_DEVICES,
  type DataRequestStatus,
  type DemoDataRequest,
  type DemoDevice,
  type DemoMembership,
  type DemoSupportSession,
} from "./data";

/**
 * The only module the organisation-side demo screens read and write (docs/RESTRUCTURE_LOG.md, demo convention). In-memory and per page load, so
 * a refresh starts the story again: a support request waiting for approval, an announcement, two data requests. Replace with the API (M13).
 */
interface State {
  memberships: DemoMembership[];
  currentOrg: string;
  support: DemoSupportSession[];
  announcementDismissed: boolean;
  dataRequests: DemoDataRequest[];
  devices: DemoDevice[];
  policy: { mgmt: boolean; all: boolean; remember: boolean };
}

let state: State = {
  memberships: DEMO_MEMBERSHIPS.map((m) => ({ ...m })),
  currentOrg: "o1",
  support: DEMO_SUPPORT.map((s) => ({ ...s })),
  announcementDismissed: false,
  dataRequests: DEMO_DATA_REQUESTS.map((r) => ({ ...r })),
  devices: DEMO_TRUSTED_DEVICES.map((d) => ({ ...d })),
  policy: { mgmt: true, all: false, remember: true },
};

const listeners = new Set<() => void>();
function set(next: Partial<State>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function useOrgSideDemo(): State {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

export const orgSideDemo = {
  switchTo(id: string) {
    set({ currentOrg: id });
  },
  accept(id: string) {
    set({ memberships: state.memberships.map((m) => (m.id === id ? { ...m, invite: false, last: "Just now" } : m)) });
  },
  approveSupport(id: string) {
    set({ support: state.support.map((s) => (s.id === id ? { ...s, status: "Active", at: "Just now" } : s)) });
  },
  denySupport(id: string) {
    set({ support: state.support.map((s) => (s.id === id ? { ...s, status: "Denied" } : s)) });
  },
  endSupport(id: string, by: string) {
    set({ support: state.support.map((s) => (s.id === id ? { ...s, status: "Ended", endedAt: "Just now", endedBy: by, pages: s.pages ?? ["Settings › Integrations"] } : s)) });
  },
  dismissAnnouncement() {
    set({ announcementDismissed: true });
  },
  fileRequest(type: DemoDataRequest["type"], subject: string) {
    const status: DataRequestStatus = "Received";
    set({ dataRequests: [{ id: `dr${Date.now()}`, type, subject, received: "Today", due: "In 30 days", status }, ...state.dataRequests] });
  },
  forgetDevice(id: string) {
    set({ devices: state.devices.filter((d) => d.id !== id) });
  },
  setPolicy(key: keyof State["policy"], on: boolean) {
    set({ policy: { ...state.policy, [key]: on } });
  },
};

export { DEMO_ANNOUNCEMENT };
