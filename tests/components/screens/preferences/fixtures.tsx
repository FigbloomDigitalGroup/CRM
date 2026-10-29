import { render } from "@testing-library/react";
import { ApiProvider, MemberProvider, ToastProvider, ThemeProvider, makeQueryClient, testMember, type Member } from "../../../../src/ui";
import { defaultLook } from "../../../../src/ui/theme/resolve";
import type { ApiClient } from "../../../../src/api-client";

/** Renders a Preferences piece inside everything the organisation layout provides: API, toasts, member and the live theme. */
export function renderPrefs(ui: React.ReactNode, client: ApiClient, member: Partial<Member> = {}, look = defaultLook()) {
  const queryClient = makeQueryClient();
  queryClient.setDefaultOptions({ queries: { retry: false, staleTime: 30_000 }, mutations: { retry: false } });
  return render(
    <ThemeProvider initialLook={look} initialDensity="COMFORTABLE">
      <ApiProvider client={client} queryClient={queryClient}>
        <ToastProvider>
          <MemberProvider value={testMember({ permissionKeys: [], timeZone: "UTC", ...member })}>
            <main>{ui}</main>
          </MemberProvider>
        </ToastProvider>
      </ApiProvider>
    </ThemeProvider>,
  );
}

export function prefsView(over: Record<string, unknown> = {}) {
  return {
    appearance: {
      theme: null,
      pageColour: null,
      toggle: { light: "WHITE", dark: "DARK" },
      density: "COMFORTABLE",
      densityStoredOn: "account",
      ownColours: null,
      effective: {
        source: "organisation",
        locked: false,
        theme: "FOREST",
        pageColour: "WHITE",
        toggle: { light: "WHITE", dark: "DARK" },
        ownColours: null,
        colours: { sidebar: "#203E2A", accent: "#275B3A", highlight: "#E9F1EB", page: { key: "WHITE", label: "White", hex: "#FAF9F7", dark: false } },
      },
      organisationDefault: { theme: "FOREST", pageColour: "WHITE" },
    },
    personalisation: { allowed: true, locked: false, ownColoursAvailable: false },
    startPage: { key: null, unavailable: false, options: [{ key: "dashboard", label: "Dashboard", path: "" }, { key: "leads", label: "Leads", path: "/leads" }, { key: "tasks", label: "Tasks", path: "/tasks" }] },
    sidebar: { collapsed: false, hidden: [] },
    regional: { hourFormat: "H12", firstDayOfWeek: "MON", dateFormat: "DMY", timeZoneSetOn: "profile" },
    deviceOnly: { textSize: "DEFAULT", bold: false, higherContrast: false, reduceMotion: false, storedOn: "device", textSizes: ["SMALL", "DEFAULT", "LARGE", "EXTRA_LARGE"] },
    catalogue: {},
    undoAvailable: false,
    ...over,
  };
}

export const profile = (over: Record<string, unknown> = {}) => ({
  membershipId: "m-1",
  userId: "u-1",
  name: "Dev Sales",
  email: "sales@figbloom.test",
  phone: "+254711000000",
  timeZone: null,
  organizationTimeZone: "Africa/Nairobi",
  effectiveTimeZone: "Africa/Nairobi",
  avatar: { url: null, initials: "DS", updatedAt: null, crop: null },
  ...over,
});

export const notificationPrefs = (over: Record<string, unknown> = {}) => ({
  preset: "EVERYTHING",
  presets: [
    { key: "EVERYTHING", label: "Everything", description: "All of it" },
    { key: "IMPORTANT_ONLY", label: "Important only", description: "Only what matters" },
    { key: "OFF", label: "Off", description: "Nothing but overdue" },
  ],
  types: [
    { type: "LEAD_ASSIGNED", label: "Lead assigned to me", description: "When a lead is given to you", important: true, alwaysOn: false, channels: { inApp: { enabled: true, locked: false }, email: { enabled: false, locked: false }, push: { enabled: false, available: false, note: "Push notifications arrive with the mobile app." } } },
    { type: "TASK_OVERDUE", label: "Task overdue", description: "A task you own is overdue", important: true, alwaysOn: true, channels: { inApp: { enabled: true, locked: true }, email: { enabled: true, locked: true }, push: { enabled: false, available: false, note: "Push notifications arrive with the mobile app." } } },
  ],
  quietHours: { enabled: false, start: "19:00", end: "07:00", timeZone: "Africa/Nairobi" },
  dailyEmailCap: 20,
  dailyEmailCapRange: { min: 1, max: 50, default: 20 },
  emailsToday: 0,
  heldForDigest: 0,
  ...over,
});
