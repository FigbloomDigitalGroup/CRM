"use client";

import type { UseQueryResult } from "@tanstack/react-query";
import { useApiMutation, useApiQuery } from "../../data/hooks";
import type { CallArgs, OperationId } from "@/api-client";
import type { RoleCatalog, RoleList, RoleView } from "./model";

/**
 * Roles & access on the real roles API (`/orgs/{org}/roles`, FIG-1188; docs/ROLES_ACCESS_SCREENS.md). The routes are gated by the V2 release flag and
 * by `roles.manage`; an organisation that is not on V2 gets the "not available yet" state from `QueryFailure`. The frozen contract types the responses as
 * `unknown`, so the shapes come from `model.ts`.
 */

function useRead<T, K extends OperationId>(id: K, args: unknown) {
  return useApiQuery(id, args as CallArgs<K>, { retry: false } as never) as unknown as UseQueryResult<T>;
}

export const useRoles = (orgSlug: string) => useRead<RoleList, "listRoles">("listRoles", { params: { orgSlug }, query: { includeArchived: "false" } });
export const useRoleCatalog = (orgSlug: string) => useRead<RoleCatalog, "getRoleCatalog">("getRoleCatalog", { params: { orgSlug } });

function useWrite<T, K extends OperationId>(id: K) {
  const m = useApiMutation(id, { invalidate: [["listRoles"], ["getRoleCatalog"]] });
  return {
    mutateAsync: (args: unknown) => m.mutateAsync(args as CallArgs<K>) as unknown as Promise<T>,
    isPending: m.isPending,
  };
}

export const useCreateRole = () => useWrite<RoleView, "createRole">("createRole");
export const useUpdateRole = () => useWrite<RoleView, "updateRole">("updateRole");
export const useArchiveRole = () => useWrite<{ archived: boolean }, "archiveRole">("archiveRole");
