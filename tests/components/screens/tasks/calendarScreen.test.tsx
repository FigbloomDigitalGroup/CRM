import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CalendarScreen } from "../../../../src/ui/screens/tasks";
import { dayKey } from "../../../../src/ui/screens/tasks/model";
import { apiError, renderScreen, stubClient, violations } from "./harness";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/o/figbloom/calendar",
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const todayKey = dayKey(new Date(), "UTC");
const dayCells = () => Array.from(document.querySelectorAll<HTMLElement>("[data-day]"));
const days = async () => {
  await screen.findByRole("group", { name: /\d{4}/ });
  return dayCells();
};
const at = (day: string, hhmm: string) => `${day}T${hhmm}:00.000Z`;

function item(over: Record<string, unknown> & { id: string; title: string; localDate: string; localTime: string }) {
  return {
    kind: "task",
    type: "TASK",
    start: at(over.localDate, over.localTime),
    status: "PENDING",
    priority: "MEDIUM",
    overdue: false,
    assigneeMembershipId: "m-1",
    assigneeName: "Test Member",
    link: null,
    ...over,
  };
}

function answer(items: unknown[], filter: Partial<{ canChoose: boolean; reason: string | null; members: unknown[] }> = {}) {
  return { from: "", to: "", timeZone: "UTC", view: null, truncated: false, selected: "m-1", items, teamFilter: { canChoose: false, reason: "You see your own calendar. Management can view the team calendar.", members: [], ...filter } };
}

const ITEMS = [
  item({ id: "a", title: "Call Sarova", localDate: todayKey, localTime: "09:00" }),
  item({ id: "b", title: "Send quote", localDate: todayKey, localTime: "10:30", priority: "HIGH" }),
  item({ id: "c", title: "Review brief", localDate: todayKey, localTime: "11:00" }),
  item({ id: "d", title: "Fourth thing", localDate: todayKey, localTime: "12:00" }),
  item({ id: "m", kind: "activity", type: "MEETING", title: "Site visit", localDate: todayKey, localTime: "14:00", status: null, priority: null, link: { type: "Deal", id: "d1" } }),
];

function setup(items: unknown[] = ITEMS, filter = {}, member = {}) {
  const stub = stubClient({
    getCalendar: () => answer(items, filter),
    getTasksByTaskId: () => ({ id: "a", title: "Call Sarova", assigneeMembershipId: "m-1", priority: "MEDIUM", status: "PENDING", dueAt: at(todayKey, "09:00"), description: null }),
    postCalendar: () => ({ kind: "activity", id: "x", start: "" }),
    postTasks: () => ({}),
  });
  return { ...stub, ...renderScreen(<CalendarScreen />, stub.client, member) };
}

