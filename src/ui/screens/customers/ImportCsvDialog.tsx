"use client";

import { useRef, useState } from "react";
import { describeError } from "../../errors";
import { useApi } from "../../data/hooks";
import { useMember } from "../../data/member";
import { newIdempotencyKey } from "../../data/client";
import { parseCsv, toCsv } from "../leads/csv";
import { Icon } from "../leads/icons";
import { ModalShell } from "../leads/overlay";

type Kind = "companies" | "contacts";

interface FieldDef {
  key: string;
  label: string;
  required?: boolean;
}

const FIELDS: Record<Kind, FieldDef[]> = {
  companies: [
    { key: "name", label: "Name", required: true },
    { key: "industry", label: "Industry" },
    { key: "website", label: "Website" },
    { key: "location", label: "Location" },
    { key: "phone", label: "Phone" },
    { key: "email", label: "Email" },
    { key: "notes", label: "Notes" },
    { key: "lifecycleState", label: "Lifecycle state (by name)" },
    { key: "ownerEmail", label: "Owner (by email)" },
  ],
  contacts: [
    { key: "firstName", label: "First name", required: true },
    { key: "lastName", label: "Last name" },
    { key: "company", label: "Company (by exact name)" },
    { key: "phone", label: "Phone" },
    { key: "email", label: "Email" },
    { key: "jobTitle", label: "Job title" },
    { key: "department", label: "Department" },
    { key: "notes", label: "Notes" },
    { key: "ownerEmail", label: "Owner (by email)" },
  ],
};

const CHUNK = 500;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const readText = (file: Blob): Promise<string> =>
  typeof file.text === "function"
    ? file.text()
    : new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result ?? ""));
        r.onerror = () => reject(r.error);
        r.readAsText(file);
      });

interface Totals {
  totalRows: number;
  created: number;
  duplicatesSkipped: number;
  failed: number;
  errors: { row: number; reason: string }[];
}

/**
 * Import CSV for companies and contacts (the design's import sheet): choose a file, check how its columns map, watch the progress (the file goes
 * up 500 rows at a time), then see what came in, what was skipped and why. Duplicates are flagged, never silently merged.
 */
