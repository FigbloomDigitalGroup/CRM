"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Input, Select } from "../..";
import { useApiMutation, useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { Gate, Panel, Switch, asArray, rel, useReport, useWhen } from "./kit";

interface Param {
  key: string;
  label: string;
  unit: "days" | "hours" | "choice";
  min?: number;
  max?: number;
  default: number | string;
  options?: string[];
  readOnly?: boolean;
  note?: string;
  value: number | string;
}
interface Rule {
  key: string;
  name: string;
  description: string;
  trigger: string;
  effect: string;
  actions: string[];
  enabled: boolean;
  params: Param[];
  audience: string | null;
  audiences: string[];
  origin: string;
  recent: { applied: number; skipped: number; failed: number; lastRunAt: string | null };
}
interface Run {
  id: string;
  at: string;
  rule: { key: string; name: string };
  record: { type: string; id: string | null };
  status: "APPLIED" | "SKIPPED" | "FAILED";
  result: unknown;
}

const AUDIENCE: Record<string, string> = { OWNER: "The owner", OWNER_AND_MANAGEMENT: "The owner, then Management" };
const STATUS_TONE: Record<string, string> = { APPLIED: "ok", SKIPPED: "", FAILED: "bad" };

/**
 * Automations (S5, FIG-1108): the rules that assign, remind and draft, each on or off with the numbers it can be tuned by, and the run log beneath. The
 * boundary is stated where people read it and enforced by the API and a test: a rule never moves a deal stage, sets a discount, approves anything or
 * messages a customer without a person deciding. Every change is audited by the API.
 */
export function Automations() {
  const { orgSlug } = useMember();
  const q = useApiQuery("listAutomationRules", { params: { orgSlug } });
  const rules = asArray<Rule>((q.data as unknown as { items?: unknown[] } | undefined)?.items);
  const boundary = (q.data as unknown as { boundary?: string } | undefined)?.boundary;
  return (
    <>
      <Panel flush title="Automations" description={boundary ?? "Automations assign, remind and draft. They never move a deal between stages, mark anything won or lost, or message a customer without a person deciding."}>
        <Gate q={q} area="Automations">
          {rules.map((r) => <RuleRow key={r.key} rule={r} />)}
        </Gate>
      </Panel>
      <RunLog rules={rules} />
    </>
  );
}

function RuleRow({ rule }: { rule: Rule }) {
  const { orgSlug } = useMember();
  const report = useReport();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(rule.params.map((p) => [p.key, String(p.value)])));
  const [audience, setAudience] = useState(rule.audience ?? "");
  const save = useApiMutation("updateAutomationRule", {
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["listAutomationRules", { orgSlug }, null] });
      void qc.invalidateQueries({ queryKey: ["listAutomationRuns"] });
    },
    onError: (e) => report.fail(e, `${rule.name} did not change`),
  });
  const tunable = rule.params.some((p) => !p.readOnly) || rule.audiences.length > 1;
  return (
    <div className={`fb-set-row ${rule.enabled ? "" : "fb-set-row--hidden"}`} style={{ alignItems: "flex-start" }}>
      <div className="fb-set-row__main">
        <div className="fb-set-row__name">{rule.name}</div>
        <div className="fb-set-row__desc">{rule.description}</div>
        <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span className="fb-set-pill">{rule.trigger}</span>
          <span className="fb-set-muted">Last 7 days: {rule.recent.applied} done, {rule.recent.skipped} skipped{rule.recent.failed ? `, ${rule.recent.failed} failed` : ""}{rule.recent.lastRunAt ? ` · last ${rel(rule.recent.lastRunAt)}` : ""}</span>
          {tunable ? <button type="button" className="fb-btn fb-btn--link" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide settings" : "Settings"}</button> : null}
        </div>
        {open ? (
          <form
            className="fb-set-inline"
            style={{ marginTop: 10 }}
            onSubmit={(e) => {
              e.preventDefault();
              const params = Object.fromEntries(rule.params.filter((p) => !p.readOnly).map((p) => [p.key, p.unit === "choice" ? values[p.key]! : Number(values[p.key])]));
              save.mutate({ params: { orgSlug, ruleKey: rule.key }, body: { params, ...(audience ? { audience: audience as "OWNER" | "OWNER_AND_MANAGEMENT" } : {}) } }, { onSuccess: () => report.ok(`${rule.name} saved.`) } as never);
            }}
          >
            {rule.params.map((p) =>
              p.unit === "choice" ? (
                <Select key={p.key} label={p.label} value={values[p.key]!} disabled={p.readOnly} onChange={(e) => setValues({ ...values, [p.key]: e.target.value })} options={(p.options ?? []).map((o) => ({ value: o, label: o }))} />
              ) : (
                <Input key={p.key} label={`${p.label} (${p.unit})`} type="number" min={p.min} max={p.max} value={values[p.key]} readOnly={p.readOnly} help={p.readOnly ? p.note : undefined} onChange={(e) => setValues({ ...values, [p.key]: e.target.value })} />
              ),
            )}
            {rule.audiences.length > 1 ? <Select label="Who is told" value={audience} onChange={(e) => setAudience(e.target.value)} options={rule.audiences.map((a) => ({ value: a, label: AUDIENCE[a] ?? a }))} /> : null}
            <Button type="submit" variant="primary" loading={save.isPending}>Save</Button>
          </form>
        ) : null}
      </div>
      <Switch
        label={`${rule.name}`}
        checked={rule.enabled}
        onChange={(enabled) => save.mutate({ params: { orgSlug, ruleKey: rule.key }, body: { enabled } }, { onSuccess: () => report.ok(`${rule.name} ${enabled ? "turned on" : "paused"}.`) } as never)}
      />
    </div>
  );
}

