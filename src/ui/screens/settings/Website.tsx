"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, ConfirmDialog, Dialog, Input, Select, Textarea } from "../..";
import { useApi, useApiMutation, useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { Gate, Panel, Switch, asArray, rel, useReport, useWhen } from "./kit";

interface WebsiteStatus {
  configured: boolean;
  keyPrefix?: string;
  createdAt?: string;
  rotatedAt?: string | null;
  previousKey?: { keyPrefix: string | null; validUntil: string } | null;
  lastAcceptedAt?: string | null;
  lastRejectedAt?: string | null;
  lastRejection?: { at: string; outcome: string; reason: string | null; explanation: string | null } | null;
  revoked?: boolean;
  allowedOrigins?: string[];
  honeypotFieldName?: string | null;
  captchaConfigured?: boolean;
}
interface ActivityRow {
  id: string;
  outcome: string;
  reason: string | null;
  origin: string | null;
  ipAddress: string | null;
  createdAt: string;
}
interface Rejected extends ActivityRow {
  at: string;
  explanation: string | null;
}
interface Rule {
  id: string;
  name: string;
  leadSourceId?: string | null;
  serviceId?: string | null;
  assigneeMembershipIds: string[];
  assigneeMembershipId: string;
  sequence: number;
  isActive: boolean;
}

const GRACE = [0, 1, 6, 24, 48, 72];

/**
 * Website integration (S1, FIG-1106): the key (shown once when it is made; afterwards only its prefix), rotation with a grace window so the live form never
 * breaks, abuse protection, the acknowledgement email, the assignment rules (first match wins; rules assign and remind, they never move a deal) and the
 * submissions the endpoint turned away, each with the reason in plain words (B4.01).
 */
export function WebsiteIntegration() {
  const { orgSlug } = useMember();
  const q = useApiQuery("getIntegrationsWebsiteKey", { params: { orgSlug } });
  const status = q.data as unknown as WebsiteStatus | undefined;
  return (
    <Gate q={q} area="The website integration">
      {status ? (
        <>
          <KeyPanel status={status} />
          {status.configured ? (
            <>
              <div className="fb-set-cards">
                <AbusePanel status={status} />
                <AcknowledgementPanel />
              </div>
              <AssignmentPanel />
              <SubmissionsPanel status={status} />
            </>
          ) : null}
        </>
      ) : null}
    </Gate>
  );
}

function KeyPanel({ status }: { status: WebsiteStatus }) {
  const { orgSlug } = useMember();
  const api = useApi();
  const qc = useQueryClient();
  const report = useReport();
  const when = useWhen();
  const [rotate, setRotate] = useState(false);
  const [revoke, setRevoke] = useState(false);
  const [grace, setGrace] = useState("24");
  const [fresh, setFresh] = useState<{ apiKey: string; until: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["getIntegrationsWebsiteKey", { orgSlug }, null] });
  const state = !status.configured ? { label: "Not connected", tone: "" } : status.revoked ? { label: "Key revoked", tone: "bad" } : status.lastAcceptedAt ? { label: `Connected · last lead ${rel(status.lastAcceptedAt)}`, tone: "ok" } : { label: "Key ready · no lead yet", tone: "warn" };

  async function make() {
    try {
      const out = await api.call("postIntegrationsWebsiteKey", { params: { orgSlug }, body: { graceHours: Number(grace) } });
      setFresh({ apiKey: out.apiKey, until: out.previousKeyValidUntil });
      report.ok(status.configured ? "New key created." : "Key created.");
      await refresh();
    } catch (e) {
      report.fail(e, "The key was not created");
    }
  }

  return (
    <Panel
      title="Website integration"
      description="Enquiries from your website become leads with an owner and an acknowledgement."
      actions={<span className={`fb-set-pill ${state.tone ? `fb-set-pill--${state.tone}` : ""}`}><span className={`fb-set-dot ${state.tone === "bad" ? "fb-set-dot--bad" : ""}`} aria-hidden="true" />{state.label}</span>}
    >
      {status.configured && !status.revoked ? (
        <div>
          <span className="fb-label">API key</span>
          <div className="fb-set-keyrow" style={{ marginTop: 6 }}>
            <code className="fb-set-code" aria-label="API key prefix">{status.keyPrefix}••••••••••••</code>
            <Button variant="danger" onClick={() => setRotate(true)}>Rotate</Button>
            <Button onClick={() => setRevoke(true)}>Revoke</Button>
          </div>
          <p className="fb-set-muted" style={{ margin: "8px 0 0" }}>
            Created {when(status.createdAt)}{status.rotatedAt ? ` · rotated ${when(status.rotatedAt)}` : ""}. A key is shown once, when it is made.
            {status.previousKey ? ` The previous key (${status.previousKey.keyPrefix}…) keeps working until ${when(status.previousKey.validUntil)}.` : ""}
          </p>
        </div>
      ) : (
        <div>
          <p style={{ margin: "0 0 10px" }}>{status.revoked ? "The key was revoked, so the website form is not accepted. Create a new one to connect again." : "No key yet. Create one and give it to whoever maintains the website form."}</p>
          <Button variant="primary" onClick={() => void make()}>Create key</Button>
        </div>
      )}
      {status.lastRejection ? (
        <div className="fb-set-note" role="status">
          <span><strong>Last rejected {rel(status.lastRejection.at)}:</strong> {status.lastRejection.explanation ?? status.lastRejection.reason ?? status.lastRejection.outcome}</span>
        </div>
      ) : null}

      <ConfirmDialog
        open={rotate}
        onClose={() => setRotate(false)}
        title="Rotate the website key?"
        confirmLabel="Create new key"
        tone="danger"
        body={
          <>
            <p style={{ marginTop: 0 }}>The new key works at once. The old one keeps working for the window below so the live form does not break while you update the website.</p>
            <Select label="Old key keeps working for" value={grace} onChange={(e) => setGrace(e.target.value)} options={GRACE.map((h) => ({ value: String(h), label: h === 0 ? "Not at all (stop it now)" : h === 1 ? "1 hour" : `${h} hours` }))} />
          </>
        }
        onConfirm={async () => {
          setRotate(false);
          await make();
        }}
      />
      <ConfirmDialog
        open={revoke}
        onClose={() => setRevoke(false)}
        title="Revoke the website key?"
        confirmLabel="Revoke"
        tone="danger"
        body="Every submission from the website is refused until a new key is created, including during any rotation window."
        onConfirm={async () => {
          try {
            await api.call("postIntegrationsWebsiteKeyRevoke", { params: { orgSlug } });
            report.ok("Website key revoked.");
            setRevoke(false);
            await refresh();
          } catch (e) {
            report.fail(e, "The key was not revoked");
          }
        }}
      />
      {fresh ? (
        <Dialog open onClose={() => setFresh(null)} title="Your new website key" actions={<Button variant="primary" onClick={() => setFresh(null)}>I have copied it</Button>}>
          <p style={{ marginTop: 0 }}>Copy it now. For security it is not shown again; only its start is kept.</p>
          <div className="fb-set-keyrow">
            <code className="fb-set-code" data-testid="new-website-key">{fresh.apiKey}</code>
            <Button onClick={() => void navigator.clipboard?.writeText(fresh.apiKey).then(() => report.ok("Copied to clipboard."))}>Copy</Button>
          </div>
          {Number(grace) > 0 ? <p className="fb-set-muted">The old key stops working at {when(fresh.until)}.</p> : null}
        </Dialog>
      ) : null}
    </Panel>
  );
}

