import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationBell, NotificationCentre, pathFromLink } from "../../../../src/ui/screens/home/Notifications";
import { expectNoAxeViolations, page, renderScreen, type Handlers } from "./harness";

/** F2.12 (G3): the bell with its unread count, the notification centre with filters, and deep links that stay inside the organisation. */

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }), usePathname: () => "/o/figbloom", useSearchParams: () => new URLSearchParams() }));

const notice = (id: string, type: string, title: string, read: boolean, extra: Record<string, unknown> = {}) => ({
  id,
  type,
  title,
  body: "",
  deepLink: `http://localhost:3100/o/figbloom/leads/${id}`,
  read,
  createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  ...extra,
});

function handlers(items: ReturnType<typeof notice>[], over: Partial<Handlers> = {}): Handlers {
  let list = items;
  return {
    getUnreadNotificationCount: () => ({ unreadCount: list.filter((n) => !n.read).length }),
    listNotifications: () => page(list, { unreadCount: list.filter((n) => !n.read).length }),
    postNotificationsByNotificationIdRead: ({ params }) => {
      list = list.map((n) => (n.id === params?.notificationId ? { ...n, read: true } : n));
      return { count: 1 };
    },
    postNotificationsMarkAllRead: () => {
      list = list.map((n) => ({ ...n, read: true }));
      return { count: list.length };
    },
    ...over,
  };
}

const ITEMS = [
  notice("n1", "LEAD_ASSIGNED", "New lead assigned to you", false),
  notice("n2", "TASK_OVERDUE", "A task is overdue: Send the proposal", false, { deepLink: "http://localhost:3100/o/figbloom/tasks#task-abc" }),
  notice("n3", "DEAL_WON_HANDOFF", "Davis & Shirtliff was handed to Delivery", true, { deepLink: "http://localhost:3100/o/figbloom/deals/n3" }),
  notice("n4", "MENTION", "Dev Management mentioned you", false),
];

beforeEach(() => push.mockClear());
afterEach(() => vi.useRealTimers());

describe("pathFromLink", () => {
  it("keeps only the path, so the app's own address in a link never decides where you go", () => {
    expect(pathFromLink("http://localhost:3100/o/figbloom/leads/1", "figbloom")).toBe("/o/figbloom/leads/1");
    expect(pathFromLink("https://crm.example.com/o/figbloom/tasks#task-1", "figbloom")).toBe("/o/figbloom/tasks#task-1");
    expect(pathFromLink("/o/figbloom", "figbloom")).toBe("/o/figbloom");
  });
  it("never follows a link into another organisation, another site, or a script", () => {
    expect(pathFromLink("http://localhost:3100/o/other/leads/1", "figbloom")).toBeNull();
    expect(pathFromLink("https://evil.example/login", "figbloom")).toBeNull();
    expect(pathFromLink("javascript:alert(1)", "figbloom")).toBeNull();
    expect(pathFromLink(null, "figbloom")).toBeNull();
  });
});

