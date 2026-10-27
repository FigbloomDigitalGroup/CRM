"use client";

import { useRef, useState } from "react";
import { describeError } from "../../errors";
import { useApi } from "../../data/hooks";
import { useMember } from "../../data/member";
import { newIdempotencyKey } from "../../data/client";
import { parseCsv, toCsv } from "./csv";
import { downloadText, useReference } from "./data";
import { Icon } from "./icons";
import { ModalShell } from "./overlay";

interface FieldDef {
  key: string;
  label: string;
  /** Extra header names the file might use for this column (the design's own: name, phone, email, source, service, owner). */
  synonyms: string[];
  required?: boolean;
}

const FIELDS: FieldDef[] = [
  { key: "company", label: "Company or person", synonyms: ["name", "company", "companyname", "lead", "leadname"] },
  { key: "contactEmail", label: "Email", synonyms: ["email", "emailaddress", "contactemail"] },
  { key: "contactPhone", label: "Phone", synonyms: ["phone", "phonenumber", "mobile", "contactphone", "tel"] },
  { key: "leadSource", label: "Source", synonyms: ["source", "leadsource"] },
  { key: "serviceInterest", label: "Service", synonyms: ["service", "serviceinterest"] },
  { key: "temperature", label: "Temperature (Hot, Warm, Cold)", synonyms: ["temperature", "temp"] },
  { key: "ownerEmail", label: "Owner (by email)", synonyms: ["owner", "owneremail", "assignedto"] },
  { key: "leadStatus", label: "Status (by name)", synonyms: ["status", "leadstatus"] },
  { key: "notes", label: "Notes", synonyms: ["notes", "note", "message", "comments"] },
];
const CHUNK = 500;
const readText = (file: Blob): Promise<string> =>
  typeof file.text === "function"
    ? file.text()
    : new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result ?? ""));
        r.onerror = () => reject(r.error);
        r.readAsText(file);
      });
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

interface Outcome {
  row: number;
  reason: string;
  outcome: string;
}
interface Totals {
  totalRows: number;
  created: number;
  duplicatesSkipped: number;
  alreadyConverted: number;
  failed: number;
  truncated: boolean;
  errors: Outcome[];
}
const ZERO: Totals = { totalRows: 0, created: 0, duplicatesSkipped: 0, alreadyConverted: 0, failed: 0, truncated: false, errors: [] };

/**
 * Import CSV (L3): choose a file, check how its columns map, watch the progress (the file goes up 500 rows at a time, so 5,000 rows show
 * real progress and can be stopped), then see what came in, what was skipped and why, and download the error report. Duplicates are
 * flagged, never silently merged.
 */