function AbusePanel({ status }: { status: WebsiteStatus }) {
  const { orgSlug } = useMember();
  const report = useReport();
  const qc = useQueryClient();
  const [origins, setOrigins] = useState((status.allowedOrigins ?? []).join("\n"));
  const [honeypot, setHoneypot] = useState(status.honeypotFieldName ?? "");
  const [captcha, setCaptcha] = useState("");
  const save = useApiMutation("postIntegrationsWebsiteKeySettings", {
    onSuccess: () => {
      setCaptcha("");
      report.ok("Abuse protection saved.");
      void qc.invalidateQueries({ queryKey: ["getIntegrationsWebsiteKey", { orgSlug }, null] });
    },
    onError: (e) => report.fail(e, "The protection settings did not save"),
  });
  return (
    <Panel title="Abuse protection" level={3}>
      <Textarea label="Allowed websites" rows={3} value={origins} onChange={(e) => setOrigins(e.target.value)} help="One address per line, for example https://figbloom.co.ke. Empty allows any." />
      <Input label="Hidden honeypot field" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} help="Silently rejects bots that fill an invisible field. Empty turns it off." />
      <Input label="Challenge secret" type="password" value={captcha} onChange={(e) => setCaptcha(e.target.value)} placeholder={status.captchaConfigured ? "Configured (type to replace)" : "Not set"} help="Shows a check only when traffic looks suspicious. Never shown again once saved." />
      <p className="fb-set-muted" style={{ margin: 0 }}>Rate limiting and the duplicate check are always on: duplicates join the existing timeline.</p>
      <div>
        <Button
          variant="primary"
          loading={save.isPending}
          onClick={() => save.mutate({ params: { orgSlug }, body: { allowedOrigins: origins.split("\n").map((s) => s.trim()).filter(Boolean), honeypotFieldName: honeypot.trim() || null, ...(captcha ? { captchaSecret: captcha } : {}) } })}
        >
          Save protection
        </Button>
      </div>
    </Panel>
  );
}