const PAGE = 15;

function RunLog({ rules }: { rules: Rule[] }) {
  const { orgSlug } = useMember();
  const when = useWhen();
  const [ruleKey, setRuleKey] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const q = useApiQuery("listAutomationRuns", { params: { orgSlug }, query: { ...(ruleKey ? { ruleKey } : {}), ...(status ? { status } : {}), page: String(page), pageSize: String(PAGE) } }, { placeholderData: (prev) => prev });
  const data = q.data as unknown as { items: Run[]; total: number; pageCount: number } | undefined;
  const items = asArray<Run>(data?.items);
  return (
    <Panel flush title="Run log" description="What each rule did, newest first. A skipped run says why; nothing here changes a record by itself.">
      <div className="fb-set-filters">
        <Select label="Rule" value={ruleKey} onChange={(e) => { setRuleKey(e.target.value); setPage(1); }} placeholder="Every rule" options={rules.map((r) => ({ value: r.key, label: r.name }))} />
        <Select label="Outcome" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} placeholder="Any outcome" options={[{ value: "APPLIED", label: "Done" }, { value: "SKIPPED", label: "Skipped" }, { value: "FAILED", label: "Failed" }]} />
      </div>
      <Gate q={q} area="The run log" lines={3}>
        {items.length === 0 ? <div className="fb-set-row"><span className="fb-set-muted">No runs yet.</span></div> : (
          <div className="fb-set-tablewrap">
            <table className="fb-set-table">
              <thead><tr><th scope="col">When</th><th scope="col">Rule</th><th scope="col">Record</th><th scope="col">Outcome</th><th scope="col">Result</th></tr></thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: "nowrap", color: "var(--text-2)" }}>{when(r.at)}</td>
                    <td style={{ fontWeight: 600 }}>{r.rule.name}</td>
                    <td>{r.record.type}</td>
                    <td><span className={`fb-set-pill ${STATUS_TONE[r.status] ? `fb-set-pill--${STATUS_TONE[r.status]}` : ""}`}>{r.status === "APPLIED" ? "Done" : r.status === "SKIPPED" ? "Skipped" : "Failed"}</span></td>
                    <td style={{ color: "var(--text-2)" }}>{typeof r.result === "string" ? r.result : r.result ? JSON.stringify(r.result) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="fb-set-pager">
          <span>{data ? `${data.total} ${data.total === 1 ? "run" : "runs"}` : ""}</span>
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
