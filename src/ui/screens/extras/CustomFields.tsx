"use client";

import { useId, useMemo, useState } from "react";
import { useToast } from "../../components/toast";
import { describeError } from "../../errors";
import { useMember } from "../../data/member";
import { useExtras, useRecordRead } from "./hooks";
import { Unavailable } from "./Unavailable";
import type { ExtrasKind } from "./RecordExtras";

interface Definition {
  id: string;
  key: string;
  label: string;
  fieldType: string;
  options: unknown;
  helpText?: unknown;
  required: boolean;
  serviceId?: string | null;
  sortOrder: number;
  isActive: boolean;
}

type Raw = string | string[];

const TYPE_NOTE: Record<string, string> = { TEXT: "Text", NUMBER: "Number", DATE: "Date", SELECT: "Dropdown", MULTISELECT: "Multi-select", BOOLEAN: "Yes or no" };

/** The options of a choice field: the API stores plain strings or `{ label, value }`. */
export function optionsOf(options: unknown): { label: string; value: string }[] {
  if (!Array.isArray(options)) return [];
  return options.map((o) => (typeof o === "string" ? { label: o, value: o } : { label: String((o as { label?: unknown }).label ?? (o as { value?: unknown }).value ?? ""), value: String((o as { value?: unknown }).value ?? (o as { label?: unknown }).label ?? "") }));
}

function toRaw(def: Definition, value: unknown): Raw {
  if (value === null || value === undefined) return def.fieldType === "MULTISELECT" ? [] : "";
  if (def.fieldType === "MULTISELECT") return Array.isArray(value) ? value.map(String) : [String(value)];
  if (def.fieldType === "BOOLEAN") return value === true || value === "true" ? "yes" : value === false || value === "false" ? "no" : "";
  return String(value);
}

function without<T>(map: Record<string, T>, key: string): Record<string, T> {
  const copy = { ...map };
  delete copy[key];
  return copy;
}

function isEmpty(raw: Raw) {
  return Array.isArray(raw) ? raw.length === 0 : raw.trim() === "";
}

/** What the API is sent for a field: typed, and null when cleared. A message instead when the text is not a valid value for the type. */
function toValue(def: Definition, raw: Raw): { ok: true; value: unknown } | { ok: false; message: string } {
  if (isEmpty(raw)) return { ok: true, value: null };
  switch (def.fieldType) {
    case "NUMBER": {
      const n = Number(raw);
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, message: `${def.label} must be a number.` };
    }
    case "BOOLEAN":
      return { ok: true, value: raw === "yes" };
    case "DATE":
      return /^\d{4}-\d{2}-\d{2}$/.test(raw as string) ? { ok: true, value: raw } : { ok: false, message: `${def.label} must be a date.` };
    default:
      return { ok: true, value: raw };
  }
}