function AcknowledgementPanel() {
  const { orgSlug } = useMember();
  const report = useReport();
  const q = useApiQuery("getIntegrationsWebsiteKeyAcknowledgement", { params: { orgSlug } });
  const qc = useQueryClient();
  const set = useApiMutation("postIntegrationsWebsiteKeyAcknowledgement", {
    onSuccess: (d) => {
      report.ok(d.enabled ? "Acknowledgement emails are on." : "Acknowledgement emails are off.");
      void qc.invalidateQueries({ queryKey: ["getIntegrationsWebsiteKeyAcknowledgement", { orgSlug }, null] });
    },
    onError: (e) => report.fail(e, "The acknowledgement setting did not save"),
  });
  return (
    <Panel title="Acknowledgement" level={3}>
      <Gate q={q} area="The acknowledgement setting" lines={2}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <Switch label="Email the enquirer automatically" checked={q.data?.enabled ?? false} onChange={(enabled) => set.mutate({ params: { orgSlug }, body: { enabled } })} />
          <strong>Email the enquirer automatically</strong>
        </div>
        <div className="fb-set-preview">A short thank-you email goes to the person who filled in the form, from the organisation, within a minute of the submission.</div>
      </Gate>
    </Panel>
  );
}

function AssignmentPanel() {
  const { orgSlug } = useMember();
  const report = useReport();
  const qc = useQueryClient();
  const api = useApi();
  const rules = useApiQuery("getWebsiteLeadAssignmentRules", { params: { orgSlug } });
  const mode = useApiQuery("getIntegrationsWebsiteKeyAssignment", { params: { orgSlug } });
  const ref = useApiQuery("getReferenceData", { params: { orgSlug } });
  const [adding, setAdding] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["getWebsiteLeadAssignmentRules", { orgSlug }, null] });
  const nameOf = (id?: string | null, list: { id: string; name: string }[] = []) => list.find((x) => x.id === id)?.name;
  const memberName = (id: string) => ref.data?.members.find((m) => m.membershipId === id)?.userName ?? "Unknown";
  const list = [...(rules.data ?? [])] as unknown as Rule[];
  list.sort((a, b) => a.sequence - b.sequence);
  const setMode = useApiMutation("postIntegrationsWebsiteKeyAssignment", {
    onSuccess: () => {
      report.ok("Assignment mode saved.");
      void qc.invalidateQueries({ queryKey: ["getIntegrationsWebsiteKeyAssignment", { orgSlug }, null] });
    },
    onError: (e) => report.fail(e, "The mode did not save"),
  });

  async function act(work: () => Promise<unknown>, done: string) {
    try {
      await work();
      report.ok(done);
    } catch (e) {
      report.fail(e, "The rule did not change");
    } finally {
      await refresh();
    }
  }

  return (
    <Panel flush title="Assignment rules" description="First match wins. Rules assign and remind; they never move a deal."
      actions={<Button onClick={() => setAdding(true)}>Add a rule</Button>}>
      <div style={{ padding: "0 22px 12px", maxWidth: 360 }}>
        <Select
          label="When no rule matches"
          value={String(mode.data?.mode ?? "ROUND_ROBIN")}
          onChange={(e) => setMode.mutate({ params: { orgSlug }, body: { mode: e.target.value as "ROUND_ROBIN" | "UNASSIGNED" } })}
          options={[{ value: "ROUND_ROBIN", label: "Share between the team in turn" }, { value: "UNASSIGNED", label: "Unassigned pool, notify Management" }]}
        />
      </div>
      <Gate q={rules} area="The assignment rules" lines={3}>
        {list.length === 0 ? <div className="fb-set-row"><span className="fb-set-muted">No rules yet. Every new website lead follows the setting above.</span></div> : null}
        {list.map((r, i) => (
          <div key={r.id} className={`fb-set-row ${r.isActive ? "" : "fb-set-row--hidden"}`}>
            <span className="fb-set-muted" style={{ width: 20 }}>{i + 1}</span>
            <div className="fb-set-row__main">
              <div className="fb-set-row__name">{r.name}</div>
              <div className="fb-set-row__meta">
                If {[nameOf(r.serviceId, ref.data?.services) && `service is ${nameOf(r.serviceId, ref.data?.services)}`, nameOf(r.leadSourceId, ref.data?.leadSources) && `source is ${nameOf(r.leadSourceId, ref.data?.leadSources)}`].filter(Boolean).join(" and ") || "anything else"} → {(r.assigneeMembershipIds.length ? r.assigneeMembershipIds : [r.assigneeMembershipId]).map(memberName).join(", ")}
              </div>
            </div>
            <Button size="sm" variant="ghost" aria-label={`Move ${r.name} up`} disabledReason={i === 0 ? "Already first." : undefined} onClick={() => void act(() => api.call("postWebsiteLeadAssignmentRulesByRuleIdMove", { params: { orgSlug, ruleId: r.id }, body: { direction: "up" } }), "Rule moved up.")}>↑</Button>
            <Button size="sm" variant="ghost" aria-label={`Move ${r.name} down`} disabledReason={i === list.length - 1 ? "Already last." : undefined} onClick={() => void act(() => api.call("postWebsiteLeadAssignmentRulesByRuleIdMove", { params: { orgSlug, ruleId: r.id }, body: { direction: "down" } }), "Rule moved down.")}>↓</Button>
            <Switch label={`${r.name} is on`} checked={r.isActive} onChange={(isActive) => void act(() => api.call("postWebsiteLeadAssignmentRulesByRuleId", { params: { orgSlug, ruleId: r.id }, body: { isActive } as never }), isActive ? "Rule turned on." : "Rule paused.")} />
          </div>
        ))}
      </Gate>
      {adding ? <RuleDialog onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void refresh(); }} /> : null}
    </Panel>
  );
}

function RuleDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { orgSlug } = useMember();
  const report = useReport();
  const ref = useApiQuery("getReferenceData", { params: { orgSlug } });
  const [form, setForm] = useState({ name: "", serviceId: "", leadSourceId: "", assignee: "" });
  const create = useApiMutation("postWebsiteLeadAssignmentRules", {
    onSuccess: () => {
      report.ok("Rule added.");
      onSaved();
    },
    onError: (e) => report.fail(e, "The rule was not added"),
  });
  const people = (ref.data?.members ?? []).filter((m) => ["SALES", "MANAGEMENT"].includes(m.roleKey));
  return (
    <Dialog open onClose={onClose} title="Add an assignment rule" actions={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={create.isPending} disabledReason={form.name && form.assignee ? undefined : "Give the rule a name and choose who gets the lead."} onClick={() => create.mutate({ params: { orgSlug }, body: { name: form.name, serviceId: form.serviceId || null, leadSourceId: form.leadSourceId || null, assigneeMembershipIds: [form.assignee] } })}>Add rule</Button></>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Input label="Rule name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Select label="If the service is" value={form.serviceId} onChange={(e) => setForm({ ...form, serviceId: e.target.value })} placeholder="Any service" options={asArray<{ id: string; name: string }>(ref.data?.services).map((s) => ({ value: s.id, label: s.name }))} />
        <Select label="If the source is" value={form.leadSourceId} onChange={(e) => setForm({ ...form, leadSourceId: e.target.value })} placeholder="Any source" options={asArray<{ id: string; name: string }>(ref.data?.leadSources).map((s) => ({ value: s.id, label: s.name }))} />
        <Select label="Assign to" required value={form.assignee} onChange={(e) => setForm({ ...form, assignee: e.target.value })} placeholder="Choose a person" options={people.map((m) => ({ value: m.membershipId, label: `${m.userName} (${m.roleName})` }))} />
      </div>
    </Dialog>
  );
}

function SubmissionsPanel({ status }: { status: WebsiteStatus }) {
  const { orgSlug } = useMember();
  const when = useWhen();
  const activity = useApiQuery("getIntegrationsWebsiteKeyActivity", { params: { orgSlug } });
  const rejected = useApiQuery("listRejectedWebsiteSubmissions", { params: { orgSlug }, query: { pageSize: "20" } });
  const why = new Map(asArray<Rejected>((rejected.data as unknown as { items?: unknown[] } | undefined)?.items).map((r) => [r.id, r.explanation]));
  const rows = asArray<ActivityRow>(activity.data);
  return (
    <Panel flush title="Recent submissions and errors" description={status.lastRejectedAt ? `Last rejected ${rel(status.lastRejectedAt)}.` : "Everything the website endpoint accepted or turned away."}>
      <Gate q={activity} area="Recent submissions" lines={3}>
        {rows.length === 0 ? <div className="fb-set-row"><span className="fb-set-muted">Nothing yet. Submissions from the website appear here.</span></div> : null}
        {rows.map((r) => {
          const ok = r.outcome === "ACCEPTED" || r.outcome === "CREATED";
          return (
            <div key={r.id} className="fb-set-row" style={{ fontSize: 13.5 }}>
              <span className={`fb-set-dot ${ok ? "" : "fb-set-dot--bad"}`} aria-hidden="true" />
              <span className="fb-set-muted" style={{ width: 150 }}>{when(r.createdAt)}</span>
              <strong style={{ width: 130 }}>{ok ? "Accepted" : "Rejected"}</strong>
              <span className="fb-set-row__main" style={{ color: ok ? "var(--text-2)" : "var(--red)" }}>{ok ? (r.origin ?? "Lead created") : (why.get(r.id) ?? r.reason ?? r.outcome)}</span>
            </div>
          );
        })}
      </Gate>
    </Panel>
  );
}

