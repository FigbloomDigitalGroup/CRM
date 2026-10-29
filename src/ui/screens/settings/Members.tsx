"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ROLES } from "../../../../prisma/seedData";
import { Button, ConfirmDialog, Dialog, Input, Select, Avatar } from "../..";
import { describeError } from "../../errors";
import { useApi, useApiMutation, useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { Gate, Panel, rel, useReport } from "./kit";

type Row = NonNullable<ReturnType<typeof useApiQuery<"getMemberships">>["data"]>[number];
interface Checklist {
  membershipId: string;
  userName: string;
  total: number;
  totals: Record<string, number>;
}

/** Roles an organisation can hand out today; Customer Support is proposed and behind a flag, so it is only offered to a person who already has it. */
const OFFERED = ROLES.filter((r) => r.key !== "CUSTOMER_SUPPORT");

const STATE: Record<string, { label: string; tone: string }> = {
  active: { label: "Active", tone: "ok" },
  invited: { label: "Invited", tone: "warn" },
  deactivated: { label: "Deactivated", tone: "" },
  removed: { label: "Removed", tone: "" },
};

function codeOf(error: unknown): string | undefined {
  return (error as { envelope?: { code?: string } }).envelope?.code;
}

/**
 * Members (S1, FIG-1106): invite, change role, resend, deactivate, reactivate, unlock and remove, with the four states the API reports
 * (invited, active, deactivated, removed; B1.12). Deactivating keeps the person's records and history; removing is refused while they still own open
 * records, and says which, so nothing is left belonging to someone who is gone (B4.01).
 */
export function Members() {
  const { orgSlug } = useMember();
  const q = useApiQuery("getMemberships", { params: { orgSlug } });
  return (
    <>
      <InviteForm />
      <Gate q={q} area="Members">{q.data ? <MemberTable rows={q.data} /> : null}</Gate>
    </>
  );
}

function InviteForm() {
  const { orgSlug } = useMember();
  const report = useReport();
  const [form, setForm] = useState({ name: "", email: "", roleKey: "SALES" });
  const [problem, setProblem] = useState<Record<string, string>>({});
  const [sent, setSent] = useState<string | null>(null);
  const invite = useApiMutation("postMemberships", {
    invalidate: [["getMemberships", { orgSlug }, null]],
    onSuccess: () => {
      setSent(form.email);
      report.ok(`Invite sent to ${form.email}.`);
      setForm({ name: "", email: "", roleKey: form.roleKey });
      setProblem({});
    },
    onError: (e) => {
      setProblem(Object.fromEntries(describeError(e).fieldErrors.map((f) => [f.path, f.message])));
      report.fail(e, "The invite was not sent");
    },
  });
  return (
    <Panel title="Invite a member" description="They’ll get an email to set a password. Roles decide what they can see.">
      <form
        className="fb-set-inline"
        aria-label="Invite a member"
        onSubmit={(e) => {
          e.preventDefault();
          setSent(null);
          invite.mutate({ params: { orgSlug }, body: form });
        }}
      >
        <Input label="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={problem["name"]} />
        <Input label="Email" type="email" required value={form.email} placeholder="name@figbloom.co.ke" onChange={(e) => setForm({ ...form, email: e.target.value })} error={problem["email"]} />
        <Select label="Role" value={form.roleKey} onChange={(e) => setForm({ ...form, roleKey: e.target.value })} options={OFFERED.map((r) => ({ value: r.key, label: r.name }))} error={problem["roleKey"]} />
        <Button type="submit" variant="primary" loading={invite.isPending}>Send invite</Button>
      </form>
      {sent ? <p role="status" className="fb-help">Invite sent to {sent}.</p> : null}
    </Panel>
  );
}

function MemberTable({ rows }: { rows: Row[] }) {
  const { orgSlug, membershipId } = useMember();
  const api = useApi();
  const qc = useQueryClient();
  const report = useReport();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ row: Row; kind: "deactivate" | "remove" } | null>(null);
  const [reassign, setReassign] = useState<{ row: Row; checklist: Checklist } | null>(null);
  const [left, setLeft] = useState<{ row: Row; checklist: Checklist } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["getMemberships", { orgSlug }, null] });

  async function run(row: Row, work: () => Promise<unknown>, done: string, what: string) {
    setBusy(row.membershipId);
    try {
      await work();
      report.ok(done);
    } catch (e) {
      report.fail(e, what);
      throw e;
    } finally {
      setBusy(null);
      await refresh();
    }
  }
  const p = (row: Row) => ({ orgSlug, membershipId: row.membershipId });

  async function remove(row: Row) {
    try {
      await run(row, () => api.call("postMembershipsByMembershipIdRemove", { params: p(row) }), `${row.userName} was removed from the organisation.`, "The member was not removed");
    } catch (e) {
      if (codeOf(e) === "REASSIGNMENT_REQUIRED") {
        const checklist = (await api.call("getMembershipsByMembershipIdReassignment", { params: p(row) })) as unknown as Checklist;
        setReassign({ row, checklist });
      }
    }
  }

  return (
    <Panel flush title="Members" description="Deactivate when someone leaves: sign-in stops and their records keep their history. Remove takes their access to this organisation away.">
      <div className="fb-set-tablewrap">
        <table className="fb-set-table">
          <thead>
            <tr><th scope="col">Member</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Last active</th><th scope="col"><span className="fb-sr-only">Actions</span></th></tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const self = m.membershipId === membershipId;
              const state = STATE[m.state] ?? STATE["active"]!;
              const locked = m.lockedUntil && new Date(String(m.lockedUntil)).getTime() > Date.now();
              const offered = OFFERED.some((r) => r.key === m.roleKey) ? OFFERED : ROLES;
              return (
                <tr key={m.membershipId} style={{ opacity: m.state === "removed" || m.state === "deactivated" ? 0.7 : 1 }}>
                  <td>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <Avatar name={m.userName} src={typeof m.avatarUrl === "string" ? m.avatarUrl : null} size={32} />
                      <div>
                        <div style={{ fontWeight: 600 }}>{m.userName}{self ? " (you)" : ""}</div>
                        <div className="fb-set-muted">{m.userEmail}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    {m.state === "removed" ? (
                      m.roleName
                    ) : (
                      <select
                        className="fb-input"
                        aria-label={`Role for ${m.userName}`}
                        value={m.roleKey}
                        disabled={self || busy === m.membershipId}
                        title={self ? "You cannot change your own role." : undefined}
                        onChange={(e) => void run(m, () => api.call("postMembershipsByMembershipIdRole", { params: p(m), body: { roleKey: e.target.value } }), `${m.userName} is now ${ROLES.find((r) => r.key === e.target.value)?.name ?? "updated"}.`, "The role was not changed").catch(() => undefined)}
                        style={{ minHeight: 34, height: 34, fontSize: 13 }}
                      >
                        {offered.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
                      </select>
                    )}
                  </td>
                  <td>
                    <span className={`fb-set-pill ${state.tone ? `fb-set-pill--${state.tone}` : ""}`}>{state.label}</span>
                    {m.state === "invited" && m.inviteExpired ? <span className="fb-set-pill fb-set-pill--bad" style={{ marginLeft: 6 }}>Invite expired</span> : null}
                    {locked ? <span className="fb-set-pill fb-set-pill--bad" style={{ marginLeft: 6 }}>Locked</span> : null}
                  </td>
                  <td className="fb-set-muted">
                    {m.state === "invited" ? (m.inviteLastSentAt ? `Invite sent ${rel(m.inviteLastSentAt)}` : "Invite sent") : m.state === "deactivated" ? `Deactivated ${rel(m.deactivatedAt)}` : m.state === "removed" ? `Removed ${rel(m.removedAt)}` : rel(m.lastSignInAt)}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {!self && m.state !== "removed" ? (
                      <span style={{ display: "inline-flex", gap: 6 }}>
                        {m.state === "invited" ? <Button size="sm" disabled={busy === m.membershipId} onClick={() => void run(m, () => api.call("postMembershipsByMembershipIdResendInvite", { params: p(m) }), `Invite resent to ${m.userEmail}.`, "The invite was not resent").catch(() => undefined)}>Resend invite</Button> : null}
                        {m.state === "deactivated" ? <Button size="sm" disabled={busy === m.membershipId} onClick={() => void run(m, () => api.call("postMembershipsByMembershipIdReactivate", { params: p(m) }), `${m.userName} reactivated.`, "The member was not reactivated").catch(() => undefined)}>Reactivate</Button> : null}
                        {locked ? <Button size="sm" onClick={() => void run(m, () => api.call("postMembershipsByMembershipIdUnlock", { params: p(m) }), `${m.userName} can sign in again.`, "The account was not unlocked").catch(() => undefined)}>Unlock</Button> : null}
                        {m.state === "active" ? <Button size="sm" variant="danger" onClick={() => setConfirm({ row: m, kind: "deactivate" })}>Deactivate</Button> : null}
                        <Button size="sm" variant="ghost" onClick={() => setConfirm({ row: m, kind: "remove" })}>{m.state === "invited" ? "Cancel invite" : "Remove"}</Button>
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={confirm?.kind === "deactivate"}
        onClose={() => setConfirm(null)}
        title={`Deactivate ${confirm?.row.userName ?? "this member"}?`}
        body="They are signed out everywhere and cannot sign in until reactivated. Their records keep their history and owner name; you can hand their open work to someone else afterwards."
        confirmLabel="Deactivate"
        tone="danger"
        onConfirm={async () => {
          const row = confirm!.row;
          setConfirm(null);
          try {
            const out = (await api.call("postMembershipsByMembershipIdDeactivate", { params: p(row) })) as unknown as { reassignment?: Checklist };
            report.ok(`${row.userName} deactivated. Their records keep their history.`);
            await refresh();
            if (out.reassignment && out.reassignment.total > 0) setLeft({ row, checklist: out.reassignment });
          } catch (e) {
            report.fail(e, "The member was not deactivated");
          }
        }}
      />
      <ConfirmDialog
        open={confirm?.kind === "remove"}
        onClose={() => setConfirm(null)}
        title={confirm?.row.state === "invited" ? "Cancel this invite?" : `Remove ${confirm?.row.userName ?? "this member"}?`}
        body={
          confirm?.row.state === "invited"
            ? "The invite link stops working. You can invite them again later."
            : "Removing takes away access to this organisation only. Their user account remains, and their records keep their history and owner name. It is refused while they still own open records."
        }
        confirmLabel={confirm?.row.state === "invited" ? "Cancel invite" : "Remove"}
        tone="danger"
        onConfirm={async () => {
          const row = confirm!.row;
          setConfirm(null);
          await remove(row);
        }}
      />
      {left ? (
        <Dialog open onClose={() => setLeft(null)} title={`${left.row.userName} still owns ${left.checklist.total} open ${left.checklist.total === 1 ? "record" : "records"}`} actions={<><Button onClick={() => setLeft(null)}>Later</Button><Button variant="primary" onClick={() => { setReassign(left); setLeft(null); }}>Hand over now</Button></>}>
          <Checklist checklist={left.checklist} />
        </Dialog>
      ) : null}
      {reassign ? <ReassignDialog row={reassign.row} checklist={reassign.checklist} members={rows} onClose={() => setReassign(null)} onDone={() => { setReassign(null); void refresh(); }} /> : null}
    </Panel>
  );
}

function Checklist({ checklist }: { checklist: Checklist }) {
  const parts = Object.entries(checklist.totals).filter(([, n]) => n > 0);
  return (
    <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
      {parts.map(([k, n]) => <li key={k}>{n} {k}</li>)}
    </ul>
  );
}

function ReassignDialog({ row, checklist, members, onClose, onDone }: { row: Row; checklist: Checklist; members: Row[]; onClose: () => void; onDone: () => void }) {
  const { orgSlug } = useMember();
  const report = useReport();
  const targets = members.filter((m) => m.state === "active" && m.membershipId !== row.membershipId);
  const [to, setTo] = useState(targets[0]?.membershipId ?? "");
  const move = useApiMutation("postMembershipsByMembershipIdReassign", {
    onSuccess: () => {
      report.ok(`Open records handed over from ${row.userName}.`);
      onDone();
    },
    onError: (e) => report.fail(e, "The records were not handed over"),
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Hand over ${row.userName}’s open records`}
      actions={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={move.isPending} disabledReason={to ? undefined : "Choose who takes them over."} onClick={() => move.mutate({ params: { orgSlug, membershipId: row.membershipId }, body: { toMembershipId: to } })}>Hand over {checklist.total}</Button></>}
    >
      <p style={{ marginTop: 0 }}>Everything still open moves to one person. You can then remove {row.userName}.</p>
      <Checklist checklist={checklist} />
      <Select label="Hand over to" value={to} onChange={(e) => setTo(e.target.value)} options={targets.map((m) => ({ value: m.membershipId, label: `${m.userName} (${m.roleName})` }))} />
    </Dialog>
  );
}
