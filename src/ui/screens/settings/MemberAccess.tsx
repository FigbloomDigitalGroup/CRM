"use client";

import type { UseQueryResult } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Button, Drawer, Input } from "../..";
import { describeError } from "../../errors";
import { useApiMutation, useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import type { CallArgs } from "@/api-client";
import { groupPermissions, type RoleCatalog } from "../roles/model";
import { useRoleCatalog } from "../roles/api";
import { useReport } from "./kit";

/**
 * Customise access (UC-C5 step 3, FIG-1790; docs/MEMBER_ACCESS_OVERRIDES.md): Management adds or removes single permission keys for one member
 * on top of the member's role. Three states per key: inherited from the role (default), Add, Remove. Saving replaces the member's overrides;
 * Reset clears them. The API enforces the limits (reserved and payment keys cannot be added, no editing your own); this drawer shows its refusals.
 */

export interface MemberAccessData {
  membershipId: string;
  roleKey: string;
  roleKeys: string[];
  grant: string[];
  deny: string[];
  effectiveKeys: string[];
}

export type KeyState = "inherit" | "add" | "remove";

/** The saved overrides as a state per key, and back: pure, so the rules are unit tests. */
export function statesFrom(data: Pick<MemberAccessData, "grant" | "deny">): Record<string, KeyState> {
  return { ...Object.fromEntries(data.grant.map((k) => [k, "add" as const])), ...Object.fromEntries(data.deny.map((k) => [k, "remove" as const])) };
}
export function overridesFrom(states: Record<string, KeyState>): { grant: string[]; deny: string[] } {
  const keys = Object.keys(states).sort();
  return { grant: keys.filter((k) => states[k] === "add"), deny: keys.filter((k) => states[k] === "remove") };
}

export function useMemberAccess(orgSlug: string, membershipId: string, enabled: boolean) {
  return useApiQuery("getMemberAccess", { params: { orgSlug, membershipId } } as CallArgs<"getMemberAccess">, { retry: false, enabled } as never) as unknown as UseQueryResult<MemberAccessData>;
}

export function MemberAccessDrawer({ membershipId, userName, roleName, onClose }: { membershipId: string; userName: string; roleName: string; onClose: () => void }) {
  const { orgSlug } = useMember();
  const report = useReport();
  const access = useMemberAccess(orgSlug, membershipId, true);
  const catalogQuery = useRoleCatalog(orgSlug);
  const catalog: RoleCatalog | undefined = catalogQuery.data;
  const [states, setStates] = useState<Record<string, KeyState>>({});
  const [filter, setFilter] = useState("");
  const [problems, setProblems] = useState<string[]>([]);

  useEffect(() => {
    if (access.data) setStates(statesFrom(access.data));
  }, [access.data]);

  const save = useApiMutation("setMemberAccess", {
    invalidate: [["getMemberAccess"], ["getMemberships"]],
    onSuccess: () => {
      report.ok(`${userName}’s access was updated.`);
      setProblems([]);
      onClose();
    },
    onError: (e) => {
      const d = describeError(e);
      setProblems(d.fieldErrors.length > 0 ? d.fieldErrors.map((f) => f.message) : [d.body]);
      report.fail(e, "The access change was not saved");
    },
  });

  const held = useMemo(() => new Set(access.data?.roleKeys ?? []), [access.data]);
  const next = overridesFrom(states);
  const saved = access.data ? overridesFrom(statesFrom(access.data)) : { grant: [], deny: [] };
  const dirty = JSON.stringify(next) !== JSON.stringify(saved);
  const groups = catalog ? groupPermissions(catalog.permissions, filter) : [];

  const set = (key: string, state: KeyState) => setStates((s) => ({ ...s, [key]: state }));

  const body = access.isLoading || catalogQuery.isLoading ? (
    <p role="status">Loading access…</p>
  ) : access.isError || !access.data ? (
    <p role="alert">{describeError(access.error).body}</p>
  ) : (
    <div style={{ display: "grid", gap: 12 }}>
      <p className="fb-help" style={{ margin: 0 }}>
        {userName} is {roleName}. Their role gives them {access.data.roleKeys.length} permissions. Add a permission the role lacks, or remove one it has. Anything left as “Inherited” follows the role,
        including when the role changes.
      </p>
      <p role="status" aria-live="polite" style={{ margin: 0, fontWeight: 600 }}>
        {next.grant.length === 0 && next.deny.length === 0 ? "No changes: this member has exactly their role’s access." : `Adds ${next.grant.length}, removes ${next.deny.length}.`}
      </p>
      {next.grant.length + next.deny.length > 0 ? (
        <ul aria-label="Summary of changes" style={{ margin: 0, paddingLeft: 18 }}>
          {next.grant.map((k) => <li key={`a-${k}`}>Adds <code>{k}</code></li>)}
          {next.deny.map((k) => <li key={`r-${k}`}>Removes <code>{k}</code></li>)}
        </ul>
      ) : null}
      {problems.length > 0 ? (
        <div role="alert" className="fb-set-pill fb-set-pill--bad" style={{ whiteSpace: "normal", padding: 10 }}>
          {problems.map((p) => <div key={p}>{p}</div>)}
        </div>
      ) : null}
      <Input label="Find a permission" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {groups.map((g) => (
        <fieldset key={g.area} style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 600, marginBottom: 6 }}>{g.area}</legend>
          {g.permissions.map((p) => {
            const has = held.has(p.key);
            const state = states[p.key] ?? "inherit";
            const addBlocked = has ? "Their role already has this." : !p.grantable ? (p.reason ?? "This permission cannot be added for a member.") : null;
            const removeBlocked = has ? null : "Their role does not have this.";
            return (
              <div key={p.key} style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", padding: "4px 0" }}>
                <div style={{ minWidth: 0 }}>
                  <div><code>{p.key}</code> {has ? <span className="fb-set-muted">(in role)</span> : null}</div>
                  <div className="fb-set-muted">{addBlocked && !has ? `${p.description} ${addBlocked}` : p.description}</div>
                </div>
                <select
                  className="fb-input"
                  aria-label={`Access to ${p.key}`}
                  value={state}
                  onChange={(e) => set(p.key, e.target.value as KeyState)}
                  style={{ minHeight: 34, height: 34, fontSize: 13, width: 170 }}
                >
                  <option value="inherit">Inherited from role</option>
                  <option value="add" disabled={addBlocked !== null && state !== "add"}>Add</option>
                  <option value="remove" disabled={removeBlocked !== null && state !== "remove"}>Remove</option>
                </select>
              </div>
            );
          })}
        </fieldset>
      ))}
    </div>
  );

  return (
    <Drawer
      open
      onClose={onClose}
      title={`Customise access: ${userName}`}
      footer={
        <>
          <Button variant="ghost" disabled={Object.keys(states).length === 0 || save.isPending} onClick={() => { setStates({}); setProblems([]); }}>Reset</Button>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabledReason={dirty ? undefined : "Nothing has changed."} onClick={() => save.mutate({ params: { orgSlug, membershipId }, body: next } as never)}>Save</Button>
        </>
      }
    >
      <div style={{ overflowY: "auto", maxHeight: "100%", padding: "0 2px" }}>{body}</div>
    </Drawer>
  );
}