/** Custom fields (X1): typed inputs per field type, required and validation shown beside the field, saved as you leave it, with Undo. */
export function CustomFieldsSection({ kind, id, archived }: { kind: ExtrasKind; id: string; archived: boolean }) {
  const { orgSlug } = useMember();
  const { ops, params, call, refresh } = useExtras(kind, id);
  const toast = useToast();
  const uid = useId();
  const defs = useRecordRead<{ items: Definition[] }>("getCustomFields", { orgSlug }, { query: { entityType: ops.entityType, section: "GENERAL" } });
  const rec = useRecordRead<{ customFields?: Record<string, unknown>; serviceId?: string | null }>(ops.record, params);
  const [drafts, setDrafts] = useState<Record<string, Raw>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const fields = useMemo(() => {
    const serviceId = rec.data?.serviceId ?? null;
    return (defs.data?.items ?? [])
      .filter((d) => d.isActive)
      .filter((d) => !d.serviceId || kind === "contact" || kind === "company" || d.serviceId === serviceId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [defs.data, rec.data, kind]);

  const stored = rec.data?.customFields ?? {};
  const shown = (d: Definition): Raw => drafts[d.key] ?? toRaw(d, stored[d.key]);

  async function save(d: Definition, raw: Raw) {
    const before = toRaw(d, stored[d.key]);
    if (JSON.stringify(raw) === JSON.stringify(before)) {
      setDrafts((x) => without(x, d.key));
      return;
    }
    const parsed = toValue(d, raw);
    if (!parsed.ok) return setErrors((e) => ({ ...e, [d.key]: parsed.message }));
    if (d.required && parsed.value === null) return setErrors((e) => ({ ...e, [d.key]: `${d.label} is required.` }));
    setErrors((e) => without(e, d.key));
    setSaving(d.key);
    try {
      await call(ops.patch, { body: { customFields: { [d.key]: parsed.value } } });
      await refresh(ops.record);
      setDrafts((x) => without(x, d.key));
      const prior = toValue(d, before);
      toast.show({
        message: `${d.label} saved.`,
        undo: async () => {
          try {
            await call(ops.patch, { body: { customFields: { [d.key]: prior.ok ? prior.value : null } } });
            await refresh(ops.record);
          } catch (error) {
            toast.show({ tone: "danger", message: `Undoing that did not go through. ${describeError(error).body}` });
          }
        },
      });
    } catch (error) {
      const described = describeError(error);
      const own = described.fieldErrors.find((f) => f.path.includes(d.key));
      setErrors((e) => ({ ...e, [d.key]: own?.message ?? described.body }));
    } finally {
      setSaving(null);
    }
  }

  const readOnly = archived;
  return (
    <section className="fb-xsec" aria-labelledby={`${uid}-cf`}>
      <div className="fb-xsec__head">
        <h2 id={`${uid}-cf`} className="fb-xsec__title">Custom fields</h2>
      </div>
      {defs.isError ? (
        <Unavailable what="Custom fields" error={defs.error} noun={ops.noun} />
      ) : (
        <div className="fb-xfields">
          {fields.map((d) => {
            const raw = shown(d);
            const fid = `${uid}-${d.key}`;
            const err = errors[d.key];
            const note = [TYPE_NOTE[d.fieldType] ?? d.fieldType, d.required ? "required" : null].filter(Boolean).join(" · ");
            const common = { id: fid, className: "fb-xinput", disabled: readOnly || saving === d.key, "aria-invalid": err ? (true as const) : undefined, "aria-describedby": err ? `${fid}-err` : undefined };
            let control;
            if (d.fieldType === "SELECT") {
              control = (
                <select {...common} value={raw as string} onChange={(e) => { setDrafts((x) => ({ ...x, [d.key]: e.target.value })); void save(d, e.target.value); }}>
                  <option value="">Choose…</option>
                  {optionsOf(d.options).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              );
            } else if (d.fieldType === "BOOLEAN") {
              control = (
                <select {...common} value={raw as string} onChange={(e) => { setDrafts((x) => ({ ...x, [d.key]: e.target.value })); void save(d, e.target.value); }}>
                  <option value="">Not set</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              );
            } else if (d.fieldType === "MULTISELECT") {
              const chosen = raw as string[];
              control = (
                <div className="fb-xchecks" role="group" aria-labelledby={`${fid}-l`}>
                  {optionsOf(d.options).map((o) => (
                    <label key={o.value} className="fb-xcheck">
                      <input
                        type="checkbox"
                        disabled={common.disabled}
                        checked={chosen.includes(o.value)}
                        onChange={(e) => {
                          const next = e.target.checked ? [...chosen, o.value] : chosen.filter((v) => v !== o.value);
                          setDrafts((x) => ({ ...x, [d.key]: next }));
                          void save(d, next);
                        }}
                      />
                      {o.label}
                    </label>
                  ))}
                </div>
              );
            } else {
              const type = d.fieldType === "NUMBER" ? "number" : d.fieldType === "DATE" ? "date" : "text";
              control = (
                <input
                  {...common}
                  type={type}
                  value={raw as string}
                  readOnly={readOnly}
                  onChange={(e) => setDrafts((x) => ({ ...x, [d.key]: e.target.value }))}
                  onBlur={(e) => void save(d, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                />
              );
            }
            return (
              <div key={d.id} className="fb-xfield">
                <label id={`${fid}-l`} htmlFor={d.fieldType === "MULTISELECT" ? undefined : fid} className="fb-xfield__label">
                  {d.label}
                  <span className="fb-xfield__note"> · {note}</span>
                </label>
                {control}
                {err ? <span id={`${fid}-err`} className="fb-xerror" role="alert">{err}</span> : null}
              </div>
            );
          })}
          {!defs.isLoading && fields.length === 0 ? (
            <span className="fb-xmuted">No custom fields for this record type. Management adds them in Settings › Custom fields.</span>
          ) : null}
        </div>
      )}
    </section>
  );
}
