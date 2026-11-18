"use client";

import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { operations, type ApiClient, type CallArgs, type OperationId, type Operations } from "@/api-client";
import { describeError } from "../errors";
import { useToast } from "../components/toast";
import { getApiClient, newIdempotencyKey } from "./client";

/**
 * Data access for every screen (F1.06): the typed client behind a cache. Reads are `useApiQuery`; writes are `useApiMutation`; a write
 * that should feel instant is `useOptimisticUpdate` (applied at once, rolled back with an explanation if the server says no); a reversible
 * write offers an Undo toast through `useUndoable`. Request and response types come from the frozen contract, so a screen that drifts
 * from the API fails to compile rather than failing in production.
 */

const ClientCtx = createContext<ApiClient | null>(null);

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        // A refusal or a missing record will not change by asking again; a dropped connection or a server error might.
        retry: (count, error) => {
          const status = (error as { status?: number }).status;
          if (status !== undefined && status < 500) return false;
          return count < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}

export function ApiProvider({ children, client, queryClient }: { children: ReactNode; client?: ApiClient; queryClient?: QueryClient }) {
  const [qc] = useState(() => queryClient ?? makeQueryClient());
  const api = useMemo(() => client ?? getApiClient(), [client]);
  return (
    <ClientCtx.Provider value={api}>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </ClientCtx.Provider>
  );
}

export function useApi(): ApiClient {
  const client = useContext(ClientCtx);
  if (!client) throw new Error("useApi must be used inside <ApiProvider>.");
  return client;
}

/** The cache key for a read: the operation and exactly what was asked, so any change to the filters is a different entry. */
export function queryKeyFor<K extends OperationId>(id: K, args?: { params?: unknown; query?: unknown }): QueryKey {
  return [id, args?.params ?? null, args?.query ?? null];
}

export type QueryOptions<K extends OperationId> = Omit<UseQueryOptions<Operations[K]["response"]>, "queryKey" | "queryFn"> & { signal?: never };

export function useApiQuery<K extends OperationId>(id: K, args: CallArgs<K>, options: QueryOptions<K> = {}) {
  const api = useApi();
  return useQuery<Operations[K]["response"]>({
    ...options,
    queryKey: queryKeyFor(id, args as { params?: unknown; query?: unknown }),
    queryFn: ({ signal }) => api.call(id, { ...(args as object), signal } as CallArgs<K>),
  });
}

/**
 * A write. Creates (POST) get a fresh idempotency key per `mutate` call, reused if the same call is retried, so a double click or a flaky
 * connection can never create a record twice. `invalidate` lists the reads that are stale afterwards.
 */
export function useApiMutation<K extends OperationId>(
  id: K,
  options: { invalidate?: QueryKey[]; onSuccess?: (data: Operations[K]["response"]) => void; onError?: (error: unknown) => void } = {},
) {
  const api = useApi();
  const qc = useQueryClient();
  const isCreate = operations[id].method === "POST";
  return useMutation<Operations[K]["response"], unknown, CallArgs<K>>({
    mutationFn: (args) => api.call(id, isCreate && !(args as { idempotencyKey?: string }).idempotencyKey ? ({ ...(args as object), idempotencyKey: newIdempotencyKey() } as CallArgs<K>) : args),
    onSuccess: (data) => {
      for (const key of options.invalidate ?? []) void qc.invalidateQueries({ queryKey: key });
      options.onSuccess?.(data);
    },
    onError: options.onError,
  });
}

/** One sentence for a toast when an instant change had to be put back: what we did, and why. */
export function explainRollback(error: unknown, what: string): string {
  const d = describeError(error);
  switch (d.kind) {
    case "noAccess":
      return `${what} did not go through: your role cannot do that. It has been put back.`;
    case "validation":
    case "conflict":
      return `${what} did not go through: ${d.body} It has been put back.`;
    case "offline":
      return `${what} did not go through because you are offline. It has been put back.`;
    case "signedOut":
      return `${what} did not go through because your session ended. Sign in and try again.`;
    default:
      return `${what} did not go through. It has been put back. Try again in a moment.`;
  }
}

/**
 * An instant write (stage moves, task completion, tag edits). `update` edits the cached read straight away; if the request fails the
 * cache is restored to exactly what it was and a toast says why. Either way the read is refetched afterwards so the screen shows the truth.
 */
export function useOptimisticUpdate<TData, TVars>({
  queryKey,
  update,
  request,
  what,
}: {
  queryKey: QueryKey;
  update: (current: TData | undefined, vars: TVars) => TData | undefined;
  request: (vars: TVars) => Promise<unknown>;
  /** Names the change in the rollback message ("Moving the deal"). */
  what: string;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<unknown, unknown, TVars, { previous: TData | undefined }>({
    mutationFn: request,
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<TData>(queryKey);
      qc.setQueryData<TData | undefined>(queryKey, (current) => update(current, vars));
      return { previous };
    },
    onError: (error, _vars, context) => {
      qc.setQueryData(queryKey, context?.previous);
      toast.show({ tone: "danger", message: explainRollback(error, what) });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey });
    },
  });
}

/**
 * A reversible action with an Undo toast: runs `run`, then offers `undo` for the undo window (5 seconds). The undo itself reports its
 * failure the same way an instant write does.
 */
export function useUndoable() {
  const toast = useToast();
  return async function undoable({ run, undo, message }: { run: () => Promise<unknown>; undo: () => Promise<unknown>; message: string }) {
    await run();
    toast.show({
      message,
      undo: async () => {
        try {
          await undo();
        } catch (error) {
          toast.show({ tone: "danger", message: explainRollback(error, "Undoing that") });
        }
      },
    });
  };
}
