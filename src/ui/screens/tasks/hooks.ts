"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { queryKeyFor, useApi, useApiQuery, useMember, useOptimisticUpdate, useToast } from "@/ui";
import { isOpen, type TaskGroups, type TaskItem, type TaskStatus } from "./model";

/** Every read that shows tasks: a change to one task makes all of them stale. */
const TASK_READS = ["getTasksGroups", "getTasksGroupsByGroup", "getCalendar", "getMyWork"];

export function useRefreshTasks() {
  const qc = useQueryClient();
  return useCallback(() => {
    for (const id of TASK_READS) void qc.invalidateQueries({ queryKey: [id] });
  }, [qc]);
}

/**
 * Completing (or reopening) a task from a list: the row leaves its group at once and the Done count moves, and the server's answer
 * replaces the guess a moment later. If the server refuses, the list is put back and a toast says why. Completing offers Undo.
 */
export function useSetTaskStatus(groupsKey: ReturnType<typeof queryKeyFor>) {
  const api = useApi();
  const { orgSlug } = useMember();
  const toast = useToast();
  const refresh = useRefreshTasks();

  const mutation = useOptimisticUpdate<TaskGroups, { task: TaskItem; status: TaskStatus }>({
    queryKey: groupsKey,
    what: "Updating the task",
    update: (current, { task, status }) => {
      if (!current) return current;
      const wasOpen = isOpen(task.status);
      const nowOpen = isOpen(status);
      if (wasOpen === nowOpen) return current;
      return {
        ...current,
        counts: { ...current.counts, DONE: current.counts.DONE + (nowOpen ? -1 : 1) },
        groups: current.groups.map((g) => {
          const holds = g.items.some((i) => i.id === task.id);
          if (!holds) return g.key === "DONE" && !nowOpen ? { ...g, count: g.count + 1 } : g;
          return { ...g, count: g.count - 1, total: g.total - 1, items: g.items.filter((i) => i.id !== task.id) };
        }),
      };
    },
    request: async ({ task, status }) => {
      await api.call("patchTasksByTaskId", { params: { orgSlug, taskId: task.id }, body: { status } });
      refresh();
    },
  });

  return {
    pending: mutation.isPending,
    set(task: TaskItem, status: TaskStatus, announce?: string) {
      mutation.mutate(
        { task, status },
        {
          onSuccess: () => {
            if (announce) {
              toast.show({
                message: announce,
                tone: "success",
                undo: async () => {
                  await api.call("patchTasksByTaskId", { params: { orgSlug, taskId: task.id }, body: { status: task.status } });
                  refresh();
                },
              });
            }
          },
        },
      );
    },
  };
}

/** Moves a task's due time (snooze), with an Undo that puts the old time back. */
export function useSnoozeTask() {
  const api = useApi();
  const { orgSlug } = useMember();
  const toast = useToast();
  const refresh = useRefreshTasks();
  return useCallback(
    async (task: { id: string; dueAt: string | null; title: string }, to: Date, label: string) => {
      try {
        await api.call("patchTasksByTaskId", { params: { orgSlug, taskId: task.id }, body: { dueAt: to.toISOString() } });
        refresh();
        toast.show({
          message: `Snoozed to ${label}.`,
          tone: "success",
          undo: async () => {
            await api.call("patchTasksByTaskId", { params: { orgSlug, taskId: task.id }, body: { dueAt: task.dueAt } });
            refresh();
          },
        });
      } catch {
        toast.show({ tone: "danger", message: "Couldn't snooze that task. Nothing was changed; try again." });
      }
    },
    [api, orgSlug, toast, refresh],
  );
}

/**
 * The people a task can be assigned to (and whose calendar can be viewed): the same eligible set the server enforces, read from the calendar's
 * team filter. Only for people who may assign or view more than their own; everyone else gets an empty list and a locked field with the reason.
 */
export function useAssignees(): { members: { membershipId: string; name: string }[]; canChoose: boolean; reason: string | null; loading: boolean } {
  const { orgSlug, can } = useMember();
  const wanted = can("tasks.assign.any") || can("tasks.view.all");
  const q = useApiQuery(
    "getCalendar",
    { params: { orgSlug }, query: { from: "2000-01-01T00:00:00.000Z", to: "2000-01-02T00:00:00.000Z" } },
    { enabled: wanted, staleTime: 5 * 60_000 },
  );
  const filter = q.data?.teamFilter;
  return {
    members: filter?.canChoose ? filter.members.map((m) => ({ membershipId: m.membershipId, name: m.name })) : [],
    canChoose: Boolean(filter?.canChoose),
    reason: typeof filter?.reason === "string" ? filter.reason : null,
    loading: wanted && q.isLoading,
  };
}
