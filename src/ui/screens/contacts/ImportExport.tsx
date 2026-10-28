"use client";

import { useEffect, useRef, useState } from "react";
import { describeError } from "../../errors";
import { useToast } from "../../components/toast";
import { useApi } from "../../data/hooks";
import { useMember } from "../../data/member";
import { newIdempotencyKey } from "../../data/client";
import { parseCsv, toCsv } from "../leads/csv";
import { downloadText } from "../leads/data";
import { Icon } from "../leads/icons";
import { ModalShell } from "../leads/overlay";

/** What a contacts file can carry, and the other names its columns might have. The keys are the import endpoint's own. */
const FIELDS: { key: string; label: string; synonyms: string[]; required?: boolean }[] = [
  { key: "firstName", label: "First name", synonyms: ["first", "firstname", "givenname", "name"], required: true },
  { key: "lastName", label: "Last name", synonyms: ["last", "lastname", "surname", "familyname"] },
  { key: "company", label: "Company (by exact name)", synonyms: ["company", "companyname", "organisation", "organization"] },
  { key: "phone", label: "Phone", synonyms: ["phone", "phonenumber", "mobile", "tel"] },
  { key: "email", label: "Email", synonyms: ["email", "emailaddress"] },
  { key: "jobTitle", label: "Job title", synonyms: ["jobtitle", "title", "role", "position"] },
  { key: "department", label: "Department", synonyms: ["department", "dept"] },
  { key: "notes", label: "Notes", synonyms: ["notes", "note", "comments"] },
  { key: "ownerEmail", label: "Owner (by email)", synonyms: ["owner", "owneremail", "assignedto"] },
];
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

interface Result {
  totalRows: number;
  created: number;
  duplicatesSkipped: number;
  failed: number;
  truncated: boolean;
  errors: { row: number; reason: string; outcome: string }[];
}

/**
 * Import CSV (C3): choose a file, check how its columns map, import, then see what came in, what was skipped and why. Duplicates are skipped
 * (or created on purpose), never silently merged. Management only: the API enforces it and says so.
 */
