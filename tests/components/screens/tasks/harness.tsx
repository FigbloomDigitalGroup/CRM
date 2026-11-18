import axe from "axe-core";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import { ApiRequestError, type ApiClient } from "../../../../src/api-client";
import { ApiProvider, MemberProvider, ToastProvider, makeQueryClient, testMember, type Member } from "../../../../src/ui";

/**
 * The tasks and calendar screens are driven against a stubbed API client: each test says what the API answers per operation, and sees which calls
 * the screen made. (The screens' types come from the frozen contract; this stub only replaces the network.)
 */

export type Handler = (args: { params?: Record<string, string>; query?: Record<string, unknown>; body?: unknown }) => unknown;

export function stubClient(handlers: Record<string, Handler>) {
  const calls: { id: string; args: Parameters<Handler>[0] }[] = [];
  const call = vi.fn(async (id: string, args: Parameters<Handler>[0] = {}) => {
    calls.push({ id, args });
    const h = handlers[id];
    if (!h) throw new Error(`No stub for ${id}`);
    const out = await h(args);
    if (out instanceof ApiRequestError) throw out;
    return out;
  });
  return { client: { call, operations: {} } as unknown as ApiClient, calls, call };
}

export function apiError(status: number, message = "Nope", extra: Record<string, unknown> = {}) {
  return new ApiRequestError(status, { error: message, code: status === 403 ? "FORBIDDEN" : "SERVER_ERROR", message, fieldErrors: [], requestId: "req-1", ...extra }, "test");
}

export function renderScreen(ui: React.ReactNode, client: ApiClient, member: Partial<Member> = {}) {
  // No automatic retries in tests: a refusal or a failure should show at once, not after the production back-off.
  const queryClient = makeQueryClient();
  queryClient.setDefaultOptions({ queries: { retry: false, staleTime: 30_000 }, mutations: { retry: false } });
  return render(
    <ApiProvider client={client} queryClient={queryClient}>
      <ToastProvider>
        <MemberProvider value={testMember({ permissionKeys: ["tasks.view.own", "tasks.create"], timeZone: "UTC", ...member })}>
          <main>{ui}</main>
        </MemberProvider>
      </ToastProvider>
    </ApiProvider>,
  );
}

export async function violations(root: Element) {
  const result = await axe.run(root as HTMLElement, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  return result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("; ")})`);
}

/** A task the way `GET /tasks/groups` returns it. */
export function task(over: Partial<Record<string, unknown>> & { id: string; title: string }) {
  return {
    description: null,
    requirements: null,
    assigneeMembershipId: "m-1",
    createdByMembershipId: "m-1",
    assigneeName: "Test Member",
    dueAt: null,
    priority: "MEDIUM",
    status: "PENDING",
    completedAt: null,
    link: null,
    readOnly: false,
    ...over,
  };
}

export function groupsAnswer(items: Partial<Record<"OVERDUE" | "TODAY" | "THIS_WEEK" | "LATER" | "NO_DATE" | "DONE", unknown[]>>, counts: Partial<Record<string, number>> = {}) {
  const keys = ["OVERDUE", "TODAY", "THIS_WEEK", "LATER", "NO_DATE", "DONE"] as const;
  const full = Object.fromEntries(keys.map((k) => [k, counts[k] ?? (items[k] ?? []).length]));
  return {
    timeZone: "UTC",
    counts: full,
    groups: keys.map((k) => ({
      key: k,
      label: k,
      count: full[k],
      collapsed: k === "DONE" && !items.DONE,
      items: items[k] ?? [],
      page: 1,
      pageSize: 50,
      total: full[k],
      pageCount: 1,
      nextCursor: null,
    })),
  };
}
