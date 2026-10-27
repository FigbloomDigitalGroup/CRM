import { readdirSync, readFileSync, statSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { QueryClient } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import { createMockServer } from "../../../src/api/mockServer";
import { operations } from "../../../src/api-client";
import {
  ApiProvider,
  ErrorState,
  ToastProvider,
  useApiMutation,
  useApiQuery,
  useOptimisticUpdate,
  useUndoable,
  explainRollback,
  queryKeyFor,
} from "../../../src/ui";
import { createAppClient, newIdempotencyKey, SIGNED_OUT_EVENT } from "../../../src/ui/data/client";
import { Connectivity } from "../../../src/ui/data/connectivity";
import { DEFAULT_MOCK_URL, resolveDataSource, type DataSource } from "../../../src/ui/data/source";

/**
 * F1.06: the typed client, the cache, optimistic updates with rollback, idempotent creates, Undo and the switchable data source, tested
 * against the real mock server built from the frozen contract (`src/api/contract/openapi.v1.json`), so a drift between the screens and the API
 * shows here.
 */

let server: Server;
let mock: DataSource;
const frozen = JSON.parse(readFileSync("src/api/contract/openapi.v1.json", "utf8"));
const examples = JSON.parse(readFileSync("src/api/contract/examples.json", "utf8"));

// jsdom's AbortSignal is not the one Node's fetch accepts (a test-environment quirk; browsers are fine), so the signal is dropped here.
const nodeFetch: typeof fetch = (input, init) => fetch(input, { ...init, signal: undefined });

function source(role: string): DataSource {
  return { ...mock, mockRole: role };
}

beforeAll(async () => {
  server = createMockServer({ doc: frozen, examples });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  mock = { kind: "mock", baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, mockRole: "MANAGEMENT" };
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("the data source", () => {
  it("is the real API unless the mock is asked for", () => {
    expect(resolveDataSource({ nodeEnv: "development" })).toEqual({ kind: "real", baseUrl: "", mockRole: null });
    expect(resolveDataSource({ nodeEnv: "development", source: "real", search: "?api=mock" }).kind).toBe("mock"); // a tab can flip itself while developing
  });

  it("can point at the mock server, as any of the six roles", () => {
    const d = resolveDataSource({ nodeEnv: "development", source: "mock" });
    expect(d).toEqual({ kind: "mock", baseUrl: DEFAULT_MOCK_URL, mockRole: "MANAGEMENT" });
    expect(resolveDataSource({ nodeEnv: "development", search: "?api=mock&role=sales", mockUrl: "http://localhost:5000/" })).toEqual({
      kind: "mock",
      baseUrl: "http://localhost:5000",
      mockRole: "SALES",
    });
    expect(resolveDataSource({ nodeEnv: "development", search: "?api=mock&role=pirate" }).mockRole).toBe("MANAGEMENT");
    expect(resolveDataSource({ nodeEnv: "development", search: "?api=mock&role=none" }).mockRole).toBe("NONE");
  });

  it("is always the real API in a production build, whatever is set", () => {
    expect(resolveDataSource({ nodeEnv: "production", source: "mock", mockUrl: "http://evil.example", search: "?api=mock&role=SALES" })).toEqual({ kind: "real", baseUrl: "", mockRole: null });
  });
});

describe("the client against the mock server", () => {
  it("answers a typed call as the chosen role, with the one error envelope for a refusal", async () => {
    const api = createAppClient({ source: source("SALES"), service: new Connectivity(), fetchImpl: nodeFetch });
    const ctx = await api.call("getMyContext", { params: {} });
    expect(ctx).toBeTruthy();
    await expect(api.call("listAuditLog", { params: { orgSlug: "figbloom" } })).rejects.toMatchObject({
      status: 403,
      envelope: { denial: { yourRole: "Sales" } },
    });
  });

  it("a signed-out caller gets a 401, and the shell is told", async () => {
    const heard = vi.fn();
    window.addEventListener(SIGNED_OUT_EVENT, heard);
    const onSignedOut = vi.fn();
    const api = createAppClient({ source: source("NONE"), service: new Connectivity(), onSignedOut });
    await expect(api.call("getMyContext", { params: {} })).rejects.toMatchObject({ status: 401 });
    expect(onSignedOut).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener(SIGNED_OUT_EVENT, heard);
  });

  it("reports how long every request took, for the slow-connection bar", async () => {
    const service = new Connectivity();
    const spy = vi.spyOn(service, "reportRequest");
    const api = createAppClient({ source: source("MANAGEMENT"), service });
    await api.call("getMyContext", { params: {} });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toBeGreaterThanOrEqual(0);
  });
});

function wrap(api: ReturnType<typeof createAppClient>, queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return {
    queryClient,
    Wrapper: ({ children }: { children: React.ReactNode }) => (
      <ApiProvider client={api} queryClient={queryClient}>
        <ToastProvider>{children}</ToastProvider>
      </ApiProvider>
    ),
  };
}

describe("useApiQuery", () => {
  function Leads() {
    const q = useApiQuery("listLeads", { params: { orgSlug: "figbloom" } });
    if (q.isPending) return <p>loading</p>;
    if (q.error) return <ErrorState area="Leads" error={q.error} />;
    return <p>loaded {Array.isArray((q.data as { items?: unknown[] }).items) ? "list" : "something"}</p>;
  }

  it("loads through the typed client and caches under the operation and what was asked", async () => {
    const { Wrapper, queryClient } = wrap(createAppClient({ source: source("MANAGEMENT"), service: new Connectivity(), fetchImpl: nodeFetch }));
    render(<Leads />, { wrapper: Wrapper });
    expect(await screen.findByText(/loaded/)).toBeInTheDocument();
    expect(queryClient.getQueryData(queryKeyFor("listLeads", { params: { orgSlug: "figbloom" } }))).toBeTruthy();
    expect(queryKeyFor("listLeads", { params: { orgSlug: "a" }, query: { page: 2 } })).not.toEqual(queryKeyFor("listLeads", { params: { orgSlug: "a" }, query: { page: 3 } }));
  });

  it("a refusal reaches the screen as the explained no-access state, not as raw text", async () => {
    const { Wrapper } = wrap(createAppClient({ source: source("FINANCE"), service: new Connectivity(), fetchImpl: nodeFetch }));
    render(<Leads />, { wrapper: Wrapper });
    expect(await screen.findByText("Leads isn’t part of your workspace.")).toBeInTheDocument();
    expect(screen.getByText("Finance")).toBeInTheDocument();
  });
});

describe("useApiMutation", () => {
  it("sends an idempotency key on a create, and a different one for each new create", async () => {
    const seen: (string | null)[] = [];
    const base = (...args: Parameters<typeof fetch>) => {
      const headers = new Headers((args[1] as RequestInit).headers);
      seen.push(headers.get("idempotency-key"));
      return fetch(...args);
    };
    const api = createAppClient({ source: source("MANAGEMENT"), service: new Connectivity(), fetchImpl: base as typeof fetch });
    const { Wrapper } = wrap(api);
    function Create() {
      const create = useApiMutation("createLead", {});
      return <button onClick={() => create.mutate({ params: { orgSlug: "figbloom" }, body: { leadStatusId: "s" } as never })}>create</button>;
    }
    render(<Create />, { wrapper: Wrapper });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "create" }));
    await user.click(screen.getByRole("button", { name: "create" }));
    await waitFor(() => expect(seen).toHaveLength(2));
    expect(seen[0]).toMatch(/\S{8,}/);
    expect(seen[1]).toMatch(/\S{8,}/);
    expect(seen[0]).not.toBe(seen[1]);
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });

  it("does not add one to a read", async () => {
    let key: string | null = "unset";
    const base = (...args: Parameters<typeof fetch>) => {
      key = new Headers((args[1] as RequestInit).headers).get("idempotency-key");
      return fetch(...args);
    };
    const api = createAppClient({ source: source("MANAGEMENT"), service: new Connectivity(), fetchImpl: base as typeof fetch });
    await api.call("getMyContext", { params: {} });
    expect(key).toBeNull();
  });
});

