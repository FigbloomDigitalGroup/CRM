import { QueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import axe from "axe-core";
import type { ReactNode } from "react";
import { expect } from "vitest";
import type { ApiClient } from "../../../../src/api-client";
import { ApiProvider, MemberProvider, ToastProvider, testMember, type Member } from "../../../../src/ui";

/** The home, search and notification screens against a stand-in API: each test says what each operation answers. */

export type Handler = (args: { params?: Record<string, string>; query?: Record<string, unknown>; body?: unknown }) => unknown;
export type Handlers = Record<string, Handler>;

export interface Harness {
  calls: { id: string; args: Parameters<Handler>[0] }[];
  count: (id: string) => number;
  last: (id: string) => Parameters<Handler>[0] | undefined;
}

export function renderScreen(ui: ReactNode, handlers: Handlers, member: Partial<Member> = {}) {
  const calls: Harness["calls"] = [];
  const client = {
    operations: {},
    call: async (id: string, args: Parameters<Handler>[0]) => {
      calls.push({ id, args });
      const h = handlers[id];
      if (!h) throw { status: 404, envelope: { code: "NOT_FOUND", message: `no handler for ${id}`, requestId: "req_test", fieldErrors: [] } };
      return h(args);
    },
  } as unknown as ApiClient;
  const harness: Harness = {
    calls,
    count: (id) => calls.filter((c) => c.id === id).length,
    last: (id) => [...calls].reverse().find((c) => c.id === id)?.args,
  };
  const view = render(
    <ApiProvider client={client} queryClient={new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } })}>
      <ToastProvider>
        <MemberProvider value={testMember(member)}>{ui}</MemberProvider>
      </ToastProvider>
    </ApiProvider>,
  );
  return { ...view, ...harness };
}

export function apiError(status: number, extra: Record<string, unknown> = {}) {
  return { status, envelope: { code: status === 403 ? "FORBIDDEN" : "INTERNAL_ERROR", message: "x", requestId: "req_test", fieldErrors: [], ...extra } };
}

/** jsdom has no layout, so the colour-contrast rule is switched off here (the gallery and the browser suites cover contrast). */
export async function expectNoAxeViolations(root: Element) {
  const result = await axe.run(root as HTMLElement, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

export const page = <T,>(items: T[], extra: Record<string, unknown> = {}) => ({ items, page: 1, pageSize: items.length, total: items.length, pageCount: 1, nextCursor: null, ...extra });
