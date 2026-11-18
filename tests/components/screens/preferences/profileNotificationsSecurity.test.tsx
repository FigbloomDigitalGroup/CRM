import { screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationsTab } from "../../../../src/ui/screens/preferences/NotificationsTab";
import { ProfileTab, cropFor } from "../../../../src/ui/screens/preferences/ProfileTab";
import { SecurityTab, whenLabel } from "../../../../src/ui/screens/preferences/SecurityTab";
import { refuseAvatar } from "../../../../src/ui/screens/preferences/model";
import { stubClient, violations } from "../deals/harness";
import { notificationPrefs, profile, renderPrefs } from "./fixtures";

vi.mock("next/navigation", () => ({
  usePathname: () => "/o/figbloom/preferences",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => localStorage.clear());

function file(name: string, type: string, size: number) {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
}

describe("Profile picture (F4.02, AP3)", () => {
  it("enforces type and size with clear messages", () => {
    expect(refuseAvatar({ type: "image/gif", size: 10 })).toBe("Only JPG or PNG pictures work.");
    expect(refuseAvatar({ type: "image/png", size: 3 * 1024 * 1024 })).toBe("That picture is over 2 MB. Choose a smaller one.");
    expect(refuseAvatar({ type: "image/jpeg", size: 1024 })).toBeNull();
  });

  it("crops a square inside the picture, in its own pixels", () => {
    expect(cropFor(400, 200, 1, 0.5, 0.5)).toEqual({ x: 100, y: 0, size: 200 });
    expect(cropFor(400, 200, 2, 0, 1)).toEqual({ x: 0, y: 100, size: 100 });
    const c = cropFor(300, 300, 3, 5, -2);
    expect(c.x + c.size).toBeLessThanOrEqual(300);
    expect(c.y).toBeGreaterThanOrEqual(0);
  });

  it("refuses a wrong type or a big file before asking the API, and says so", async () => {
    const { client, calls } = stubClient({ getMyProfile: () => profile() });
    renderPrefs(<ProfileTab />, client);
    const input = (await screen.findByTestId("avatar-file")) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file("a.gif", "image/gif", 100)] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Only JPG or PNG pictures work.");
    fireEvent.change(input, { target: { files: [file("a.png", "image/png", 5 * 1024 * 1024)] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("over 2 MB");
    expect(calls.some((c) => c.id === "createFileUpload")).toBe(false);
  });

  it("shows initials without a picture and Remove only when there is one", async () => {
    const { client } = stubClient({ getMyProfile: () => profile() });
    const first = renderPrefs(<ProfileTab />, client);
    expect(await screen.findByRole("button", { name: /Upload picture/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(screen.getByRole("img", { name: "Dev Sales" })).toHaveTextContent("DS");
    first.unmount();
    const { client: c2, calls } = stubClient({ getMyProfile: () => profile({ avatar: { url: "https://x/a.webp", initials: "DS", updatedAt: "2026-10-01T00:00:00Z", crop: null } }), removeMyAvatar: () => profile() });
    renderPrefs(<ProfileTab />, c2);
    await userEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() => expect(calls.some((c) => c.id === "removeMyAvatar")).toBe(true));
    expect(await screen.findByText(/initials show instead/)).toBeInTheDocument();
  });

  it("saves the profile and keeps the email read-only with a reason", async () => {
    const { client, calls } = stubClient({ getMyProfile: () => profile(), updateMyProfile: () => profile({ name: "Dev S" }) });
    renderPrefs(<ProfileTab />, client);
    const name = await screen.findByLabelText(/Display name/);
    await userEvent.clear(name);
    await userEvent.type(name, "Dev S");
    expect(screen.getByLabelText("Email")).toBeDisabled();
    expect(screen.getByText(/Managed by your organisation/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(calls.find((c) => c.id === "updateMyProfile")?.args.body).toMatchObject({ name: "Dev S", phone: "+254711000000", timeZone: null }));
  });
});

describe("Notifications per role (F4.03, AP6)", () => {
  it("shows the role's events and cannot turn overdue off", async () => {
    const { client, calls } = stubClient({ getMyNotificationPreferences: () => notificationPrefs() });
    renderPrefs(<NotificationsTab />, client);
    const overdueApp = await screen.findByRole("checkbox", { name: "Task overdue: In-app" });
    expect(overdueApp).toBeDisabled();
    expect(overdueApp).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Task overdue: Email" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Lead assigned to me: Push" })).toBeDisabled();
    expect(screen.getByText(/always on, so a missed deadline is never hidden/)).toBeInTheDocument();
    await userEvent.click(overdueApp);
    expect(calls.some((c) => c.id === "updateMyNotificationPreferences")).toBe(false);
  });

  it("presets apply and a single change makes it custom", async () => {
    let state = notificationPrefs();
    const { client, calls } = stubClient({
      getMyNotificationPreferences: () => state,
      updateMyNotificationPreferences: ({ body }) => {
        const b = body as { preset?: string; types?: Record<string, { email?: boolean }> };
        state = b.preset ? notificationPrefs({ preset: b.preset }) : notificationPrefs({ preset: "CUSTOM" });
        return state;
      },
    });
    renderPrefs(<NotificationsTab />, client);
    await userEvent.click(await screen.findByRole("radio", { name: "Important only" }));
    await waitFor(() => expect(calls.find((c) => c.id === "updateMyNotificationPreferences")?.args.body).toEqual({ preset: "IMPORTANT_ONLY" }));
    await waitFor(() => expect(screen.getByRole("radio", { name: "Important only" })).toBeChecked());
    await userEvent.click(screen.getByRole("checkbox", { name: "Lead assigned to me: Email" }));
    await waitFor(() => expect(calls.at(-1)?.args.body).toEqual({ types: { LEAD_ASSIGNED: { email: true } } }));
    expect(await screen.findByRole("radio", { name: "Custom" })).toBeInTheDocument();
  });

  it("quiet hours and the daily email limit save", async () => {
    const { client, calls } = stubClient({ getMyNotificationPreferences: () => notificationPrefs(), updateMyNotificationPreferences: () => notificationPrefs() });
    renderPrefs(<NotificationsTab />, client);
    await userEvent.click(await screen.findByRole("checkbox", { name: /Quiet hours 19:00–07:00/ }));
    await waitFor(() => expect(calls.find((c) => c.id === "updateMyNotificationPreferences")?.args.body).toEqual({ quietHours: { enabled: true } }));
    await userEvent.selectOptions(screen.getByLabelText("Daily email limit"), "50");
    await waitFor(() => expect(calls.at(-1)?.args.body).toEqual({ dailyEmailCap: 50 }));
  });

  it("has no accessibility violations", async () => {
    const { client } = stubClient({ getMyNotificationPreferences: () => notificationPrefs() });
    const { container } = renderPrefs(<NotificationsTab />, client);
    await screen.findByRole("table");
    expect(await violations(container)).toEqual([]);
  });
});

const SESSIONS = {
  items: [
    { id: "s1", signedInAt: "2026-10-28T08:00:00Z", lastActiveAt: "2026-10-28T09:00:00Z", deviceLabel: "Chrome on Windows", place: "Nairobi", current: true },
    { id: "s2", signedInAt: "2026-10-20T08:00:00Z", lastActiveAt: "2026-10-25T09:00:00Z", deviceLabel: "Figbloom app on iPhone", place: "Nairobi", current: false },
  ],
};
const EVENTS = {
  items: [
    { id: "e1", outcome: "SUCCESS", reason: null, deviceLabel: "Chrome on Windows", place: "Nairobi", createdAt: "2026-10-28T08:00:00Z" },
    { id: "e2", outcome: "FAILURE", reason: "wrong_password", deviceLabel: "Chrome on Windows", place: "Nairobi", createdAt: "2026-10-28T07:59:00Z" },
    { id: "e3", outcome: "LOCKOUT", reason: null, deviceLabel: "Unknown device", place: "Kampala", createdAt: "2026-10-14T21:40:00Z" },
  ],
};

describe("Security tab (F4.03, AP7)", () => {
  it("lists my sessions with this device marked, and my sign-in history", async () => {
    const { client } = stubClient({ listMySessions: () => SESSIONS, listMySignInEvents: () => EVENTS });
    renderPrefs(<SecurityTab />, client);
    const list = await screen.findByTestId("session-list");
    expect(within(list).getByText("This device")).toBeInTheDocument();
    expect(within(list).getAllByRole("button", { name: /Sign out/ })).toHaveLength(1);
    const history = await screen.findByTestId("signin-history");
    expect(within(history).getByText("Signed in")).toBeInTheDocument();
    expect(within(history).getByText("Wrong password")).toBeInTheDocument();
    expect(within(history).getByText(/Blocked/)).toBeInTheDocument();
  });

  it("sign out others asks first and takes effect at once", async () => {
    let signedOut = false;
    const { client, calls } = stubClient({
      listMySessions: () => (signedOut ? { items: [SESSIONS.items[0]] } : SESSIONS),
      listMySignInEvents: () => EVENTS,
      signOutOtherSessions: () => {
        signedOut = true;
        return {};
      },
    });
    renderPrefs(<SecurityTab />, client);
    await screen.findByTestId("session-list");
    await userEvent.click(await screen.findByRole("button", { name: "Sign out other devices" }));
    const dialog = await screen.findByRole("dialog", { name: "Sign out your other devices?" });
    expect(calls.some((c) => c.id === "signOutOtherSessions")).toBe(false);
    await userEvent.click(within(dialog).getByRole("button", { name: "Sign out other devices" }));
    await waitFor(() => expect(calls.some((c) => c.id === "signOutOtherSessions")).toBe(true));
    await waitFor(() => expect(within(screen.getByTestId("session-list")).queryByText(/iPhone/)).toBeNull());
  });

  it("signs out a single device", async () => {
    const { client, calls } = stubClient({ listMySessions: () => SESSIONS, listMySignInEvents: () => EVENTS, revokeMySession: () => ({}) });
    renderPrefs(<SecurityTab />, client);
    await userEvent.click(await screen.findByRole("button", { name: "Sign out Figbloom app on iPhone" }));
    await waitFor(() => expect(calls.find((c) => c.id === "revokeMySession")?.args.params).toEqual({ sessionId: "s2" }));
  });

  it("changes the password through the existing flow, and says two-step is V1.1", async () => {
    const { client } = stubClient({ listMySessions: () => SESSIONS, listMySignInEvents: () => EVENTS });
    renderPrefs(<SecurityTab />, client);
    expect(await screen.findByRole("link", { name: "Change password by email" })).toHaveAttribute("href", "/forgot-password");
    expect(screen.getByText(/Arrives in V1.1/)).toBeInTheDocument();
  });

  it("writes times in the person's zone and clock", () => {
    const now = new Date("2026-10-28T12:00:00Z");
    expect(whenLabel("2026-10-28T08:02:00Z", { timeZone: "Africa/Nairobi", hour12: false, now })).toBe("Today 11:02");
    expect(whenLabel("2026-10-18T05:02:00Z", { timeZone: "Africa/Nairobi", hour12: false, now })).toBe("18 Oct 08:02");
  });

  it("has no accessibility violations", async () => {
    const { client } = stubClient({ listMySessions: () => SESSIONS, listMySignInEvents: () => EVENTS });
    const { container } = renderPrefs(<SecurityTab />, client);
    await screen.findByTestId("signin-history");
    expect(await violations(container)).toEqual([]);
  });
});