export function ContactsImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { orgSlug } = useMember();
  const api = useApi();
  const [step, setStep] = useState<"pick" | "map" | "running" | "done" | "failed">("pick");
  const [file, setFile] = useState<File | null>(null);
  const [header, setHeader] = useState<string[]>([]);
  const [rowCount, setRowCount] = useState(0);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [strategy, setStrategy] = useState<"skip" | "create">("skip");
  const [result, setResult] = useState<Result | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function load(f: File | null | undefined) {
    if (!f) return;
    setProblem(null);
    try {
      if (f.size > 25 * 1024 * 1024) throw new Error("That file is over 25 MB.");
      const rows = parseCsv(await readText(f));
      const [h, ...rest] = rows;
      if (!h || h.length < 1 || h.every((c) => !c.trim()) || rest.length === 0) throw new Error("empty");
      const guess: Record<string, string> = {};
      for (const fd of FIELDS) {
        const hit = h.find((col) => [fd.key, fd.label, ...fd.synonyms].some((s) => norm(s) === norm(col)));
        if (hit) guess[fd.key] = hit;
      }
      setFile(f);
      setHeader(h);
      setRowCount(rest.filter((r) => r.some((c) => c.trim())).length);
      setMapping(guess);
      setStep("map");
    } catch {
      setProblem("That file couldn’t be read as a contacts list. Use a .csv file with a header row and at least one contact.");
      setStep("failed");
    }
  }

  async function start() {
    if (!file) return;
    setStep("running");
    try {
      const form = new FormData();
      form.append("file", file, file.name || "contacts.csv");
      form.append("mapping", JSON.stringify(mapping));
      form.append("duplicateStrategy", strategy);
      const r = (await api.call("postContactsImport", { params: { orgSlug }, body: form, idempotencyKey: newIdempotencyKey() } as never)) as Result;
      setResult(r);
      setStep("done");
      onDone();
    } catch (err) {
      setProblem(describeError(err).body);
      setStep("failed");
    }
  }

  const canStart = Boolean(mapping.firstName);
  return (
    <ModalShell
      title="Import contacts from CSV"
      intro="Duplicates are flagged, never silently merged."
      onClose={step === "running" ? () => undefined : onClose}
      dismissible={step !== "running"}
      label="Import contacts"
      footer={
        step === "map" ? (
          <>
            <button type="button" className="fb-ld-btn fb-ld-btn--lg" onClick={() => setStep("pick")}>
              Back
            </button>
            <button type="button" className="fb-ld-btn fb-ld-btn--primary fb-ld-btn--lg" disabled={!canStart} onClick={start}>
              Import {rowCount} contact{rowCount === 1 ? "" : "s"}
            </button>
          </>
        ) : step === "running" ? null : (
          <button type="button" className="fb-ld-btn fb-ld-btn--primary fb-ld-btn--lg" onClick={onClose}>
            {step === "done" ? "Done" : "Close"}
          </button>
        )
      }
    >
      {step === "pick" || step === "failed" ? (
        <div>
          <div className="fb-ct-drop">
            <Icon name="upload" size={26} />
            <div className="fb-ct-drop__title">Choose a .csv file</div>
            <div className="fb-ct-drop__hint">Columns: first name, last name, company, phone, email, job title, department, owner</div>
            <button type="button" className="fb-ld-btn fb-ld-btn--primary fb-ld-btn--md" onClick={() => input.current?.click()}>
              Choose file
            </button>
            <input ref={input} type="file" accept=".csv,text/csv" className="fb-sr-only" aria-label="Contacts CSV file" onChange={(e) => load(e.target.files?.[0])} />
          </div>
          {problem ? (
            <div role="alert" className="fb-ld-error" style={{ marginTop: 12 }}>
              {problem}
            </div>
          ) : null}
        </div>
      ) : null}
      {step === "map" ? (
        <div className="fb-ct-map">
          <div className="fb-ct-map__file">
            <strong>{file?.name}</strong> · {rowCount} row{rowCount === 1 ? "" : "s"}
          </div>
          {FIELDS.map((f) => (
            <label key={f.key} className="fb-ct-map__row">
              <span>
                {f.label}
                {f.required ? <span className="fb-ld-req"> *</span> : null}
              </span>
              <select className="fb-ld-select" aria-label={f.label} value={mapping[f.key] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}>
                <option value="">Not in my file</option>
                {header.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <fieldset className="fb-ct-map__strategy">
            <legend>If a contact already exists</legend>
            <label>
              <input type="radio" name="strategy" checked={strategy === "skip"} onChange={() => setStrategy("skip")} /> Skip it and tell me
            </label>
            <label>
              <input type="radio" name="strategy" checked={strategy === "create"} onChange={() => setStrategy("create")} /> Create it anyway
            </label>
          </fieldset>
        </div>
      ) : null}
      {step === "running" ? (
        <div role="status">
          <div style={{ fontWeight: 600 }}>Importing {file?.name}…</div>
          <div className="fb-ct-progress">
            <div className="fb-ct-progress__bar" />
          </div>
        </div>
      ) : null}
      {step === "done" && result ? (
        <div role="status" className="fb-ct-result">
          <div className="fb-ct-result__tiles">
            <div>
              <strong>{result.created}</strong>
              <span>created</span>
            </div>
            <div>
              <strong>{result.duplicatesSkipped}</strong>
              <span>duplicates skipped</span>
            </div>
            <div>
              <strong>{result.failed}</strong>
              <span>need attention</span>
            </div>
          </div>
          {result.truncated ? <p className="fb-ld-help">The file was longer than one import allows; the first rows were imported.</p> : null}
          {result.errors.length ? (
            <>
              <ul className="fb-ct-result__errors">
                {result.errors.slice(0, 6).map((e, i) => (
                  <li key={i}>
                    Row {e.row}: {e.reason}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="fb-ld-btn fb-ld-btn--sm"
                onClick={() => downloadText("contacts-import-errors.csv", toCsv([["Row", "Outcome", "Reason"], ...result.errors.map((e) => [String(e.row), e.outcome, e.reason])]))}
              >
                <Icon name="download" size={14} />
                Download the error report
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </ModalShell>
  );
}

/** Rows above which the server wants the bulk-export right (Management) instead of a plain download. */
export const CONTACT_EXPORT_BULK_ROWS = 500;

/**
 * Export CSV: downloads what the list is showing (same filters). The API decides who may and how many; a refusal is explained here instead
 * of failing silently.
 */
export function ContactsExportDialog({ total, filters, onClose }: { total: number; filters: Record<string, string>; onClose: () => void }) {
  const { orgSlug } = useMember();
  const api = useApi();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    (async () => {
      try {
        const query = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
        const csv = (await api.call("exportContactDirectory", { params: { orgSlug }, query: query as never })) as string;
        downloadText(`contacts-${new Date().toISOString().slice(0, 10)}.csv`, csv);
        toast.show({ message: "Exporting contacts… the CSV is downloading" });
        onClose();
      } catch (err) {
        setError(describeError(err).body);
        setBusy(false);
      }
    })();
  }, [api, orgSlug, filters, toast, onClose]);

  return (
    <ModalShell
      title={error ? "We couldn’t export" : "Exporting contacts…"}
      intro={total > CONTACT_EXPORT_BULK_ROWS ? `Exports of more than ${CONTACT_EXPORT_BULK_ROWS} contacts need Management’s bulk-export right. This one has ${total}.` : undefined}
      onClose={onClose}
      label="Export contacts"
      footer={
        <button type="button" className="fb-ld-btn fb-ld-btn--primary fb-ld-btn--lg" onClick={onClose}>
          {busy ? "Cancel" : "Close"}
        </button>
      }
    >
      {error ? (
        <div role="alert" className="fb-ld-error">
          {error}
        </div>
      ) : (
        <div role="status">Preparing your file…</div>
      )}
    </ModalShell>
  );
}
