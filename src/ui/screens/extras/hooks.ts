"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { useApi, useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { useToast, UNDO_WINDOW_MS } from "../../components/toast";
import { describeError } from "../../errors";
import { KIND_OPS, type KindOps } from "./kinds";
import type { ExtrasKind } from "./RecordExtras";

/**
 * What every part of the panel needs: the organisation, the record's operation names, a `read` that takes any of the per-record
 * operations (the operation id is data here, the frozen contract's types are applied through the cast), and `refresh`.
 */
export function useExtras(kind: ExtrasKind, id: string) {
  const { orgSlug } = useMember();
  const api = useApi();
  const qc = useQueryClient();
  const ops: KindOps = KIND_OPS[kind];
  const params = { orgSlug, [ops.param]: id } as Record<string, string>;
  const call = useCallback(
    (op: string, extra: { body?: unknown; params?: Record<string, string>; idempotencyKey?: string } = {}) =>
      api.call(op as never, { params, ...extra } as never) as Promise<any>,
    [api, orgSlug, id, ops.param],
  );
  const refresh = useCallback((...opNames: string[]) => Promise.all(opNames.map((op) => qc.invalidateQueries({ queryKey: [op, params] }))), [qc, orgSlug, id]);
  return { orgSlug, ops, params, call, refresh, qc };
}

/** One read of a per-record operation. */
export function useRecordRead<T = any>(op: string, params: Record<string, string>, options: { enabled?: boolean; refetchInterval?: number | false | ((query: any) => number | false); query?: Record<string, string> } = {}) {
  const { query, ...rest } = options;
  return useApiQuery(op as "getHealth", { params, query } as never, rest as never) as unknown as {
    data: T | undefined;
    error: unknown;
    isLoading: boolean;
    isSuccess: boolean;
    isError: boolean;
    refetch: () => void;
  };
}

/**
 * A destructive edit that can be taken back: the change shows at once (the caller hides the item), an Undo toast stays for the undo
 * window, and only then is the change sent, so Undo is always honest. Anything still waiting when the panel closes is sent straight away.
 */
export function useDeferred() {
  const toast = useToast();
  const pending = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; commit: () => Promise<unknown>; fail: (message: string) => void }>());
  useEffect(() => {
    const map = pending.current;
    return () => {
      for (const [, p] of map) {
        clearTimeout(p.timer);
        void p.commit().catch(() => undefined);
      }
      map.clear();
    };
  }, []);
  return useCallback(
    ({ key, message, commit, onUndo, onFail }: { key: string; message: string; commit: () => Promise<unknown>; onUndo: () => void; onFail: (message: string) => void }) => {
      const timer = setTimeout(async () => {
        pending.current.delete(key);
        try {
          await commit();
        } catch (error) {
          const d = describeError(error);
          onFail(d.body);
        }
      }, UNDO_WINDOW_MS + 250);
      pending.current.set(key, { timer, commit, fail: onFail });
      toast.show({
        message,
        undo: () => {
          const p = pending.current.get(key);
          if (p) clearTimeout(p.timer);
          pending.current.delete(key);
          onUndo();
        },
      });
    },
    [toast],
  );
}
