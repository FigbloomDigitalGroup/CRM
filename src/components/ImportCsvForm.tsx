"use client";

import { useState } from "react";
import { parseCsvHeaderLineBrowser } from "./csvHeaderPreview";

export interface ImportField {
  key: string;
  label: string;
  required?: boolean;
}

interface ImportRowError {
  row: number;
  reason: string;
}

interface ImportSummary {
  totalRows: number;
  created: number;
  duplicatesSkipped: number;
  failed: number;
  truncated: boolean;
  errors: ImportRowError[];
}

/** Best-effort, case/punctuation-insensitive match between a CRM field and a CSV header, so the mapping UI starts pre-filled for an unambiguous file. */
function normalize(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function guessMapping(
  fields: ImportField[],
  headers: string[],
): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const field of fields) {
    const match = headers.find((h) => normalize(h) === normalize(field.label) || normalize(h) === normalize(field.key));
    if (match) mapping[field.key] = match;
  }
  return mapping;
}

function downloadErrorReport(errors: ImportRowError[]) {
  const csv = [
    "row,reason",
    ...errors.map((e) => `${e.row},"${e.reason.replace(/"/g, '""')}"`),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "import-errors.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function ImportCsvForm({
  importUrl,
  fields,
}: {
  importUrl: string;
  fields: ImportField[];
}) {
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [duplicateStrategy, setDuplicateStrategy] = useState<"skip" | "create">("skip");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  async function handleFileChange(selected: File | null) {
    setFile(selected);
    setSummary(null);
    setError(null);
    if (!selected) {
      setHeaders([]);
      setMapping({});
      return;
    }
    const detected = await parseCsvHeaderLineBrowser(selected);
    setHeaders(detected);
    setMapping(guessMapping(fields, detected));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("mapping", JSON.stringify(mapping));
      form.set("duplicateStrategy", duplicateStrategy);
      const res = await fetch(importUrl, { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Import failed.");
        return;
      }
      setSummary(body);
    } catch {
      setError("Import failed -- check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const requiredUnmapped = fields.filter((f) => f.required && !mapping[f.key]);

  return (
    <form className="stack" onSubmit={handleSubmit}>
      <label>
        CSV file
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
        />
      </label>

      {headers.length > 0 && (
        <>
          <h3>Column mapping</h3>
          <p className="who">
            Match each CRM field to a column in your file. Leave optional
            fields blank to skip them.
          </p>
          <table>
            <thead>
              <tr>
                <th>CRM field</th>
                <th>CSV column</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.key}>
                  <td>
                    {f.label}
                    {f.required && <span className="error"> *</span>}
                  </td>
                  <td>
                    <select
                      value={mapping[f.key] ?? ""}
                      onChange={(e) =>
                        setMapping((prev) => ({ ...prev, [f.key]: e.target.value }))
                      }
                    >
                      <option value="">-- not mapped --</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <label>
            If a likely duplicate is found
            <select
              value={duplicateStrategy}
              onChange={(e) =>
                setDuplicateStrategy(e.target.value as "skip" | "create")
              }
            >
              <option value="skip">Skip the row</option>
              <option value="create">Create it anyway</option>
            </select>
          </label>

          <button
            type="submit"
            disabled={busy || requiredUnmapped.length > 0}
            title={
              requiredUnmapped.length > 0
                ? `Map required field(s): ${requiredUnmapped.map((f) => f.label).join(", ")}`
                : undefined
            }
          >
            {busy ? "Importing..." : "Import"}
          </button>
        </>
      )}

      {error && <p className="error">{error}</p>}

      {summary && (
        <div className="card">
          <strong>Import complete</strong>
          <p>
            {summary.totalRows} row(s) read &middot; {summary.created} created
            &middot; {summary.duplicatesSkipped} duplicate(s) skipped &middot;{" "}
            {summary.failed} failed
          </p>
          {summary.truncated && (
            <p className="error">
              The file had more rows than this import will process at once;
              only the first {summary.totalRows} were read.
            </p>
          )}
          {summary.errors.length > 0 && (
            <>
              <table>
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.errors.slice(0, 20).map((e, i) => (
                    <tr key={i}>
                      <td>{e.row}</td>
                      <td>{e.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button
                type="button"
                className="secondary"
                onClick={() => downloadErrorReport(summary.errors)}
              >
                Download error report (CSV)
              </button>
            </>
          )}
        </div>
      )}
    </form>
  );
}
