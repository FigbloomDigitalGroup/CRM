import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MyWorkList, TasksPanel } from "../../../../src/ui/screens/tasks";
import { apiError, groupsAnswer, renderScreen, stubClient, task, violations } from "./harness";

vi.mock("next/navigation", () => ({ usePathname: () => "/o/figbloom", useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();

function work(over: Record<string, unknown> & { id: string; title: string }) {
  return { description: null, requirements: null, status: "PENDING", priority: "MEDIUM", dueAt: hours(30), completedAt: null, files: [], ...over };
}
function myWork(items: Record<string, unknown[]>) {
  const keys = ["OVERDUE", "TODAY", "THIS_WEEK", "LATER", "NO_DATE", "DONE"];
  const counts = Object.fromEntries(keys.map((k) => [k, (items[k] ?? []).length]));
  return { timeZone: "UTC", counts, groups: keys.map((k) => ({ key: k, label: k, count: counts[k], collapsed: false, items: items[k] ?? [], page: 1, pageSize: 50, total: counts[k], pageCount: 1 })) };
}

describe("My work (D3)", () => {
  const member = { permissionKeys: ["mywork.view", "tasks.view.own", "tasks.create"], roleName: "Restricted Technical" };

  it("shows the three tiles, the notice and each task with its client requirements", async () => {
    const stub = stubClient({
      getMyWork: () =>
        myWork({
          OVERDUE: [work({ id: "w1", title: "Fix the SSL certificate", dueAt: hours(-5), requirements: "- Wildcard cert\n- Renew before 30 Nov", files: [{ attachmentId: "f1", title: "Brief", name: "brief.pdf", sizeBytes: 20480 }] })],
          THIS_WEEK: [work({ id: "w2", title: "Migrate the mailboxes", priority: "HIGH" })],
        }),
    });
    const { container } = renderScreen(<MyWorkList />, stub.client, member);
    expect(await screen.findByText("Fix the SSL certificate")).toBeInTheDocument();
    expect(screen.getByText("Assigned to me").closest("a")).toHaveTextContent("2");
    expect(screen.getByText("Overdue").closest("a")).toHaveTextContent("1");
    expect(screen.getByText(/You see the tasks assigned to you/)).toBeInTheDocument();
    expect(screen.getByText("Wildcard cert")).toBeInTheDocument();
    expect(screen.getByText("Renew before 30 Nov")).toBeInTheDocument();
    expect(screen.getByText("No requirements attached yet")).toBeInTheDocument();
    expect(screen.getByText(/brief\.pdf|Brief/)).toBeInTheDocument();
    expect(await violations(container)).toEqual([]);
  });

  it("never shows a customer, a deal, a value or a link: the API gives none and the cards add none", async () => {
    const stub = stubClient({ getMyWork: () => myWork({ TODAY: [work({ id: "w1", title: "Fix the SSL certificate", requirements: "Cert" })] }) });
    const { container } = renderScreen(<MyWorkList />, stub.client, member);
    await screen.findByText("Fix the SSL certificate");
    expect(container.querySelectorAll("a[href*='/deals'], a[href*='/companies'], a[href*='/leads'], a[href*='/contacts']")).toHaveLength(0);
    expect(container.textContent).not.toMatch(/\b(USD|KES|EUR|GBP)\b|\$\s?\d/);
  });

  it("completes a task from the card", async () => {
    const user = userEvent.setup();
    const stub = stubClient({ getMyWork: () => myWork({ TODAY: [work({ id: "w1", title: "Fix the SSL certificate" })] }), patchTasksByTaskId: () => ({}) });
    renderScreen(<MyWorkList />, stub.client, member);
    await user.click(await screen.findByRole("checkbox", { name: /Mark “Fix the SSL certificate” done/ }));
    await waitFor(() => expect(stub.calls.find((c) => c.id === "patchTasksByTaskId")?.args.body).toEqual({ status: "COMPLETED" }));
  });

  it("shows the designed empty state and lets the person add one for themselves", async () => {
    const onCreate = vi.fn();
    const user = userEvent.setup();
    const stub = stubClient({ getMyWork: () => myWork({}) });
    renderScreen(<MyWorkList onCreate={onCreate} />, stub.client, member);
    expect(await screen.findByText("No work assigned yet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Add a task for myself/ }));
    expect(onCreate).toHaveBeenCalled();
  });

  it("explains a refusal for a role without My work", async () => {
    const stub = stubClient({ getMyWork: () => apiError(403, "no", { denial: { yourRole: "Sales", ownerRoles: ["Restricted Technical"], whoToAsk: ["Management"] } }) });
    renderScreen(<MyWorkList />, stub.client);
    expect(await screen.findByText(/aren.t available for your role|isn.t part of your workspace/i)).toBeInTheDocument();
  });
});

describe("TasksPanel (Do these today)", () => {
  const dueSoon = task({ id: "p1", title: "Call Sarova", dueAt: hours(2), link: { type: "Lead", id: "l1", label: "Sarova Hotels" } });

  it("lists what needs doing now with its record, and completes from the tick", async () => {
    const user = userEvent.setup();
    const stub = stubClient({ getTasksGroups: () => groupsAnswer({ TODAY: [dueSoon] }), patchTasksByTaskId: () => ({}) });
    renderScreen(<TasksPanel />, stub.client);
    const panel = await screen.findByRole("region", { name: "Do these today" });
    expect(await within(panel).findByText("Call Sarova")).toBeInTheDocument();
    expect(within(panel).getAllByRole("link", { name: /Sarova Hotels/ })[0]).toHaveAttribute("href", "/o/figbloom/leads/l1");
    expect(stub.calls[0]!.args.query).toMatchObject({ groups: "OVERDUE,TODAY" });
    await user.click(within(panel).getByRole("checkbox", { name: /Mark “Call Sarova” done/ }));
    await waitFor(() => expect(stub.calls.some((c) => c.id === "patchTasksByTaskId")).toBe(true));
  });

  it("says so when nothing is due", async () => {
    const stub = stubClient({ getTasksGroups: () => groupsAnswer({}) });
    renderScreen(<TasksPanel />, stub.client);
    expect(await screen.findByText("Nothing due today. Nice.")).toBeInTheDocument();
  });
});
