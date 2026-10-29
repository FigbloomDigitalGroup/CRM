"use client";

import { useState } from "react";
import { Select, useMember } from "@/ui";
import { fieldRows as seed, membersPerRole, sampleValues } from "./demo/data";
import { EditorFrame, recordAudit } from "./kit";
import { ROLE_KEYS, ROLE_LABELS, describeChange, diffFields, nextAccess, previewValue, validateFields, type Access, type FieldRow, type RoleKey } from "./model";

/**
 * Roles and field access (S8#2, FIG-1194): who can see and change each sensitive field. Click a cell to cycle Edit, Own, View, Hidden; the
 * effect preview shows what a chosen role would see on a sample record before anything is saved. Management always keeps at least View (nobody would be able
 * to oversee a field otherwise). Platform Super Admins are not members of an organisation and cannot be given any of these permissions.
 * The permissions themselves are still enforced by the API; this screen edits the field-level layer on top.
 */
const TONE: Record<Access, string> = { Edit: "ok", Own: "warn", View: "info", Hidden: "neutral" };

export function RolesEditor() {
  const { userName, can } = useMember();
  const [saved, setSaved] = useState<FieldRow[]>(seed);
  const [rows, setRows] = useState<FieldRow[]>(seed);
  const [previewRole, setPreviewRole] = useState<RoleKey>("sales");
  const [owner, setOwner] = useState(true);
  const mayEdit = can("configuration.manage");
  const changes = diffFields(saved, rows);
  const impact = [
    ...changes.map(describeChange),
    ...(changes.length ? [`Affects ${[...new Set(changes.map((c) => c.role))].reduce((n, r) => n + membersPerRole[r], 0)} people the next time they open a record.`] : []),
  ];
  const cycle = (key: string, role: RoleKey) => setRows(rows.map((r) => (r.key === key ? { ...r, access: { ...r.access, [role]: nextAccess(r.access[role]) } } : r)));

  return (
    <EditorFrame
      area="Roles"
      title="Roles and field access"
      description="Who sees and changes the sensitive fields. Pick a cell to change it, and check the effect before you save."
      release="v2"
      dirty={changes.length > 0}
      errors={validateFields(rows)}
      impact={impact}
      disabledReason={mayEdit ? undefined : "Only Management edits roles"}
      onDiscard={() => setRows(saved)}
      onSave={() => {
        recordAudit("Roles", "Field access changed", changes.map(describeChange).join(" "), userName);
        setSaved(rows);
      }}
    >
      <div className="fb-set-tablewrap">
        <table className="fb-com-table">
          <caption className="fb-sr-only">Field access by role</caption>
          <thead>
            <tr>
              <th scope="col">Field / permission</th>
              {ROLE_KEYS.map((r) => <th key={r} scope="col">{r === "support" ? "SUPPORT*" : r.slice(0, 8).toUpperCase()}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <th scope="row"><div className="fb-com-strong">{row.label}</div><div className="fb-set-muted">{row.key}</div></th>
                {ROLE_KEYS.map((r) => (
                  <td key={r}>
                    <button
                      type="button"
                      className={`fb-com-pill fb-com-pill--${TONE[row.access[r]]} fb-sp-cell`}
                      disabled={!mayEdit}
                      aria-label={`${row.label} for ${ROLE_LABELS[r]}: ${row.access[r]}. Press to change.`}
                      onClick={() => cycle(row.key, r)}
                    >
                      {row.access[r]}
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="fb-sp-preview" aria-label="Effect preview">
        <div className="fb-sp-preview__head">
          <h3 className="fb-set-panel__title">Effect preview</h3>
          <Select label="See it as" value={previewRole} onChange={(e) => setPreviewRole(e.target.value as RoleKey)} options={ROLE_KEYS.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} />
          <label className="fb-sp-toggle"><input type="checkbox" checked={owner} onChange={(e) => setOwner(e.target.checked)} /> On a record they own</label>
        </div>
        <dl className="fb-sp-previewlist">
          {rows.map((row) => {
            const p = previewValue(row.access[previewRole], sampleValues[row.key] ?? "—", owner);
            return (
              <div key={row.key}>
                <dt>{row.label}</dt>
                <dd>{p.text ? <strong>{p.text}</strong> : <em>Hidden</em>} <span className="fb-set-muted">{p.note}</span></dd>
              </div>
            );
          })}
        </dl>
      </section>
      <p className="fb-set-muted">
        Custom roles start from one of the five standard roles. Customer Support is shown as a proposed sixth role. Platform Super Admins are not members of this organisation and can’t be given any of these permissions; Figbloom Support only sees inside through an approved, time-limited request. Every change is recorded in the audit log.
      </p>
    </EditorFrame>
  );
}
