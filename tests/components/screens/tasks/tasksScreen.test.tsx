import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TasksScreen } from "../../../../src/ui/screens/tasks";
import { apiError, groupsAnswer, renderScreen, stubClient, task, violations } from "./harness";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/o/figbloom/tasks",
  useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();

const overdue = task({ id: "t-over", title: "Chase the signed contract", dueAt: hours(-30), priority: "HIGH", link: { type: "Deal", id: "d1", label: "Brookside Dairy" } });
const today = task({ id: "t-today", title: "Call Sarova", dueAt: hours(2) });
const later = task({ id: "t-later", title: "Send the Q4 deck", dueAt: hours(100) });
const theirs = task({ id: "t-theirs", title: "Prepare onboarding pack", assigneeName: "Dev Delivery", assigneeMembershipId: "m-9", readOnly: true, dueAt: hours(5) });
const done = task({ id: "t-done", title: "Old task", status: "COMPLETED", completedAt: hours(-48) });

const EVERYTHING = { OVERDUE: [overdue], TODAY: [today, theirs], THIS_WEEK: [later], DONE: [done] };

function setup(items: Parameters<typeof groupsAnswer>[0] = EVERYTHING, extra: Record<string, () => unknown> = {}, member = {}) {
  const stub = stubClient({
    getTasksGroups: () => groupsAnswer(items, items.DONE ? undefined : { DONE: 1 }),
    getCalendar: () => ({ teamFilter: { canChoose: false, members: [] }, items: [] }),
    patchTasksByTaskId: () => ({}),
    postTasks: () => ({}),
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, v])),
  });
  const view = renderScreen(<TasksScreen />, stub.client, member);
  return { ...stub, ...view };
}