describe("optimistic updates", () => {
  type Deal = { id: string; stage: string };

  function Board({ request }: { request: () => Promise<unknown> }) {
    const key = ["deals"];
    const move = useOptimisticUpdate<Deal[], { id: string; stage: string }>({
      queryKey: key,
      what: "Moving the deal",
      update: (current, v) => current?.map((d) => (d.id === v.id ? { ...d, stage: v.stage } : d)),
      request,
    });
    // Read the cache through a query so the component re-renders with it.
    const q = useApiQuery("getMyContext", { params: {} }, { enabled: false });
    void q;
    return <button onClick={() => move.mutate({ id: "1", stage: "WON" })}>move</button>;
  }

  it("applies at once, and puts the cache back with an explanation when the server refuses", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData<Deal[]>(["deals"], [{ id: "1", stage: "OPEN" }]);
    const api = createAppClient({ source: source("MANAGEMENT"), service: new Connectivity(), fetchImpl: nodeFetch });
    const { Wrapper } = wrap(api, queryClient);
    let release!: () => void;
    const request = () =>
      new Promise((_resolve, reject) => {
        release = () => reject({ status: 403, envelope: { denial: { yourRole: "Delivery", ownerRoles: ["Sales"], whoToAsk: [] } } });
      });
    render(<Board request={request} />, { wrapper: Wrapper });
    await userEvent.setup().click(screen.getByRole("button", { name: "move" }));
    await waitFor(() => expect(queryClient.getQueryData<Deal[]>(["deals"])![0]!.stage).toBe("WON")); // instant
    await act(async () => release());
    await waitFor(() => expect(queryClient.getQueryData<Deal[]>(["deals"])![0]!.stage).toBe("OPEN")); // rolled back
    expect(await screen.findByRole("alert")).toHaveTextContent("Moving the deal did not go through: your role cannot do that. It has been put back.");
  });

  it("explains each kind of failure in plain words", () => {
    expect(explainRollback({ status: 409, envelope: { message: "Someone else changed it." } }, "Completing the task")).toContain("Someone else changed it.");
    expect(explainRollback(new TypeError("Failed to fetch"), "Tagging")).toContain("offline");
    expect(explainRollback({ status: 500 }, "Tagging")).toContain("It has been put back");
    expect(explainRollback({ status: 401 }, "Tagging")).toContain("session ended");
  });
});