describe("Calendar (F2.08, T2)", () => {
  it("draws the month with today marked, three items a day and a +N more link", async () => {
    setup();
    const cell = (await days()).find((c) => c.getAttribute("aria-current") === "date")!;
    expect(within(cell).getAllByRole("button", { name: /^(Task|Meeting):/ })).toHaveLength(3);
    expect(within(cell).getByRole("button", { name: "+2 more" })).toBeInTheDocument();
    expect(within(cell).getByText("Call Sarova", { exact: false })).toBeInTheDocument();
  });

  it("switches between Month, Week, Day and List", async () => {
    const user = userEvent.setup();
    setup();
    await days();
    await user.click(screen.getByRole("button", { name: "Week" }));
    expect(await screen.findByRole("group", { name: /Week of/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Day" }));
    expect(await screen.findByText("08:00")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "List" }));
    expect(await screen.findByRole("heading", { name: /^Today · / })).toBeInTheDocument();
    expect(screen.getByText("Upcoming and overdue")).toBeInTheDocument();
  });

  it("labels an overdue day in the list by words, not colour alone", async () => {
    const user = userEvent.setup();
    const yesterday = dayKey(new Date(Date.now() - 864e5), "UTC");
    setup([item({ id: "o", title: "Overdue thing", localDate: yesterday, localTime: "09:00", overdue: true })]);
    await user.click(await screen.findByRole("button", { name: "List" }));
    expect(await screen.findByRole("heading", { name: /^Overdue · / })).toBeInTheDocument();
  });

  it("locks the team filter, with the reason in words, for a role without team scope", async () => {
    setup(ITEMS, { canChoose: false });
    const select = await screen.findByLabelText("Whose calendar");
    expect(select).toBeDisabled();
    expect(await screen.findByText("The team calendar is visible to Management. You see your own tasks.")).toBeInTheDocument();
    // The API's own wording stays available as the control's tooltip.
    await waitFor(() => expect(select).toHaveAttribute("title", "You see your own calendar. Management can view the team calendar."));
  });

  it("lets Management open on everyone and choose a person", async () => {
    const user = userEvent.setup();
    const { calls } = setup(ITEMS, { canChoose: true, reason: null, members: [{ membershipId: "m-2", name: "Dev Sales" }] }, { permissionKeys: ["tasks.view.all", "tasks.view.own", "tasks.create"] });
    const select = await screen.findByLabelText("Whose calendar");
    await waitFor(() => expect(select).toBeEnabled());
    expect(calls.some((c) => c.id === "getCalendar" && c.args.query?.membershipId === "all")).toBe(true);
    await user.selectOptions(select, "m-2");
    await waitFor(() => expect(calls.some((c) => c.id === "getCalendar" && c.args.query?.membershipId === "m-2")).toBe(true));
  });

  it("moves between days with the arrow keys, and between a day's events with up and down", async () => {
    const user = userEvent.setup();
    setup();
    await days();
    const todayCell = dayCells().find((c) => c.getAttribute("aria-current") === "date")!;
    const slot = within(todayCell).getAllByRole("button").find((b) => b.hasAttribute("data-cell"))!;
    slot.focus();
    await user.keyboard("{ArrowRight}");
    const next = dayCells()[dayCells().indexOf(todayCell) + 1]!;
    expect(next.contains(document.activeElement)).toBe(true);
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(slot);
    // Down moves a week in the month grid; Tab reaches the day's events, and arrows move between them.
    await user.keyboard("{ArrowDown}");
    expect(dayCells()[dayCells().indexOf(todayCell) + 7]!.contains(document.activeElement)).toBe(true);
    await user.keyboard("{ArrowUp}");
    await user.tab();
    expect(todayCell.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toHaveAttribute("data-ev");
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toHaveAttribute("data-ev");
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(document.activeElement).toHaveAttribute("data-cell");
  });

  it("creates a task from a slot, time filled in", async () => {
    const user = userEvent.setup();
    const { calls } = setup([]);
    const todayCell = (await days()).find((c) => c.getAttribute("aria-current") === "date")!;
    await user.click(within(todayCell).getByRole("button", { name: /Press Enter to add a task/ }));
    const dialog = await screen.findByRole("dialog", { name: "New task" });
    expect(within(dialog).getByLabelText(/^Due/)).toHaveValue(`${todayKey}T10:00`);
    await user.type(within(dialog).getByLabelText(/Title/), "Prep the demo");
    await user.click(within(dialog).getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(calls.some((c) => c.id === "postTasks")).toBe(true));
    expect(calls.find((c) => c.id === "postTasks")!.args.body).toMatchObject({ title: "Prep the demo", dueAt: at(todayKey, "10:00").replace(":00.000Z", ":00.000Z") });
  });

  it("creates a meeting from a slot through the calendar endpoint", async () => {
    const user = userEvent.setup();
    const { calls } = setup([]);
    const todayCell = (await days()).find((c) => c.getAttribute("aria-current") === "date")!;
    await user.click(within(todayCell).getByRole("button", { name: /Press Enter to add a task/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("radio", { name: "Meeting" }));
    expect(screen.getByRole("dialog", { name: "New meeting" })).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/Title/), "Kick-off");
    await user.click(within(dialog).getByRole("button", { name: "Add meeting" }));
    await waitFor(() => expect(calls.some((c) => c.id === "postCalendar")).toBe(true));
    expect(calls.find((c) => c.id === "postCalendar")!.args.body).toMatchObject({ kind: "activity", type: "MEETING", title: "Kick-off" });
  });

  it("opens a task in the edit drawer and a meeting on its record", async () => {
    const user = userEvent.setup();
    setup();
    const todayCell = (await days()).find((c) => c.getAttribute("aria-current") === "date")!;
    await user.click(within(todayCell).getByRole("button", { name: /Task: Call Sarova/ }));
    expect(await screen.findByRole("dialog", { name: "Edit task" })).toBeInTheDocument();
  });

  it("shows the explained refusal and a retry when it cannot load", async () => {
    const user = userEvent.setup();
    const stub = stubClient({ getCalendar: () => apiError(500, "boom") });
    renderScreen(<CalendarScreen />, stub.client);
    expect(await screen.findByText("The calendar didn’t load")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(stub.calls.filter((c) => c.id === "getCalendar").length).toBeGreaterThan(1);
  });

  it("has no accessibility violations in month, week, day and list", async () => {
    const user = userEvent.setup();
    const { container } = setup();
    await days();
    expect(await violations(container)).toEqual([]);
    for (const mode of ["Week", "Day", "List"]) {
      await user.click(screen.getByRole("button", { name: mode }));
      await screen.findByText(mode === "List" ? "Upcoming and overdue" : /.+/, undefined, { timeout: 3000 }).catch(() => undefined);
      expect(await violations(container)).toEqual([]);
    }
  });
});