describe("Tasks list (F2.07, T1)", () => {
  it("groups the open work Overdue first, then Today, Upcoming, with Done folded away, and counts each", async () => {
    setup();
    const headings = await screen.findAllByRole("heading", { level: 2 });
    expect(headings.map((h) => h.textContent?.replace(/\d+$/, "").trim())).toEqual(["Overdue", "Today", "Upcoming", "Done"]);
    const overdueGroup = screen.getByRole("heading", { name: /^Overdue/ }).closest("section")!;
    expect(within(overdueGroup).getByText("Chase the signed contract")).toBeInTheDocument();
    // The late state is carried by wording and a shape, not colour alone.
    expect(within(overdueGroup).getByText(/^Overdue · /)).toBeInTheDocument();
    // Done starts closed: its rows are not drawn until it is opened.
    expect(screen.queryByText("Old task")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Done/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("completes a task at once, and Undo puts it back", async () => {
    const user = userEvent.setup();
    const { calls } = setup();
    await user.click(await screen.findByRole("checkbox", { name: /Mark “Call Sarova” done/ }));
    await waitFor(() => expect(calls.find((c) => c.id === "patchTasksByTaskId")?.args.body).toEqual({ status: "COMPLETED" }));
    expect(calls.find((c) => c.id === "patchTasksByTaskId")?.args.params).toMatchObject({ taskId: "t-today" });
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(calls.filter((c) => c.id === "patchTasksByTaskId")).toHaveLength(2));
    expect(calls.filter((c) => c.id === "patchTasksByTaskId")[1]!.args.body).toEqual({ status: "PENDING" });
  });

  it("puts the list back and says why when the server refuses a completion", async () => {
    const user = userEvent.setup();
    setup(EVERYTHING, { patchTasksByTaskId: () => apiError(403, "Only the assignee can change this.") });
    await user.click(await screen.findByRole("checkbox", { name: /Mark “Call Sarova” done/ }));
    expect(await screen.findByText(/did not go through: your role cannot do that. It has been put back./)).toBeInTheDocument();
    expect(screen.getByText("Call Sarova")).toBeInTheDocument();
  });

  it("shows someone else's task read-only, with the reason, and never lets it be changed", async () => {
    const user = userEvent.setup();
    const { calls } = setup();
    const row = (await screen.findByText("Prepare onboarding pack")).closest(".fb-tk-row") as HTMLElement;
    const box = within(row).getByRole("checkbox");
    expect(box).toHaveAttribute("aria-disabled", "true");
    expect(within(row).getByLabelText(/Status of Prepare onboarding pack/)).toBeDisabled();
    expect(row.textContent).toMatch(/This is Dev Delivery's task\. You can read it; only they, whoever created it, or Management can change it\./);
    await user.click(box);
    expect(calls.filter((c) => c.id === "patchTasksByTaskId")).toHaveLength(0);
    // No snooze on a task that is not yours to change.
    expect(within(row).queryByRole("button", { name: /Snooze/ })).not.toBeInTheDocument();
  });

  it("snoozes a task to tomorrow morning and offers Undo", async () => {
    const user = userEvent.setup();
    const { calls } = setup();
    await user.click(await screen.findByRole("button", { name: /Snooze “Call Sarova”/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Tomorrow, 9:00" }));
    await waitFor(() => expect(calls.some((c) => c.id === "patchTasksByTaskId")).toBe(true));
    const body = calls.find((c) => c.id === "patchTasksByTaskId")!.args.body as { dueAt: string };
    const d = new Date(body.dueAt);
    expect(d.getUTCHours()).toBe(9);
    expect(d.getTime()).toBeGreaterThan(Date.now());
    expect(await screen.findByRole("button", { name: "Undo" })).toBeInTheDocument();
  });

  it("quick add creates a task due this afternoon (or tomorrow morning when late) from one line", async () => {
    const user = userEvent.setup();
    const { calls } = setup();
    await user.type(await screen.findByLabelText("Quick add a task"), "Phone the landlord{Enter}");
    await waitFor(() => expect(calls.some((c) => c.id === "postTasks")).toBe(true));
    const sent = calls.find((c) => c.id === "postTasks")!;
    expect(sent.args.body).toMatchObject({ title: "Phone the landlord", priority: "MEDIUM" });
    expect(new Date((sent.args.body as { dueAt: string }).dueAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("completes several at once, skipping what is not theirs to change, and says what it skipped", async () => {
    const user = userEvent.setup();
    const { calls } = setup();
    await user.click(await screen.findByRole("button", { name: "Select" }));
    expect(screen.getByRole("checkbox", { name: "Select Prepare onboarding pack" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "Select Call Sarova" }));
    await user.click(screen.getByRole("checkbox", { name: "Select Chase the signed contract" }));
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Complete tasks/ }));
    await waitFor(() => expect(calls.filter((c) => c.id === "patchTasksByTaskId")).toHaveLength(2));
    expect(await screen.findByText(/2 tasks completed/)).toBeInTheDocument();
  });

  it("filters by search and priority", async () => {
    const user = userEvent.setup();
    const { calls } = setup();
    await screen.findByText("Call Sarova");
    await user.selectOptions(screen.getByLabelText("Priority"), "HIGH");
    expect(screen.queryByText("Call Sarova")).not.toBeInTheDocument();
    expect(screen.getByText("Chase the signed contract")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Priority"), "");
    await user.type(screen.getByLabelText("Search tasks"), "deck");
    await waitFor(() => expect(calls.filter((c) => c.id === "getTasksGroups").some((c) => c.args.query?.q === "deck")).toBe(true));
  });

  it("only Management gets the assignee filter", async () => {
    setup(EVERYTHING, {}, { permissionKeys: ["tasks.view.own", "tasks.create"] });
    await screen.findByText("Call Sarova");
    expect(screen.queryByLabelText("Assignee")).not.toBeInTheDocument();
  });

  it("shows the designed empty state with its next step", async () => {
    setup({}, { getTasksGroups: () => groupsAnswer({}) });
    expect(await screen.findByText("No tasks yet")).toBeInTheDocument();
    expect(screen.getByText(/Every follow-up you log can create one/)).toBeInTheDocument();
  });

  it("explains a refusal instead of an empty page", async () => {
    setup({}, { getTasksGroups: () => apiError(403, "no", { denial: { yourRole: "Finance", ownerRoles: ["Management", "Sales"], whoToAsk: ["Management"] } }) });
    expect(await screen.findByText(/aren.t available for your role|isn.t part of your workspace/i)).toBeInTheDocument();
    expect(screen.getByText("Finance")).toBeInTheDocument();
  });

  it("offers a retry when the list does not load, without printing the server's message", async () => {
    const user = userEvent.setup();
    let fail = true;
    const { calls } = setup({}, { getTasksGroups: () => (fail ? apiError(500, "ECONNRESET at pg.js:123") : groupsAnswer(EVERYTHING)) });
    expect(await screen.findByText("Tasks didn’t load")).toBeInTheDocument();
    expect(screen.queryByText(/ECONNRESET|pg\.js/)).not.toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Call Sarova")).toBeInTheDocument();
    expect(calls.filter((c) => c.id === "getTasksGroups").length).toBeGreaterThan(1);
  });

  it("has no accessibility violations in its main states", async () => {
    const { container } = setup();
    await screen.findByText("Call Sarova");
    expect(await violations(container)).toEqual([]);
  });
});