interface InboundStatus {
  configured: boolean;
  keyPrefix?: string;
  lastReceivedAt?: string | null;
  lastError?: { at: string | null; message: string } | null;
  revoked?: boolean;
}

/** Inbound email (S1, FIG-1106): the forwarding address key. Shown once when made; after that only its start and when mail last arrived. */
export function InboundEmail() {
  const { orgSlug } = useMember();
  const api = useApi();
  const qc = useQueryClient();
  const report = useReport();
  const when = useWhen();
  const q = useApiQuery("getIntegrationsInboundEmailKey", { params: { orgSlug } });
  const s = q.data as unknown as InboundStatus | undefined;
  const [confirm, setConfirm] = useState<"regen" | "revoke" | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["getIntegrationsInboundEmailKey", { orgSlug }, null] });
  return (
    <Gate q={q} area="Inbound email">
      <Panel title="Inbound email" description="Forward enquiries to the address built from this key. New senders become leads; known senders are added to their contact’s timeline.">
        {s?.configured && !s.revoked ? (
          <>
            <div className="fb-set-keyrow">
              <code className="fb-set-code">Key {s.keyPrefix}••••••••••••</code>
              <Button onClick={() => setConfirm("regen")}>Regenerate key</Button>
              <Button variant="danger" onClick={() => setConfirm("revoke")}>Revoke</Button>
            </div>
            <p className="fb-set-muted" style={{ margin: 0 }}>Last received: {s.lastReceivedAt ? when(s.lastReceivedAt) : "nothing yet"}</p>
            {s.lastError ? <div className="fb-set-note" role="status"><span><strong>Last message that could not be processed:</strong> {s.lastError.message}</span></div> : null}
          </>
        ) : (
          <div>
            <p style={{ margin: "0 0 10px" }}>{s?.revoked ? "The key was revoked. Create a new one to receive email again." : "No key yet."}</p>
            <Button variant="primary" onClick={async () => { try { const out = await api.call("postIntegrationsInboundEmailKey", { params: { orgSlug } }); setFresh(out.token); await refresh(); } catch (e) { report.fail(e, "The key was not created"); } }}>Create key</Button>
          </div>
        )}
      </Panel>
      <ConfirmDialog
        open={confirm === "regen"}
        onClose={() => setConfirm(null)}
        title="Regenerate the inbound email key?"
        body="The old forwarding address stops working at once. Update wherever it is used."
        confirmLabel="Regenerate"
        tone="danger"
        onConfirm={async () => { setConfirm(null); try { const out = await api.call("postIntegrationsInboundEmailKey", { params: { orgSlug } }); setFresh(out.token); await refresh(); } catch (e) { report.fail(e, "The key was not regenerated"); } }}
      />
      <ConfirmDialog
        open={confirm === "revoke"}
        onClose={() => setConfirm(null)}
        title="Revoke the inbound email key?"
        body="Forwarded email is refused until a new key is created."
        confirmLabel="Revoke"
        tone="danger"
        onConfirm={async () => { try { await api.call("postIntegrationsInboundEmailKeyRevoke", { params: { orgSlug } }); report.ok("Inbound email key revoked."); setConfirm(null); await refresh(); } catch (e) { report.fail(e, "The key was not revoked"); } }}
      />
      {fresh ? (
        <Dialog open onClose={() => setFresh(null)} title="Your new inbound email key" actions={<Button variant="primary" onClick={() => setFresh(null)}>I have copied it</Button>}>
          <p style={{ marginTop: 0 }}>Copy it now. It is not shown again.</p>
          <div className="fb-set-keyrow">
            <code className="fb-set-code" data-testid="new-inbound-key">{fresh}</code>
            <Button onClick={() => void navigator.clipboard?.writeText(fresh).then(() => report.ok("Copied to clipboard."))}>Copy</Button>
          </div>
        </Dialog>
      ) : null}
    </Gate>
  );
}