describe("the bell", () => {
  it("shows the unread count the API reports, and says it to a screen reader", async () => {
    renderScreen(<NotificationBell />, handlers(ITEMS));
    expect(await screen.findByRole("button", { name: "Notifications, 3 unread" })).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("has no badge when everything is read", async () => {
    renderScreen(<NotificationBell />, handlers(ITEMS.map((n) => ({ ...n, read: true }))));
    const bell = await screen.findByRole("button", { name: "Notifications" });
    await waitFor(() => expect(bell).not.toHaveTextContent(/\d/));
  });

  it("opens a panel with the latest notices, unread ones marked, and an all-caught-up state when there are none", async () => {
    const user = userEvent.setup();
    renderScreen(<NotificationBell />, handlers(ITEMS));
    await user.click(await screen.findByRole("button", { name: /Notifications, 3 unread/ }));
    const panel = await screen.findByRole("dialog", { name: "Notifications" });
    expect(await within(panel).findByText("New lead assigned to you")).toBeInTheDocument();
    expect(within(panel).getByText(/Lead assigned · 5 min ago · unread/)).toBeInTheDocument();
    expect(within(panel).getByText(/Handoff · 5 min ago$/)).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "Open notification centre" })).toHaveAttribute("href", "/o/figbloom/notifications");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is all caught up when there is nothing", async () => {
    const user = userEvent.setup();
    renderScreen(<NotificationBell />, handlers([]));
    await user.click(await screen.findByRole("button", { name: "Notifications" }));
    expect(await screen.findByText("You’re all caught up.")).toBeInTheDocument();
  });

  it("opening a notice marks it read on the server and goes to the record inside this organisation", async () => {
    const user = userEvent.setup();
    const r = renderScreen(<NotificationBell />, handlers(ITEMS));
    await user.click(await screen.findByRole("button", { name: /Notifications, 3 unread/ }));
    await user.click(await screen.findByRole("button", { name: /New lead assigned to you/ }));
    await waitFor(() => expect(r.last("postNotificationsByNotificationIdRead")).toMatchObject({ params: { notificationId: "n1" } }));
    expect(push).toHaveBeenCalledWith("/o/figbloom/leads/n1");
  });

  it("Mark all read clears the count", async () => {
    const user = userEvent.setup();
    const r = renderScreen(<NotificationBell />, handlers(ITEMS));
    await user.click(await screen.findByRole("button", { name: /Notifications, 3 unread/ }));
    await user.click(await screen.findByRole("button", { name: "Mark all read" }));
    await waitFor(() => expect(r.count("postNotificationsMarkAllRead")).toBe(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument());
  });

  it("asks for the count again on its own (polling), so a notice that arrives shows without a reload", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const r = renderScreen(<NotificationBell />, handlers(ITEMS));
    await vi.waitFor(() => expect(r.count("getUnreadNotificationCount")).toBe(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    await vi.waitFor(() => expect(r.count("getUnreadNotificationCount")).toBeGreaterThanOrEqual(2));
  });

  it("has no axe violations with the panel open", async () => {
    const user = userEvent.setup();
    const { container } = renderScreen(<NotificationBell />, handlers(ITEMS));
    await user.click(await screen.findByRole("button", { name: /Notifications, 3 unread/ }));
    await screen.findByText("New lead assigned to you");
    await expectNoAxeViolations(container);
  });
});

describe("the notification centre", () => {
  it("shows the unread count, a tab for each kind the person has with its count, and the design's header", async () => {
    const { container } = renderScreen(<NotificationCentre />, handlers(ITEMS));
    expect(await screen.findByRole("heading", { level: 1, name: "Notifications" })).toBeInTheDocument();
    expect(await screen.findByText("3 unread · reminders, assignments and handoffs that involve you")).toBeInTheDocument();
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent);
    expect(tabs).toEqual(["All4", "Unread3", "Assignments1", "Mentions1", "Tasks1", "Handoffs1"]); // no Payments tab: none of those
    expect(screen.getByRole("link", { name: "Preferences" })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("filters by kind and by unread", async () => {
    const user = userEvent.setup();
    renderScreen(<NotificationCentre />, handlers(ITEMS));
    await user.click(await screen.findByRole("tab", { name: /Tasks/ }));
    expect(screen.getByText("A task is overdue: Send the proposal")).toBeInTheDocument();
    expect(screen.queryByText("New lead assigned to you")).toBeNull();
    await user.click(screen.getByRole("tab", { name: /Unread/ }));
    expect(screen.queryByText("Davis & Shirtliff was handed to Delivery")).toBeNull();
    expect(screen.getByText("Dev Management mentioned you")).toBeInTheDocument();
  });

  it("Open goes to the record and marks the notice read; the check mark only marks it read", async () => {
    const user = userEvent.setup();
    const r = renderScreen(<NotificationCentre />, handlers(ITEMS));
    const row = (await screen.findByText("A task is overdue: Send the proposal")).closest("li") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Open" }));
    await waitFor(() => expect(r.last("postNotificationsByNotificationIdRead")).toMatchObject({ params: { notificationId: "n2" } }));
    expect(push).toHaveBeenCalledWith("/o/figbloom/tasks#task-abc");

    push.mockClear();
    const row4 = (await screen.findByText("Dev Management mentioned you")).closest("li") as HTMLElement;
    await user.click(within(row4).getByRole("button", { name: "Mark read" }));
    await waitFor(() => expect(r.last("postNotificationsByNotificationIdRead")).toMatchObject({ params: { notificationId: "n4" } }));
    expect(push).not.toHaveBeenCalled();
  });

  it("Mark all read updates the header", async () => {
    const user = userEvent.setup();
    renderScreen(<NotificationCentre />, handlers(ITEMS));
    await user.click(await screen.findByRole("button", { name: "Mark all read" }));
    expect(await screen.findByText(/^0 unread/)).toBeInTheDocument();
  });

  it("says all caught up when empty, and shows an error with a retry", async () => {
    const { unmount } = renderScreen(<NotificationCentre />, handlers([]));
    expect(await screen.findByText("You’re all caught up.")).toBeInTheDocument();
    unmount();
    renderScreen(<NotificationCentre />, handlers([], { listNotifications: () => Promise.reject({ status: 503, envelope: { requestId: "r", fieldErrors: [] } }) }));
    expect(await screen.findByRole("button", { name: /try again|retry/i }, { timeout: 5000 })).toBeInTheDocument();
  });
});
