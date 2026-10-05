import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskSection } from "../../src/app/o/[orgSlug]/_shared/TaskSection";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const MEMBERS = [
  { membershipId: "m1", userName: "Dev Sales" },
  { membershipId: "m2", userName: "Dev Management" },
];

const TASK = {
  id: "t1",
  title: "Follow up",
  description: null,
  assigneeMembershipId: "m1",
  dueAt: null,
  priority: "MEDIUM" as const,
  status: "PENDING" as const,
};

describe("TaskSection", () => {
  beforeEach(() => {
    refresh.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists existing tasks with their assignee name resolved from members", () => {
    render(
      <TaskSection
        orgSlug="figbloom"
        parentField="leadId"
        parentId="lead-1"
        tasks={[TASK]}
        members={MEMBERS}
        canCreate={true}
        canAssignAny={false}
      />,
    );

    expect(screen.getByText("Follow up")).toBeInTheDocument();
    expect(screen.getByText("Dev Sales")).toBeInTheDocument();
  });

  it("creates a task scoped to the given parent, and does not show an assignee picker without canAssignAny", async () => {
    const user = userEvent.setup();
    render(
      <TaskSection
        orgSlug="figbloom"
        parentField="dealId"
        parentId="deal-1"
        tasks={[]}
        members={MEMBERS}
        canCreate={true}
        canAssignAny={false}
      />,
    );

    expect(screen.queryByLabelText("Assignee")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Title"), "New task");
    await user.click(screen.getByRole("button", { name: "Create task" }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    const [, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body).toMatchObject({ title: "New task", dealId: "deal-1" });
  });

  it("shows an assignee picker when canAssignAny, and sends the chosen assignee", async () => {
    const user = userEvent.setup();
    render(
      <TaskSection
        orgSlug="figbloom"
        parentField="leadId"
        parentId="lead-1"
        tasks={[]}
        members={MEMBERS}
        canCreate={true}
        canAssignAny={true}
      />,
    );

    await user.type(screen.getByLabelText("Title"), "Assigned task");
    await user.selectOptions(screen.getByLabelText("Assignee"), "m2");
    await user.click(screen.getByRole("button", { name: "Create task" }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    const [, options] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.assigneeMembershipId).toBe("m2");
  });

  it("changes a task's status via PATCH and refreshes", async () => {
    const user = userEvent.setup();
    render(
      <TaskSection
        orgSlug="figbloom"
        parentField="leadId"
        parentId="lead-1"
        tasks={[TASK]}
        members={MEMBERS}
        canCreate={false}
        canAssignAny={false}
      />,
    );

    await user.selectOptions(screen.getByDisplayValue("PENDING"), "COMPLETED");

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith(
      "/api/orgs/figbloom/tasks/t1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ status: "COMPLETED" }),
      }),
    );
  });
});