describe("undoable actions", () => {
  it("runs the action, then offers Undo for the undo window, and the undo runs the reverse", async () => {
    const run = vi.fn(async () => undefined);
    const undo = vi.fn(async () => undefined);
    function Archive() {
      const undoable = useUndoable();
      return <button onClick={() => undoable({ run, undo, message: "Lead archived." })}>archive</button>;
    }
    const { Wrapper } = wrap(createAppClient({ source: source("MANAGEMENT"), service: new Connectivity(), fetchImpl: nodeFetch }));
    render(<Archive />, { wrapper: Wrapper });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "archive" }));
    expect(run).toHaveBeenCalledTimes(1);
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("says so when the undo itself fails", async () => {
    function Archive() {
      const undoable = useUndoable();
      return <button onClick={() => undoable({ run: async () => undefined, undo: async () => Promise.reject({ status: 500 }), message: "Lead archived." })}>archive</button>;
    }
    const { Wrapper } = wrap(createAppClient({ source: source("MANAGEMENT"), service: new Connectivity(), fetchImpl: nodeFetch }));
    render(<Archive />, { wrapper: Wrapper });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "archive" }));
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Undoing that did not go through");
  });
});

describe("the connectivity service", () => {
  it("is slow after three slow requests in the last five, and recovers after two quick ones", () => {
    const c = new Connectivity();
    for (const ms of [200, 4000, 3500]) c.reportRequest(ms);
    expect(c.getSnapshot().slow).toBe(false);
    c.reportRequest(5000);
    expect(c.getSnapshot().slow).toBe(true);
    c.reportRequest(300);
    expect(c.getSnapshot().slow).toBe(true);
    c.reportRequest(250);
    expect(c.getSnapshot().slow).toBe(false);
  });

  it("goes offline and online, notifies listeners once per change, and tracks the queue", () => {
    const c = new Connectivity();
    const listener = vi.fn();
    c.subscribe(listener);
    c.setOnline(false);
    c.setOnline(false);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(c.getSnapshot().online).toBe(false);
    c.setQueued(3);
    c.setQueued(-1);
    expect(c.getSnapshot().queued).toBe(0);
    c.setOnline(true);
    expect(c.getSnapshot().online).toBe(true);
  });

  it("being offline clears slow (the offline banner says more)", () => {
    const c = new Connectivity();
    c.setLinkSlow(true);
    c.setOnline(false);
    expect(c.getSnapshot()).toMatchObject({ online: false, slow: false });
  });
});

describe("contract drift", () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? sourceFiles(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
    });
  }

  it("every operation the screens and the shell call exists in the frozen client", () => {
    const used = new Set<string>();
    for (const file of [...sourceFiles("src/ui"), ...sourceFiles("src/app").filter((f) => !f.includes(`${join("src", "app", "api")}`))]) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(/\b(?:api\.call|useApiQuery|useApiMutation)\(\s*"([A-Za-z0-9]+)"/g)) used.add(m[1]!);
    }
    expect(used.size).toBeGreaterThan(0);
    const missing = [...used].filter((id) => !(id in operations));
    expect(missing).toEqual([]);
  });
});
