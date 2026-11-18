"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Banner, Button, Checkbox, ConfirmDialog, Input, Select } from "../..";
import { describeError } from "../../errors";
import { getCsvText, newIdempotencyKey } from "../../data/client";
import { useApi, useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { Gate, Panel, asArray, rel, useReport, useWhen } from "./kit";

/* What the API says about a session (src/services/migrationService.ts `present`; the contract types the parts below loosely) ---------- */

interface Field {
  key: string;
  label: string;
  type: string;
  required: boolean;
  options: string[] | null;
  valueMapping: string | null;
  help: string | null;
}
interface EntityDef {
  entity: string;
  fields: Field[];
  sourceKinds: string[];
  maxRows: number;
}
interface Counts {
  total: number;
  valid: number;
  warnings: number;
  errors: number;
  duplicates: number;
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
}
interface DryRun {
  wouldCreate: number;
  wouldUpdate: number;
  wouldSkip: number;
  duplicates: number;
  errors: number;
  warnings: number;
  newCompanies: number;
  newContacts: number;
  newTags: number;
  truncated: boolean;
  sample: { create: Record<string, string>[]; update: { id: string; changes: string[] }[]; duplicate: { row: number; reason: string }[] };
}
export interface Session {
  id: string;
  entity: string;
  sourceKind: string;
  status: string;
  step: string;
  running: boolean;
  steps: { key: string; state: "done" | "current" | "todo" }[];
  file: { name: string; headers: string[]; rows: number } | null;
  mapping: Record<string, string> | null;
  valueMappings: Record<string, Record<string, string>> | null;
  duplicatePolicy: string;
  options: { createMissingCompanies: boolean };
  counts: Counts;
  progress: number;
  validation: { unmappedValues: { field: string; value: string; count: number }[]; truncated: boolean } | null;
  dryRun: DryRun | null;
  rollback: { canRollback: boolean; deadline: string | null; rolledBackAt: string | null; result: { removed?: number; kept?: number; restored?: number; reasons?: string[] } | null };
  warnings: { code: string; message: string }[];
  failureMessage: string | null;
  createdAt: string;
}
interface Issue {
  id?: string;
  row: number;
  phase: string;
  severity: string;
  field?: string | null;
  message: string;
}

const LABEL: Record<string, string> = { SOURCE: "Source", UPLOAD: "Upload", MAP: "Map fields", VALIDATE: "Validate", DRY_RUN: "Dry run", IMPORT: "Import", REVIEW: "Report" };
const ENTITY_LABEL: Record<string, string> = { COMPANY: "Companies", CONTACT: "Contacts", LEAD: "Leads", DEAL: "Deals", TASK: "Tasks", ACTIVITY: "Activities" };
const POLICY: Record<string, string> = { SKIP: "Skip duplicates", UPDATE: "Update the existing record", CREATE: "Create them anyway" };
const STATUS_TEXT: Record<string, string> = { COMPLETED: "Finished", COMPLETED_WITH_ERRORS: "Finished with errors", ROLLED_BACK: "Rolled back", CANCELLED: "Cancelled", IMPORTING: "Importing", FAILED: "Failed" };
const FINISHED = ["COMPLETED", "COMPLETED_WITH_ERRORS", "ROLLED_BACK", "CANCELLED", "FAILED"];

function saveText(name: string, text: string, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Data migration (S7, FIG-1110): the seven-step wizard that brings records in from a spreadsheet: source, upload, field mapping, validation, dry run,
 * import and report. Nothing is written until the dry run has been read and the import is confirmed; good rows are kept when others fail; the report lists
 * the problem rows beside their original values; and within its window an import can be rolled back without touching what people did afterwards. Deals
 * come in through the same wizard (FIG-800).
 */
export function Migration() {
  const { orgSlug } = useMember();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessions = useApiQuery("listMigrationSessions", { params: { orgSlug }, query: { pageSize: "10" } });
  const rows = asArray<Session>((sessions.data as unknown as { items?: unknown[] } | undefined)?.items);
  if (sessionId) return <Wizard sessionId={sessionId} onExit={() => setSessionId(null)} />;
  return (
    <>
      <Panel
        title="Bring in your existing data"
        description="A guided move of leads, customers, contacts, deals, tasks and activities from a spreadsheet. Nothing goes live until the dry run has been checked, and a finished import can be rolled back within its window."
        actions={<NewMigration onStart={setSessionId} />}
      />
      <Panel flush title="Earlier migrations">
        <Gate q={sessions} area="Earlier migrations" lines={2}>
          {rows.length === 0 ? <div className="fb-set-row"><span className="fb-set-muted">No migrations yet.</span></div> : null}
          {rows.map((s) => (
            <div key={s.id} className="fb-set-row">
              <div className="fb-set-row__main">
                <div className="fb-set-row__name">{ENTITY_LABEL[s.entity] ?? s.entity}{s.file ? ` · ${s.file.name}` : ""}</div>
                <div className="fb-set-row__meta">{STATUS_TEXT[s.status] ?? "In progress"} · started {rel(s.createdAt)}{FINISHED.includes(s.status) ? ` · ${s.counts.created} added, ${s.counts.updated} updated, ${s.counts.failed + s.counts.errors} problems` : ""}</div>
              </div>
              <Button size="sm" onClick={() => setSessionId(s.id)}>{FINISHED.includes(s.status) ? "Open report" : "Continue"}</Button>
            </div>
          ))}
        </Gate>
      </Panel>
    </>
  );
}

/* Step 1: source ---------------------------------------------------------------------------------------------------------------- */

function NewMigration({ onStart }: { onStart: (id: string) => void }) {
  const { orgSlug } = useMember();
  const api = useApi();
  const report = useReport();
  const [open, setOpen] = useState(false);
  const entities = useApiQuery("listMigrationEntities", { params: { orgSlug } }, { enabled: open });
  const defs = asArray<EntityDef>((entities.data as unknown as { items?: unknown[] } | undefined)?.items);
  const [form, setForm] = useState<{ entity: string; sourceKind: string; duplicatePolicy: string; createMissingCompanies: boolean | null }>({ entity: "LEAD", sourceKind: "TEMPLATE", duplicatePolicy: "SKIP", createMissingCompanies: null });
  // Every kind that names a company can create the ones that do not exist yet; the API starts it on for deals only.
  const namesCompany = form.entity !== "COMPANY";
  const createMissing = form.createMissingCompanies ?? form.entity === "DEAL";
  const [busy, setBusy] = useState(false);
  const policies = asArray<string>((entities.data as unknown as { duplicatePolicies?: unknown[] } | undefined)?.duplicatePolicies);

  async function create() {
    setBusy(true);
    try {
      const s = await api.call("createMigrationSession", { params: { orgSlug }, body: { entity: form.entity, sourceKind: form.sourceKind as "TEMPLATE", duplicatePolicy: form.duplicatePolicy as "SKIP", ...(namesCompany ? { createMissingCompanies: createMissing } : {}) }, idempotencyKey: newIdempotencyKey() });
      onStart(s.id);
    } catch (e) {
      report.fail(e, "The migration did not start");
    } finally {
      setBusy(false);
    }
  }
  if (!open) return <Button variant="primary" onClick={() => setOpen(true)}>Start a migration</Button>;
  return (
    <div className="fb-set-panel" style={{ minWidth: 300, padding: 16 }} role="group" aria-label="Choose what to bring in">
      <Select label="What are you bringing in?" value={form.entity} onChange={(e) => setForm({ ...form, entity: e.target.value })} options={(defs.length ? defs.map((d) => d.entity) : Object.keys(ENTITY_LABEL)).map((e) => ({ value: e, label: ENTITY_LABEL[e] ?? e }))} />
      <Select label="Where does the file come from?" value={form.sourceKind} onChange={(e) => setForm({ ...form, sourceKind: e.target.value })} options={[{ value: "TEMPLATE", label: "Our template (columns map themselves)" }, { value: "GENERIC", label: "Another spreadsheet (map the columns)" }]} />
      <Select label="When a record already exists" value={form.duplicatePolicy} onChange={(e) => setForm({ ...form, duplicatePolicy: e.target.value })} options={(policies.length ? policies : Object.keys(POLICY)).map((p) => ({ value: p, label: POLICY[p] ?? p }))} />
      {namesCompany ? <Checkbox label="Create companies that do not exist yet" checked={createMissing} onChange={(e) => setForm({ ...form, createMissingCompanies: e.target.checked })} /> : null}
      <div style={{ display: "flex", gap: 8 }}>
        <Button onClick={() => setOpen(false)}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={() => void create()}>Continue</Button>
      </div>
    </div>
  );
}

/* The wizard -------------------------------------------------------------------------------------------------------------------- */

function Wizard({ sessionId, onExit }: { sessionId: string; onExit: () => void }) {
  const { orgSlug } = useMember();
  const q = useApiQuery("getMigrationSession", { params: { orgSlug, sessionId } }, { refetchInterval: (query) => ((query.state.data as unknown as Session | undefined)?.running ? 1500 : false) });
  const s = q.data as unknown as Session | undefined;
  return (
    <Gate q={q} area="This migration">
      {s ? <WizardBody session={s} onExit={onExit} /> : null}
    </Gate>
  );
}

function WizardBody({ session: s, onExit }: { session: Session; onExit: () => void }) {
  const { orgSlug } = useMember();
  const api = useApi();
  const qc = useQueryClient();
  const report = useReport();
  const [view, setView] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["getMigrationSession", { orgSlug, sessionId: s.id }, null] });
  const current = view ?? s.step;
  const finished = FINISHED.includes(s.status);
  const p = { orgSlug, sessionId: s.id };
  const idx = s.steps.findIndex((x) => x.key === current);

  async function run<T>(work: () => Promise<T>, what: string): Promise<T | undefined> {
    setBusy(true);
    try {
      const out = await work();
      setView(null);
      await refresh();
      return out;
    } catch (e) {
      report.fail(e, what);
      await refresh();
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Panel
        title={`${ENTITY_LABEL[s.entity] ?? s.entity} migration`}
        description={finished ? `${STATUS_TEXT[s.status] ?? s.status}.` : "Work through the steps in order. You can leave and come back: your place is kept."}
        actions={<Button onClick={onExit}>Back to migrations</Button>}
      >
        <ol className="fb-set-steps" aria-label="Migration steps">
          {s.steps.map((st, i) => (
            <li key={st.key} className="fb-set-step" data-state={st.key === current && st.state !== "done" ? "current" : st.state} aria-current={st.key === current ? "step" : undefined}>
              <span className="fb-set-step__n" aria-hidden="true">{st.state === "done" ? "✓" : i + 1}</span>
              {LABEL[st.key] ?? st.key}
            </li>
          ))}
        </ol>
        {s.warnings.map((w) => <Banner key={w.code} tone="warning">{w.message}</Banner>)}
        {s.failureMessage ? <Banner tone="danger">{s.failureMessage}</Banner> : null}
      </Panel>

      {current === "SOURCE" || current === "UPLOAD" ? <UploadStep session={s} busy={busy} run={run} /> : null}
      {current === "MAP" ? <MapStep session={s} busy={busy} run={run} /> : null}
      {current === "VALIDATE" ? <ValidateStep session={s} busy={busy} run={run} /> : null}
      {current === "DRY_RUN" ? <DryRunStep session={s} busy={busy} run={run} /> : null}
      {current === "IMPORT" ? <ImportStep session={s} busy={busy} run={run} /> : null}
      {current === "REVIEW" ? <ReviewStep session={s} busy={busy} run={run} onExit={onExit} /> : null}

      {idx > 0 && !finished && !s.running && current !== "REVIEW" ? (
        <div><Button variant="ghost" onClick={() => setView(s.steps[idx - 1]!.key)}>← Back to {LABEL[s.steps[idx - 1]!.key]}</Button></div>
      ) : null}
      {!finished && current !== "REVIEW" ? (
        <div>
          <Button variant="ghost" onClick={() => void run(() => api.call("cancelMigration", { params: p }), "The migration was not cancelled")}>Cancel this migration</Button>
        </div>
      ) : null}
    </>
  );
}

type RunFn = <T>(work: () => Promise<T>, what: string) => Promise<T | undefined>;
interface StepProps {
  session: Session;
  busy: boolean;
  run: RunFn;
}

/* Step 2: upload ---------------------------------------------------------------------------------------------------------------- */

function UploadStep({ session: s, busy, run }: StepProps) {
  const { orgSlug } = useMember();
  const api = useApi();
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  async function pick(file: File | undefined) {
    if (!file) return;
    setProblem(null);
    if (!/\.(csv|xlsx)$/i.test(file.name)) return setProblem("Choose a .csv or .xlsx file.");
    if (file.size > 20 * 1024 * 1024) return setProblem("That file is larger than 20 MB. Split it and import in parts.");
    const body = new FormData();
    body.set("file", file);
    await run(async () => {
      try {
        return await api.call("uploadMigrationFile", { params: { orgSlug, sessionId: s.id }, body: body as never });
      } catch (e) {
        setProblem(describeError(e).fieldErrors[0]?.message ?? describeError(e).body);
        throw e;
      }
    }, "The file was not accepted");
    if (input.current) input.current.value = "";
  }
  async function template() {
    try {
      saveText(`${s.entity.toLowerCase()}-template.csv`, await getCsvText(`/api/orgs/${orgSlug}/data-migration/templates/${s.entity}`));
    } catch {
      setProblem("The template could not be downloaded.");
    }
  }
  return (
    <Panel title="Upload your file" description="A CSV, or the first sheet of an Excel file. The first row names the columns. Up to 50,000 rows and 20 MB.">
      <div className="fb-set-drop">
        <p style={{ margin: "0 0 10px" }}>{s.file ? `${s.file.name} · ${s.file.rows} rows · ${s.file.headers.length} columns` : "No file yet."}</p>
        <input ref={input} type="file" hidden accept=".csv,.xlsx" aria-label="Migration file" onChange={(e) => void pick(e.target.files?.[0])} />
        <Button variant="primary" loading={busy} onClick={() => input.current?.click()}>{s.file ? "Replace file" : "Choose a file"}</Button>{" "}
        <Button onClick={() => void template()}>Download the template</Button>
      </div>
      {problem ? <span className="fb-error" role="alert">{problem}</span> : null}
    </Panel>
  );
}

/* Step 3: map ------------------------------------------------------------------------------------------------------------------- */

function MapStep({ session: s, busy, run }: StepProps) {
  const { orgSlug } = useMember();
  const api = useApi();
  const entities = useApiQuery("listMigrationEntities", { params: { orgSlug } });
  const def = asArray<EntityDef>((entities.data as unknown as { items?: unknown[] } | undefined)?.items).find((d) => d.entity === s.entity);
  const [mapping, setMapping] = useState<Record<string, string>>(s.mapping ?? {});
  const [preset, setPreset] = useState("");
  const [policy, setPolicy] = useState(s.duplicatePolicy);
  const headers = s.file?.headers ?? [];
  const missing = (def?.fields ?? []).filter((f) => f.required && !mapping[f.key]);
  return (
    <Gate q={entities} area="The field list">
      <Panel flush title="Map your columns" description="Match each CRM field to a column in your file. Required fields are marked; a column left unmapped is ignored.">
        <div className="fb-set-tablewrap">
          <table className="fb-set-table">
            <thead><tr><th scope="col">CRM field</th><th scope="col">Column in your file</th><th scope="col">Notes</th></tr></thead>
            <tbody>
              {(def?.fields ?? []).map((f) => (
                <tr key={f.key}>
                  <td style={{ fontWeight: 600 }}>{f.label}{f.required ? <span className="fb-req" aria-hidden="true"> *</span> : null}{f.required ? <span className="fb-sr-only"> (required)</span> : null}</td>
                  <td>
                    <select className="fb-input" aria-label={`Column for ${f.label}`} value={mapping[f.key] ?? ""} onChange={(e) => setMapping((m) => { const n = { ...m }; if (e.target.value) n[f.key] = e.target.value; else delete n[f.key]; return n; })} style={{ minHeight: 34, height: 34, fontSize: 13 }}>
                      <option value="">— not mapped —</option>
                      {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </td>
                  <td className="fb-set-muted">{f.help ?? (f.options ? `One of: ${f.options.join(", ")}` : "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "14px 22px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ maxWidth: 360 }}>
            <Select label="When a record already exists" value={policy} onChange={(e) => setPolicy(e.target.value)} options={Object.entries(POLICY).map(([v, l]) => ({ value: v, label: l }))} />
          </div>
          <Input label="Save this mapping for next time as" value={preset} onChange={(e) => setPreset(e.target.value)} placeholder="Sales tracker 2026" style={{ maxWidth: 360 }} />
          {missing.length ? <Banner tone="warning">Map the required fields first: {missing.map((f) => f.label).join(", ")}.</Banner> : null}
          <div>
            <Button variant="primary" loading={busy} disabledReason={missing.length ? "Map every required field first." : undefined} onClick={() => void run(() => api.call("setMigrationMapping", { params: { orgSlug, sessionId: s.id }, body: { mapping, duplicatePolicy: policy as "SKIP", ...(preset.trim() ? { savePresetAs: preset.trim() } : {}) } }), "The mapping was not saved")}>Save mapping and continue</Button>
          </div>
        </div>
      </Panel>
    </Gate>
  );
}

/* Counts and issues ------------------------------------------------------------------------------------------------------------- */

function CountGrid({ items }: { items: [string, number | string][] }) {
  return (
    <div className="fb-set-counts">
      {items.map(([label, n]) => <div key={label} className="fb-set-count"><b>{n}</b><span>{label}</span></div>)}
    </div>
  );
}

function Issues({ sessionId, phase }: { sessionId: string; phase?: string }) {
  const { orgSlug } = useMember();
  const report = useReport();
  const q = useApiQuery("listMigrationIssues", { params: { orgSlug, sessionId }, query: { ...(phase ? { phase } : {}), pageSize: "15" } });
  const items = asArray<Issue>((q.data as unknown as { items?: unknown[] } | undefined)?.items);
  const total = (q.data as unknown as { total?: number } | undefined)?.total ?? 0;
  if (q.isLoading || total === 0) return null;
  return (
    <Panel flush title={`Rows to fix (${total})`} description="The first rows with a problem. The error report has all of them beside their original values."
      actions={<Button size="sm" onClick={async () => { try { saveText("migration-errors.csv", await getCsvText(`/api/orgs/${orgSlug}/data-migration/sessions/${sessionId}/errors`, { phase })); } catch (e) { report.fail(e, "The report was not downloaded"); } }}>Download error report</Button>}>
      <div className="fb-set-tablewrap">
        <table className="fb-set-table">
          <thead><tr><th scope="col">Row</th><th scope="col">Severity</th><th scope="col">Field</th><th scope="col">Problem</th></tr></thead>
          <tbody>{items.map((i, k) => <tr key={k}><td>{i.row}</td><td><span className={`fb-set-pill ${i.severity === "ERROR" ? "fb-set-pill--bad" : "fb-set-pill--warn"}`}>{i.severity === "ERROR" ? "Error" : "Warning"}</span></td><td>{i.field ?? ""}</td><td>{i.message}</td></tr>)}</tbody>
        </table>
      </div>
    </Panel>
  );
}

/* Step 4: validate -------------------------------------------------------------------------------------------------------------- */

function ValidateStep({ session: s, busy, run }: StepProps) {
  const { orgSlug } = useMember();
  const api = useApi();
  const entities = useApiQuery("listMigrationEntities", { params: { orgSlug } });
  const def = asArray<EntityDef>((entities.data as unknown as { items?: unknown[] } | undefined)?.items).find((d) => d.entity === s.entity);
  const done = s.validation !== null && ["VALIDATED", "DRY_RUN_DONE"].includes(s.status);
  const unmapped = s.validation?.unmappedValues ?? [];
  const [values, setValues] = useState<Record<string, Record<string, string>>>(s.valueMappings ?? {});
  const setValue = (field: string, from: string, to: string) => setValues((v) => ({ ...v, [field]: { ...(v[field] ?? {}), [from]: to } }));
  return (
    <>
      <Panel title="Check the file" description="Every row is read: required fields, owners that exist, stages and statuses that are valid. Nothing is changed.">
        {s.running ? (
          <div role="status"><div className="fb-set-progress"><span style={{ width: `${s.progress}%` }} /></div><p className="fb-set-muted">Reading rows… {s.progress}%</p></div>
        ) : done ? (
          <CountGrid items={[["Rows", s.counts.total], ["Ready", s.counts.valid], ["Warnings", s.counts.warnings], ["Errors", s.counts.errors]]} />
        ) : null}
        <div>
          <Button variant={done ? "secondary" : "primary"} loading={busy || s.running} onClick={() => void run(() => api.call("validateMigration", { params: { orgSlug, sessionId: s.id } }), "The check did not run")}>{done ? "Check again" : "Check the file"}</Button>
        </div>
      </Panel>
      {done && unmapped.length ? (
        <Panel flush title="Values the CRM does not know" description="These values appear in your file but not in the CRM. Choose what each one means, then check again; rows with an unknown value are errors, never guessed.">
          <div className="fb-set-tablewrap">
            <table className="fb-set-table">
              <thead><tr><th scope="col">Field</th><th scope="col">In your file</th><th scope="col">Rows</th><th scope="col">Treat as</th></tr></thead>
              <tbody>
                {unmapped.slice(0, 20).map((u) => {
                  const opts = def?.fields.find((f) => f.key === u.field)?.options ?? null;
                  return (
                    <tr key={`${u.field}:${u.value}`}>
                      <td>{def?.fields.find((f) => f.key === u.field)?.label ?? u.field}</td><td>{u.value}</td><td>{u.count}</td>
                      <td>{opts ? (
                        <select className="fb-input" aria-label={`Treat ${u.value} as`} value={values[u.field]?.[u.value] ?? ""} onChange={(e) => setValue(u.field, u.value, e.target.value)} style={{ minHeight: 34, height: 34, fontSize: 13 }}><option value="">Leave as an error</option>{opts.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                      ) : (
                        <input className="fb-input" aria-label={`Treat ${u.value} as`} value={values[u.field]?.[u.value] ?? ""} onChange={(e) => setValue(u.field, u.value, e.target.value)} placeholder="CRM value" style={{ minHeight: 34, height: 34, fontSize: 13 }} />
                      )}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ padding: "12px 22px" }}><Button disabled={busy} onClick={() => void run(async () => { await api.call("setMigrationMapping", { params: { orgSlug, sessionId: s.id }, body: { valueMappings: Object.fromEntries(Object.entries(values).map(([k, m]) => [k, Object.fromEntries(Object.entries(m).filter(([, v]) => v))])) } }); return api.call("validateMigration", { params: { orgSlug, sessionId: s.id } }); }, "The values were not applied")}>Apply and check again</Button></div>
        </Panel>
      ) : null}
      {done ? <Issues sessionId={s.id} phase="VALIDATE" /> : null}
      {done ? (
        <div>
          <Button variant="primary" disabledReason={s.counts.valid + s.counts.warnings === 0 ? "No row can be imported yet. Fix the file and upload it again." : undefined} loading={busy} onClick={() => void run(() => api.call("dryRunMigration", { params: { orgSlug, sessionId: s.id } }), "The dry run did not start")}>Continue to the dry run</Button>
        </div>
      ) : null}
    </>
  );
}

/* Step 5: dry run --------------------------------------------------------------------------------------------------------------- */

function DryRunStep({ session: s, busy, run }: StepProps) {
  const { orgSlug } = useMember();
  const api = useApi();
  const d = s.dryRun;
  const ready = d !== null && !s.running && s.status === "DRY_RUN_DONE";
  return (
    <>
      <Panel title="Dry run" description="Exactly what the import would do, decided the way the real import decides it. Nothing is written.">
        {s.running ? <div role="status"><div className="fb-set-progress"><span style={{ width: `${s.progress}%` }} /></div><p className="fb-set-muted">Working it out… {s.progress}%</p></div> : null}
        {ready && d ? (
          <>
            <CountGrid items={[["Would add", d.wouldCreate], ["Would update", d.wouldUpdate], ["Would skip", d.wouldSkip], ["Duplicates", d.duplicates], ["Errors", d.errors], ...(d.newCompanies ? ([["New companies", d.newCompanies]] as [string, number][]) : []), ...(d.newContacts ? ([["New contacts", d.newContacts]] as [string, number][]) : []), ...(d.newTags ? ([["New tags", d.newTags]] as [string, number][]) : [])]} />
            {d.sample.create.length ? (
              <div className="fb-set-tablewrap">
                <table className="fb-set-table" aria-label="Sample of records that would be added">
                  <thead><tr>{Object.keys(d.sample.create[0]!).map((k) => <th key={k} scope="col">{k}</th>)}</tr></thead>
                  <tbody>{d.sample.create.slice(0, 5).map((r, i) => <tr key={i}>{Object.values(r).map((v, k) => <td key={k}>{v}</td>)}</tr>)}</tbody>
                </table>
              </div>
            ) : null}
            {d.sample.duplicate.length ? <ul className="fb-set-muted" style={{ margin: 0 }}>{d.sample.duplicate.slice(0, 5).map((x) => <li key={x.row}>Row {x.row}: {x.reason}</li>)}</ul> : null}
            {d.truncated ? <Banner tone="warning">The file is longer than the sample limit; the counts cover every row, the sample only the first.</Banner> : null}
          </>
        ) : null}
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant={ready ? "secondary" : "primary"} loading={busy || s.running} onClick={() => void run(() => api.call("dryRunMigration", { params: { orgSlug, sessionId: s.id } }), "The dry run did not start")}>{ready ? "Run again" : "Run the dry run"}</Button>
        </div>
      </Panel>
      {ready ? <Issues sessionId={s.id} phase="DRY_RUN" /> : null}
      {ready ? <ImportStep session={s} busy={busy} run={run} /> : null}
    </>
  );
}

/* Step 6: import ---------------------------------------------------------------------------------------------------------------- */

function ImportStep({ session: s, busy, run }: StepProps) {
  const { orgSlug } = useMember();
  const api = useApi();
  const [sure, setSure] = useState(false);
  const d = s.dryRun;
  return (
    <Panel title="Import" description="This writes the records. Good rows are kept even if others fail, and nothing an import adds starts a handoff, moves a customer or sends a message.">
      {d ? <p style={{ margin: 0 }}>The dry run said: <strong>{d.wouldCreate}</strong> added, <strong>{d.wouldUpdate}</strong> updated, <strong>{d.wouldSkip}</strong> skipped, <strong>{d.errors}</strong> with errors.</p> : null}
      {s.running ? (
        <div role="status" aria-live="polite"><div className="fb-set-progress"><span style={{ width: `${s.progress}%` }} /></div><p className="fb-set-muted">Importing… {s.counts.processed} of {s.counts.total} rows ({s.progress}%)</p></div>
      ) : (
        <>
          <Checkbox label="I have read the dry run and want to import these records." checked={sure} onChange={(e) => setSure(e.target.checked)} />
          <div><Button variant="primary" loading={busy} disabledReason={sure ? undefined : "Tick the box to confirm you have checked the dry run."} onClick={() => void run(() => api.call("startMigrationImport", { params: { orgSlug, sessionId: s.id }, body: { confirm: true } }), "The import did not start")}>Import now</Button></div>
        </>
      )}
    </Panel>
  );
}

/* Step 7: report ---------------------------------------------------------------------------------------------------------------- */

function ReviewStep({ session: s, run, onExit }: StepProps & { onExit: () => void }) {
  const { orgSlug } = useMember();
  const api = useApi();
  const when = useWhen();
  const [confirm, setConfirm] = useState(false);
  const rb = s.rollback;
  return (
    <>
      <Panel title={s.status === "ROLLED_BACK" ? "Rolled back" : s.running ? "Working…" : "Import report"} description={rb.deadline && rb.canRollback ? `You can roll this import back until ${when(rb.deadline)}.` : undefined}>
        {s.running ? <div role="status"><div className="fb-set-progress"><span style={{ width: `${s.progress}%` }} /></div></div> : <CountGrid items={[["Added", s.counts.created], ["Updated", s.counts.updated], ["Skipped", s.counts.skipped], ["Failed", s.counts.failed + s.counts.errors]]} />}
        {s.status === "COMPLETED_WITH_ERRORS" ? <Banner tone="warning">Some rows were not imported. Download the error report, fix those rows and import them as a new migration.</Banner> : null}
        {rb.rolledBackAt ? <Banner tone="info">Rolled back {when(rb.rolledBackAt)}{rb.result ? `: ${rb.result.removed ?? 0} removed, ${rb.result.restored ?? 0} restored, ${rb.result.kept ?? 0} kept because they changed since.` : "."}</Banner> : null}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button onClick={async () => { try { saveText("migration-errors.csv", await getCsvText(`/api/orgs/${orgSlug}/data-migration/sessions/${s.id}/errors`)); } catch { /* the report is empty when nothing failed */ } }}>Download error report</Button>
          <Button variant="danger" disabledReason={rb.canRollback ? undefined : rb.rolledBackAt ? "This import was already rolled back." : "The rollback window has ended, or nothing was added."} onClick={() => setConfirm(true)}>Roll back this import</Button>
          <Button onClick={onExit}>Done</Button>
        </div>
      </Panel>
      <Issues sessionId={s.id} />
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Roll back this import?"
        tone="danger"
        confirmLabel="Roll back"
        body="Records this import added are removed and fields it changed are put back. Anything people edited afterwards, or that other records now depend on, is kept and listed."
        onConfirm={async () => {
          setConfirm(false);
          await run(() => api.call("rollbackMigration", { params: { orgSlug, sessionId: s.id } }), "The rollback did not run");
        }}
      />
    </>
  );
}
