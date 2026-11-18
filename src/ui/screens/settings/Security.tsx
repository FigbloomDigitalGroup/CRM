"use client";

import { useState } from "react";
import { Button, Select } from "../..";
import { useApiMutation, useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { Gate, Panel, asArray, useReport, useWhen } from "./kit";
import type { MatrixData } from "./matrix";

export type { MatrixData } from "./matrix";

interface Policy {
  lifetimeHours: number;
  options: number[];
  defaultHours: number;
  maxAbsoluteHours: number;
  warnSecondsBeforeExpiry: number;
}
interface SignIn {
  id: string;
  userName: string | null;
  email: string | null;
  outcome: "SUCCESS" | "FAILURE" | "LOCKOUT" | "NEW_DEVICE" | string;
  reason: string | null;
  deviceLabel: string | null;
  ipAddress: string | null;
  place: string | null;
  createdAt: string;
}

const OUTCOME: Record<string, { label: string; bad: boolean }> = {
  SUCCESS: { label: "Signed in", bad: false },
  NEW_DEVICE: { label: "Signed in from a new device", bad: false },
  FAILURE: { label: "Wrong password or unknown account", bad: true },
  LOCKOUT: { label: "Account locked after repeated failures", bad: true },
};
const ACCESS_RULES: [string, string][] = [
  ["Remove from organisation", "Takes away access to this organisation only. Their user account remains, and their records keep their history and owner name. Refused while they own open records."],
  ["Deactivate", "Blocks sign-in everywhere until reactivated, and signs them out at once. Use when someone leaves."],
  ["Restricted Technical", "Sees only assigned tasks and the matching client requirements. Every record they open is written to the audit log."],
];

/**
 * Security and access (S8, FIG-1111): the session lifetime policy (it applies to sessions started after the change, and is audited), the lockout rule
 * (fixed in V1, shown so people know it), what happened at the sign-in door, how access ends, and the role matrix as the approved design has it. The matrix is
 * a read-only view in V1: roles are changed per person in Members, not edited here.
 */
export function SecurityAccess({ matrix }: { matrix: MatrixData | null }) {
  return (
    <>
      <PolicyPanel />
      <SignInEvents />
      <Panel title="How access ends" level={3}>
        {ACCESS_RULES.map(([title, body]) => (
          <div key={title} style={{ padding: "10px 0", borderTop: "1px solid var(--border)" }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{title}</div>
            <div style={{ fontSize: 13, color: "var(--text-2)", marginTop: 2, lineHeight: 1.45 }}>{body}</div>
          </div>
        ))}
      </Panel>
      {matrix ? <RoleMatrix matrix={matrix} /> : null}
    </>
  );
}

function PolicyPanel() {
  const { orgSlug } = useMember();
  const report = useReport();
  const q = useApiQuery("getSecuritySessionPolicy", { params: { orgSlug } });
  const policy = q.data as unknown as Policy | undefined;
  const [pick, setPick] = useState<string | null>(null);
  const save = useApiMutation("patchSecuritySessionPolicy", {
    invalidate: [["getSecuritySessionPolicy", { orgSlug }, null]],
    onSuccess: () => {
      setPick(null);
      report.ok("Session policy saved. It applies to new sessions.");
    },
    onError: (e) => report.fail(e, "The policy did not save"),
  });
  const chosen = pick ?? String(policy?.lifetimeHours ?? "");
  return (
    <Panel title="Sign-in policy" description="How long a sign-in lasts, and what happens after repeated wrong passwords.">
      <Gate q={q} area="The sign-in policy" lines={2}>
        {policy ? (
          <>
            <div className="fb-set-inline" style={{ maxWidth: 520 }}>
              <Select label="Sign people out after" value={chosen} onChange={(e) => setPick(e.target.value)} options={policy.options.map((h) => ({ value: String(h), label: h === 1 ? "1 hour" : `${h} hours` }))} help={`A warning appears ${Math.round(policy.warnSecondsBeforeExpiry / 60)} minutes before. Applies to new sessions; people already signed in keep theirs.`} />
              <Button variant="primary" loading={save.isPending} disabledReason={pick === null || Number(pick) === policy.lifetimeHours ? "Choose a different length first." : undefined} onClick={() => save.mutate({ params: { orgSlug }, body: { lifetimeHours: Number(chosen) } })}>Save policy</Button>
            </div>
            <div className="fb-set-note">
              <span><strong>Lockout:</strong> an account is locked for 15 minutes after 5 wrong passwords in a row. Management can unlock a member in Members. <strong>Passwords</strong> need at least 10 characters. Both are fixed in V1.</span>
            </div>
          </>
        ) : null}
      </Gate>
    </Panel>
  );
}

const PAGE = 15;

function SignInEvents() {
  const { orgSlug } = useMember();
  const when = useWhen();
  const [outcome, setOutcome] = useState("");
  const [page, setPage] = useState(1);
  const q = useApiQuery("getSecuritySignInEvents", { params: { orgSlug }, query: { ...(outcome ? { outcome: outcome as "FAILURE" } : {}), page: String(page), pageSize: String(PAGE) } }, { placeholderData: (prev) => prev });
  const data = q.data as unknown as { items: SignIn[]; total: number; pageCount: number } | undefined;
  const items = asArray<SignIn>(data?.items);
  return (
    <Panel flush title="Recent sign-in and access events" description="Every member’s sign-ins, including the ones that failed.">
      <div className="fb-set-filters">
        <Select label="Show" value={outcome} onChange={(e) => { setOutcome(e.target.value); setPage(1); }} placeholder="All events" options={[{ value: "SUCCESS", label: "Signed in" }, { value: "NEW_DEVICE", label: "New device" }, { value: "FAILURE", label: "Failed" }, { value: "LOCKOUT", label: "Locked" }]} />
      </div>
      <Gate q={q} area="Sign-in events" lines={3}>
        {items.length === 0 ? <div className="fb-set-row"><span className="fb-set-muted">No sign-in events match.</span></div> : null}
        {items.map((e) => {
          const o = OUTCOME[e.outcome] ?? { label: e.outcome, bad: false };
          return (
            <div key={e.id} className="fb-set-row" style={{ fontSize: 13.5 }}>
              <span className={`fb-set-dot ${o.bad ? "fb-set-dot--bad" : ""}`} aria-hidden="true" />
              <span className="fb-set-muted" style={{ width: 150 }}>{when(e.createdAt)}</span>
              <span style={{ width: 200, fontWeight: 600 }}>{e.userName ?? e.email ?? "Unknown"}</span>
              <span className="fb-set-row__main" style={{ color: o.bad ? "var(--red)" : "var(--text)" }}>{o.label}{e.reason ? ` · ${e.reason}` : ""}</span>
              <span className="fb-set-muted">{[e.deviceLabel, e.place].filter(Boolean).join(" · ")}</span>
            </div>
          );
        })}
        <div className="fb-set-pager">
          <span>{data ? `${data.total} events` : ""}</span>
          <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Button size="sm" disabledReason={page <= 1 ? "This is the first page." : undefined} onClick={() => setPage(page - 1)}>Previous</Button>
            <span>Page {page} of {Math.max(1, data?.pageCount ?? 1)}</span>
            <Button size="sm" disabledReason={page >= (data?.pageCount ?? 1) ? "This is the last page." : undefined} onClick={() => setPage(page + 1)}>Next</Button>
          </span>
        </div>
      </Gate>
    </Panel>
  );
}

/** The role matrix (read-only in V1): which roles hold which permission. It is the approved matrix; changing a person’s role is done in Members. */
export function RoleMatrix({ matrix }: { matrix: MatrixData }) {
  return (
    <Panel flush title="Role matrix" description="What each role can do in V1. Read-only: to change what someone can do, change their role in Members.">
      <div className="fb-set-tablewrap">
        <table className="fb-set-table fb-set-matrix" aria-label="Role matrix">
          <thead>
            <tr><th scope="col">Permission</th>{matrix.roles.map((r) => <th key={r.key} scope="col">{r.name}</th>)}</tr>
          </thead>
          <tbody>
            {matrix.areas.map((a) => (
              <MatrixArea key={a.area} area={a} roles={matrix.roles} />
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function MatrixArea({ area, roles }: { area: MatrixData["areas"][number]; roles: MatrixData["roles"] }) {
  return (
    <>
      <tr className="fb-set-area"><td colSpan={roles.length + 1}>{area.area}</td></tr>
      {area.rows.map((r) => (
        <tr key={r.key}>
          <td><div style={{ fontWeight: 600 }}>{r.key}</div><div className="fb-set-muted">{r.description}</div></td>
          {roles.map((role) => (
            <td key={role.key}>{r.roles[role.key] ? <span className="fb-set-yes" aria-label={`${role.name} can`}>✓</span> : <span className="fb-set-no" aria-label={`${role.name} cannot`}>–</span>}</td>
          ))}
        </tr>
      ))}
    </>
  );
}