export function ImportWizard({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { orgSlug } = useMember();
  const api = useApi();
  const ref = useReference();
  const [step, setStep] = useState<"pick" | "map" | "running" | "done" | "failed">("pick");
  const [fileName, setFileName] = useState("");
  const [header, setHeader] = useState<string[]>([]);
  const [data, setData] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [strategy, setStrategy] = useState<"skip" | "create">("skip");
  const [dragOver, setDragOver] = useState(false);
  const [done, setDone] = useState(0);
  const [totals, setTotals] = useState<Totals>(ZERO);
  const [problem, setProblem] = useState<string | null>(null);
  const cancel = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  async function load(file: File | null | undefined) {
    if (!file) return;
    setProblem(null);
    try {
      if (file.size > 25 * 1024 * 1024) throw new Error("That file is over 25 MB.");
      const rows = parseCsv(await readText(file));
      const [h, ...rest] = rows;
      if (!h || h.length < 2 || h.every((c) => !c.trim()) || rest.length === 0) throw new Error("empty");
      const guess: Record<string, string> = {};
      for (const f of FIELDS) {
        const hit = h.find((col) => [f.key, f.label, ...f.synonyms].some((s) => norm(s) === norm(col)));
        if (hit) guess[f.key] = hit;
      }
      setFileName(file.name);
      setHeader(h);
      setData(rest);
      setMapping(guess);
      setStep("map");
    } catch {
      setStep("failed");
    }
  }

  const canStart = Boolean(mapping.company || mapping.contactEmail || mapping.contactPhone);
  const defaultStatus = ref.statusByKey("NEW")?.name ?? ref.statuses[0]?.name ?? "New";

  async function start() {
    cancel.current = false;
    setStep("running");
    setDone(0);
    let acc: Totals = { ...ZERO, errors: [] };
    setTotals(acc);
    const useDefaultStatus = !mapping.leadStatus;
    const head = useDefaultStatus ? [...header, "__status"] : header;
    const map: Record<string, string> = { ...mapping };
    if (useDefaultStatus) map.leadStatus = "__status";
    try {
      for (let start = 0; start < data.length; start += CHUNK) {
        if (cancel.current) break;
        const part = data.slice(start, start + CHUNK).map((r) => (useDefaultStatus ? [...r, defaultStatus] : r));
        const form = new FormData();
        form.append("file", new Blob([toCsv([head, ...part])], { type: "text/csv" }), fileName || "leads.csv");
        form.append("mapping", JSON.stringify(map));
        form.append("duplicateStrategy", strategy);
        const r = await api.call("postLeadsImport", { params: { orgSlug }, body: form, idempotencyKey: newIdempotencyKey() });
        acc = {
          totalRows: acc.totalRows + r.totalRows,
          created: acc.created + r.created,
          duplicatesSkipped: acc.duplicatesSkipped + r.duplicatesSkipped,
          alreadyConverted: acc.alreadyConverted + (r.alreadyConverted ?? 0),
          failed: acc.failed + r.failed,
          truncated: acc.truncated || r.truncated,
          errors: [...acc.errors, ...r.errors.map((e) => ({ ...e, row: e.row + start }))],
        };
        setTotals(acc);
        setDone(Math.min(data.length, start + part.length));
      }
      setStep("done");
      onDone();
    } catch (err) {
      setProblem(describeError(err).body);
      if (acc.totalRows > 0) {
        setStep("done");
        onDone();
      } else setStep("failed");
    }
  }

  function downloadReport() {
    downloadText("lead-import-errors.csv", toCsv([["row", "what happened", "reason"], ...totals.errors.map((e) => [String(e.row), e.outcome.replace("_", " "), e.reason])]));
  }

  const pct = data.length ? Math.round((done / data.length) * 100) : 0;
  const needLook = totals.duplicatesSkipped + totals.alreadyConverted + totals.failed;
  const title = step === "map" ? "Check the columns" : "Import leads from CSV";

  return (
    <ModalShell
      title={title}
      intro={step === "map" ? `${data.length} rows in ${fileName}. Tell us which column is which.` : "Duplicates are flagged, never silently merged."}
      onClose={onClose}
      dismissible={step !== "running"}
      label="Import leads"
      footer={
        step === "map" ? (
          <>
            <button type="button" className="fb-ld-btn fb-ld-btn--lg" onClick={() => setStep("pick")}>
              Back
            </button>
            <button type="button" className="fb-ld-btn fb-ld-btn--lg fb-ld-btn--primary" disabled={!canStart} onClick={start}>
              Import {data.length} rows
            </button>
          </>
        ) : step === "running" ? (
          <button type="button" className="fb-ld-btn fb-ld-btn--lg" onClick={() => (cancel.current = true)}>
            Stop after this batch
          </button>
        ) : step === "done" ? (
          <>
            {totals.errors.length ? (
              <button type="button" className="fb-ld-btn fb-ld-btn--lg" onClick={downloadReport}>
                <Icon name="download" size={15} />
                Download error report
              </button>
            ) : null}
            <button type="button" className="fb-ld-btn fb-ld-btn--lg fb-ld-btn--primary" onClick={onClose}>
              Done
            </button>
          </>
        ) : step === "failed" ? (
          <>
            <button type="button" className="fb-ld-btn fb-ld-btn--lg" onClick={onClose}>
              Close
            </button>
            <button type="button" className="fb-ld-btn fb-ld-btn--lg fb-ld-btn--primary" onClick={() => setStep("pick")}>
              Choose another file
            </button>
          </>
        ) : undefined
      }
    >
      {step === "pick" ? (
        <div
          className="fb-ld-drop"
          data-over={dragOver}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void load(e.dataTransfer.files?.[0]);
          }}
        >
          <div className="fb-ld-drop__icon">
            <Icon name="upload" size={26} />
          </div>
          <div className="fb-ld-drop__title">Drop a .csv file here</div>
          <div className="fb-ld-drop__sub">Columns: name, phone, email, source, service, owner</div>
          <div className="fb-ld-drop__row">
            <button type="button" className="fb-ld-btn fb-ld-btn--md fb-ld-btn--primary" onClick={() => input.current?.click()}>
              Choose a file
            </button>
            <button
              type="button"
              className="fb-ld-btn fb-ld-btn--md"
              onClick={() => downloadText("leads-template.csv", toCsv([["name", "phone", "email", "source", "service", "owner"], ["Example Co", "+254700000000", "hello@example.co", "Website", "CCTV", ""]]))}
            >
              Download a template
            </button>
          </div>
          <input ref={input} type="file" accept=".csv,text/csv" hidden aria-label="CSV file" onChange={(e) => void load(e.target.files?.[0])} />
        </div>
      ) : null}

      {step === "map" ? (
        <>
          {FIELDS.map((f) => (
            <div className="fb-ld-maprow" key={f.key}>
              <label htmlFor={`fb-ld-map-${f.key}`}>{f.label}</label>
              <select id={`fb-ld-map-${f.key}`} className="fb-ld-select" value={mapping[f.key] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}>
                <option value="">{f.key === "leadStatus" ? `Not in the file (use ${defaultStatus})` : "Not in the file"}</option>
                {header.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <div className="fb-ld-preview" aria-label="Preview of the first rows">
            <table>
              <thead>
                <tr>
                  {header.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.slice(0, 4).map((r, i) => (
                  <tr key={i}>
                    {header.map((_, c) => (
                      <td key={c}>{r[c]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="fb-ld-field">
            <span>If a lead already exists</span>
            <select className="fb-ld-select" value={strategy} onChange={(e) => setStrategy(e.target.value as "skip" | "create")}>
              <option value="skip">Skip it and list it in the report</option>
              <option value="create">Create it anyway</option>
            </select>
          </label>
          {!canStart ? <div className="fb-ld-error">Choose at least the company, an email or a phone column.</div> : null}
        </>
      ) : null}

      {step === "running" ? (
        <div role="status">
          <div style={{ fontWeight: 600 }}>Importing {fileName}…</div>
          <div className="fb-ld-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Import progress">
            <div style={{ width: `${pct}%` }} />
          </div>
          <div style={{ fontSize: 13, color: "var(--text-3)", marginTop: 8 }}>
            {done} of {data.length} rows checked · {totals.created} imported
          </div>
        </div>
      ) : null}

      {step === "done" ? (
        <>
          <div className="fb-ld-callout" role="status">
            <Icon name="check-circle" size={20} />
            <div>
              <strong>
                {totals.created} of {totals.totalRows} rows imported.
              </strong>
              <small>{needLook ? `${needLook} row${needLook === 1 ? "" : "s"} need a look before they can come in.` : "Everything came in."}</small>
            </div>
          </div>
          {problem ? (
            <div role="alert" className="fb-ld-callout fb-ld-callout--bad">
              <Icon name="alert" size={20} />
              <div>
                <strong>The import stopped early.</strong>
                <small>{problem}</small>
              </div>
            </div>
          ) : null}
          {totals.truncated ? <div className="fb-ld-error">The file was longer than the import limit, so the rest was not read.</div> : null}
          <div className="fb-ld-stats">
            <div>
              <strong>{totals.created}</strong>
              <span>imported</span>
            </div>
            <div>
              <strong>{totals.duplicatesSkipped}</strong>
              <span>duplicates</span>
            </div>
            <div>
              <strong>{totals.alreadyConverted}</strong>
              <span>already converted</span>
            </div>
            <div>
              <strong>{totals.failed}</strong>
              <span>not imported</span>
            </div>
          </div>
          {totals.errors.length ? (
            <div className="fb-ld-errlist" role="list" aria-label="Rows that need a look">
              {totals.errors.slice(0, 50).map((e, i) => (
                <div key={i} role="listitem">
                  <code>Row {e.row}</code>
                  <span style={e.outcome === "failed" ? { color: "var(--red)" } : undefined}>{e.reason}</span>
                </div>
              ))}
              {totals.errors.length > 50 ? (
                <div>
                  <span>…and {totals.errors.length - 50} more in the error report.</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      {step === "failed" ? (
        <div role="alert" className="fb-ld-callout fb-ld-callout--bad">
          <Icon name="alert" size={20} />
          <div>
            <strong>We couldn’t read that file.</strong>
            <small>{problem ?? "It doesn’t look like a CSV with a header row. Nothing was imported."}</small>
          </div>
        </div>
      ) : null}
    </ModalShell>
  );
}