export function ImportCsvDialog({ kind, onClose, onDone }: { kind: Kind; onClose: () => void; onDone: () => void }) {
  const { orgSlug } = useMember();
  const api = useApi();
  const fields = FIELDS[kind];
  const [step, setStep] = useState<"pick" | "map" | "running" | "done">("pick");
  const [fileName, setFileName] = useState("");
  const [header, setHeader] = useState<string[]>([]);
  const [data, setData] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [done, setDone] = useState(0);
  const [totals, setTotals] = useState<Totals>({ totalRows: 0, created: 0, duplicatesSkipped: 0, failed: 0, errors: [] });
  const [problem, setProblem] = useState<string | null>(null);
  const cancel = useRef(false);

  async function load(file: File | null | undefined) {
    if (!file) return;
    setProblem(null);
    try {
      if (file.size > 25 * 1024 * 1024) throw new Error("That file is over 25 MB.");
      const [h, ...rest] = parseCsv(await readText(file));
      if (!h || h.length < 2 || rest.length === 0) throw new Error("That file has no rows to import. Check that the first row holds the column names.");
      const guess: Record<string, string> = {};
      for (const f of fields) {
        const hit = h.find((col) => [f.key, f.label].some((s) => norm(s) === norm(col)));
        if (hit) guess[f.key] = hit;
      }
      setFileName(file.name);
      setHeader(h);
      setData(rest);
      setMapping(guess);
      setStep("map");
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "That file could not be read.");
    }
  }

  const canStart = fields.filter((f) => f.required).every((f) => mapping[f.key]);

  async function start() {
    cancel.current = false;
    setStep("running");
    let acc: Totals = { totalRows: 0, created: 0, duplicatesSkipped: 0, failed: 0, errors: [] };
    try {
      for (let at = 0; at < data.length; at += CHUNK) {
        if (cancel.current) break;
        const part = data.slice(at, at + CHUNK);
        const form = new FormData();
        form.append("file", new Blob([toCsv([header, ...part])], { type: "text/csv" }), fileName || `${kind}.csv`);
        form.append("mapping", JSON.stringify(mapping));
        form.append("duplicateStrategy", "skip");
        const r = await api.call(kind === "companies" ? "postCompaniesImport" : "postContactsImport", { params: { orgSlug }, body: form, idempotencyKey: newIdempotencyKey() } as never);
        const x = r as { totalRows: number; created: number; duplicatesSkipped: number; failed: number; errors: { row: number; reason: string }[] };
        acc = {
          totalRows: acc.totalRows + x.totalRows,
          created: acc.created + x.created,
          duplicatesSkipped: acc.duplicatesSkipped + x.duplicatesSkipped,
          failed: acc.failed + x.failed,
          errors: [...acc.errors, ...x.errors.map((e) => ({ row: e.row + at, reason: e.reason }))],
        };
        setTotals(acc);
        setDone(Math.min(data.length, at + part.length));
      }
      setStep("done");
      onDone();
    } catch (e) {
      setProblem(describeError(e).body);
      setTotals(acc);
      setStep("done");
    }
  }

  const pct = data.length ? Math.round((done / data.length) * 100) : 0;

  return (
    <ModalShell
      title={`Import ${kind} from CSV`}
      intro="Duplicates are flagged, never silently merged."
      onClose={() => (step === "running" ? undefined : onClose())}
      dismissible={step !== "running"}
      label={`Import ${kind}`}
      footer={
        step === "pick" ? (
          <button type="button" className="fb-ld-btn fb-ld-btn--lg" onClick={onClose}>
            Cancel
          </button>
        ) : step === "map" ? (
          <>
            <button type="button" className="fb-ld-btn fb-ld-btn--lg" onClick={() => setStep("pick")}>
              Back
            </button>
            <button type="button" className="fb-ld-btn fb-ld-btn--lg fb-ld-btn--primary" disabled={!canStart} onClick={start}>
              Import {data.length} row{data.length === 1 ? "" : "s"}
            </button>
          </>
        ) : step === "running" ? (
          <button type="button" className="fb-ld-btn fb-ld-btn--lg" onClick={() => (cancel.current = true)}>
            Stop
          </button>
        ) : (
          <button type="button" className="fb-ld-btn fb-ld-btn--lg fb-ld-btn--primary" onClick={onClose}>
            Done
          </button>
        )
      }
    >
      {step === "pick" ? (
        <div className="fb-ld-drop">
          <div className="fb-ld-drop__icon">
            <Icon name="upload" size={26} />
          </div>
          <div className="fb-ld-drop__title">Choose a CSV file</div>
          <div className="fb-ld-drop__sub">The first row holds the column names. Up to 25 MB.</div>
          <div className="fb-ld-drop__row">
            <label className="fb-ld-btn fb-ld-btn--primary" style={{ cursor: "pointer" }}>
              Choose file
              <input type="file" accept=".csv,text/csv" className="fb-sr-only" aria-label="CSV file" onChange={(e) => load(e.target.files?.[0])} />
            </label>
          </div>
          {problem ? (
            <p role="alert" className="fb-ld-footnote" style={{ color: "var(--red)", marginTop: 12 }}>
              {problem}
            </p>
          ) : null}
        </div>
      ) : null}
      {step === "map" ? (
        <>
          <p className="fb-ld-footnote">
            {fileName}: {data.length} row{data.length === 1 ? "" : "s"}. Match each field to a column.
          </p>
          {fields.map((f) => (
            <label key={f.key} className="fb-ld-maprow">
              <span>
                {f.label}
                {f.required ? " *" : ""}
              </span>
              <select className="fb-ld-select" value={mapping[f.key] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}>
                <option value="">Do not import</option>
                {header.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </>
      ) : null}
      {step === "running" ? (
        <div role="status">
          <div style={{ fontWeight: 600 }}>
            Importing… {done} of {data.length} rows
          </div>
          <div className="fb-ld-progress" aria-hidden="true">
            <div style={{ width: `${pct}%` }} />
          </div>
        </div>
      ) : null}
      {step === "done" ? (
        <>
          <div className={`fb-ld-callout ${problem ? "fb-ld-callout--bad" : ""}`} role="status">
            <div>
              <strong>
                {totals.created} imported, {totals.duplicatesSkipped} skipped as duplicates, {totals.failed} failed.
              </strong>
              {problem ? <small>{problem}</small> : null}
            </div>
          </div>
          {totals.errors.length ? (
            <div className="fb-ld-errlist" aria-label="Rows that did not import">
              {totals.errors.slice(0, 50).map((e, i) => (
                <div key={i}>
                  <code>Row {e.row}</code>
                  <span>{e.reason}</span>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </ModalShell>
  );
}
