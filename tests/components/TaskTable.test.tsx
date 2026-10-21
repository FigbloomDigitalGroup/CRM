import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskTable } from "../../src/app/o/[orgSlug]/tasks/TaskTable";
import type { TaskRowData } from "../../src/app/o/[orgSlug]/tasks/taskTypes";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

function task(overrides: Partial<TaskRowData> = {}): TaskRowData {
  return {
    id: "t1",
    title: "Call Acme",
    description: null,
    assigneeMembershipId: "m1",
    assigneeName: "Amina Otieno",
    dueAtInput: "",
    dueLabel: "Today",
    dueState: "today",
    priority: "HIGH",
    status: "PENDING",
    link: null,
    canManage: true,
    canReassign: false,
    isClosed: false,
    ...overrides,
  };
}

const ASSIGNEES = [
  { membershipId: "m1", userName: "Amina Otieno", roleName: "Sales" },
  { membershipId: "m2", userName: "Brian Kamau", roleName: "Management" },
];

function renderTable(tasks: TaskRowData[], showAssignee = true) {
  return render(
    <TaskTable
      orgSlug="figbloom"
      tasks={tasks}
      assignees={ASSIGNEES}
      showAssignee={showAssignee}
      emptyMessage="Nothing to do."
    />,
  );
}

describe("TaskTable", () => {
  beforeEach(() => {
    refresh.mockClear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the empty message, spanning the right number of columns", () => {
    const { rerender } = renderTable([]);
    expect(screen.getByText("Nothing to do.")).toHaveAttribute("colspan", "7");

    rerender(
      <TaskTable
        orgSlug="figbloom"
        tasks={[]}
        assignees={ASSIGNEES}
        showAssignee={false}
        emptyMessage="Nothing to do."
      />,
    );
    expect(screen.getByText("Nothing to do.")).toHaveAttribute("colspan", "6");
  });

  it("renders a row with an anchor id, assignee initials, priority and due label", () => {
    renderTable([task()]);

    expect(document.getElementById("task-t1")).not.toBeNull();
    expect(screen.getByText("AO")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText("Today")).toBeInTheDocument();
  });

  it("falls back for missing assignee and due date, and hides the assignee column when asked", () => {
    const { rerender } = renderTable([task({ assigneeName: null, dueLabel: null, dueState: "none" })]);
    expect(screen.getByText("--")).toBeInTheDocument();
    expect(screen.getByText("No due date")).toBeInTheDocument();

    rerender(
      <TaskTable
        orgSlug="figbloom"
        tasks={[task()]}
        assignees={ASSIGNEES}
        showAssignee={false}
        emptyMessage="x"
      />,
    );
    expect(screen.queryByText("Assignee")).toBeNull();
  });

  it("truncates long descriptions and shows a link, or a locked link when the record is hidden", () => {
    renderTable([
      task({
        id: "t1",
        description: "x".repeat(120),
        link: { type: "Lead", label: "Acme lead", href: "/o/figbloom/leads/1" },
      }),
      task({
        id: "t2",
        title: "Second",
        link: { type: "Deal", label: null, href: null },
      }),
    ]);

    expect(screen.getByText(`${"x".repeat(90)}...`)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Acme lead/ })).toHaveAttribute(
      "href",
      "/o/figbloom/leads/1",
    );
    expect(screen.getByText("Linked deal")).toBeInTheDocument();
  });

  it("is read-only for people who cannot manage the task", () => {
    renderTable([task({ canManage: false, status: "IN_PROGRESS" })]);

    expect(screen.getByText("View only")).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit task" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mark task completed" })).toBeNull();
  });

  it("marks a task completed from the tick and refreshes", async () => {
    const user = userEvent.setup();
    renderTable([task()]);

    await user.click(screen.getByRole("button", { name: "Mark task completed" }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith(
      "/api/orgs/figbloom/tasks/t1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "COMPLETED" }) }),
    );
  });

  it("reopens a completed task to Pending, and gives a cancelled task no tick", async () => {
    const user = userEvent.setup();
    const { rerender } = renderTable([task({ status: "COMPLETED", isClosed: true })]);

    await user.click(screen.getByRole("button", { name: "Reopen task" }));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/orgs/figbloom/tasks/t1",
        expect.objectContaining({ body: JSON.stringify({ status: "PENDING" }) }),
      ),
    );

    rerender(
      <TaskTable
        orgSlug="figbloom"
        tasks={[task({ status: "CANCELLED", isClosed: true })]}
        assignees={ASSIGNEES}
        showAssignee
        emptyMessage="x"
      />,
    );
    expect(screen.queryByRole("button", { name: "Reopen task" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mark task completed" })).toBeNull();
  });

  it("shows the API's error message when a status change is rejected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Not allowed." }) }),
    );
    const user = userEvent.setup();
    renderTable([task()]);

    await user.click(screen.getByRole("button", { name: "Mark task completed" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Not allowed.");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("opens the edit drawer, saves changed details, and closes", async () => {
    const user = userEvent.setup();
    renderTable([task({ canReassign: true })]);

    await user.click(screen.getByRole("button", { name: "Edit task" }));
    const dialog = screen.getByRole("dialog", { name: "Edit task" });
    expect(within(dialog).getByText("Not linked to a record")).toBeInTheDocument();

    const title = within(dialog).getByDisplayValue("Call Acme");
    await user.clear(title);
    await user.type(title, "Call Acme again");
    await user.click(within(dialog).getByRole("radio", { name: "Low" }));
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const sent = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(sent).toMatchObject({ title: "Call Acme again", priority: "LOW", dueAt: null });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("blocks saving an empty title in the drawer", async () => {
    const user = userEvent.setup();
    renderTable([task()]);

    await user.click(screen.getByRole("button", { name: "Edit task" }));
    const dialog = screen.getByRole("dialog");
    await user.clear(within(dialog).getByDisplayValue("Call Acme"));
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(within(dialog).getByText("A task needs a title.")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("locks details on a completed task, and closes on Escape", async () => {
    const user = userEvent.setup();
    renderTable([task({ status: "COMPLETED", isClosed: true })]);

    await user.click(screen.getByRole("button", { name: "Edit task" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/This task is completed/)).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue("Call Acme")).toBeDisabled();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
