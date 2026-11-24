"use client";

import { useState } from "react";
import { Badge, Banner, Button, ConfirmDialog, Input, Select, useMember } from "@/ui";
import { Panel } from "../settings/kit";
import { DEPARTMENTS, PEOPLE, type DemoDepartment } from "./demo/data";

/**
 * Organisation structure (UC-C2, FIG-1787), on DEMO data: departments, heads, member seats, one person in several departments, archive. A department is
 * structure and responsibility, not access (docs/UNIVERSAL_CRM_ARCHITECTURE.md 5). The departments tables and API (UC-C1) do not exist yet, so nothing
 * is saved. Management only (`configuration.manage` for now; `departments.manage` arrives with UC-C1).
 */
export function OrgStructure() {
  const { can } = useMember();
  const mayEdit = can("configuration.manage");
  const [rows, setRows] = useState<DemoDepartment[]>(DEPARTMENTS);
  const [name, setName] = useState("");
  const [archiving, setArchiving] = useState<DemoDepartment | null>(null);
  const patch = (id: string, p: Partial<DemoDepartment>) => setRows((cur) => cur.map((d) => (d.id === id ? { ...d, ...p } : d)));
  const trimmed = name.trim();
  const nameError = trimmed && rows.some((d) => !d.archived && d.name.toLowerCase() === trimmed.toLowerCase()) ? "A department with that name exists." : null;
  const seats = (person: string) => rows.filter((d) => !d.archived && d.members.includes(person)).map((d) => d.name);

  return (
    <Panel
      title={<span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>Organisation structure <Badge tone="purple">Preview only</Badge></span>}
      description="Your departments, who leads them and who sits in them. A department says who is responsible for what; it gives no access on its own."
    >
      <Banner tone="info" title="Preview only">Changes here are not saved yet. Departments are switched on in a later release.</Banner>
      <div className="fb-rl-form fb-rl-row">
        <Input label="New department" value={name} error={nameError ?? undefined} disabled={!mayEdit} onChange={(e) => setName(e.target.value)} placeholder="For example Operations" />
        <Button
          variant="primary"
          disabledReason={!mayEdit ? "Only Management changes the structure" : !trimmed ? "Type a name first" : (nameError ?? undefined)}
          onClick={() => {
            setRows([...rows, { id: `d-${rows.length + 1}-${trimmed.toLowerCase()}`, name: trimmed, head: null, members: [], archived: false }]);
            setName("");
          }}
        >
          Add department
        </Button>
      </div>
      <div className="fb-rl-depts">
        {rows.filter((d) => !d.archived).map((d) => (
          <section key={d.id} className="fb-rl-dept" aria-label={d.name}>
            <header className="fb-rl-dept__head">
              <h3 className="fb-set-panel__title">{d.name}</h3>
              <Button variant="ghost" disabledReason={!mayEdit ? "Only Management changes the structure" : undefined} onClick={() => setArchiving(d)}>Archive</Button>
            </header>
            <Select
              label="Head"
              value={d.head ?? ""}
              disabled={!mayEdit}
              onChange={(e) => patch(d.id, { head: e.target.value || null })}
              options={[{ value: "", label: "No head yet" }, ...d.members.map((m) => ({ value: m, label: m }))]}
            />
            <ul className="fb-rl-seats">
              {d.members.map((m) => (
                <li key={m}>
                  <span>{m}{d.head === m ? " (head)" : ""}</span>
                  {seats(m).length > 1 ? <span className="fb-set-muted"> also in {seats(m).filter((s) => s !== d.name).join(", ")}</span> : null}
                  <Button variant="ghost" disabled={!mayEdit} onClick={() => patch(d.id, { members: d.members.filter((x) => x !== m), head: d.head === m ? null : d.head })}>Remove</Button>
                </li>
              ))}
              {d.members.length === 0 ? <li className="fb-set-muted">Nobody yet.</li> : null}
            </ul>
            <Select
              label="Add a person"
              value=""
              disabled={!mayEdit}
              onChange={(e) => e.target.value && patch(d.id, { members: [...d.members, e.target.value] })}
              options={PEOPLE.filter((p) => !d.members.includes(p)).map((p) => ({ value: p, label: p }))}
              placeholder="Choose a person…"
            />
          </section>
        ))}
      </div>
      <ConfirmDialog
        open={archiving !== null}
        onClose={() => setArchiving(null)}
        title={`Archive ${archiving?.name ?? "department"}?`}
        body="Its people stay in the organisation and keep their roles. Past records keep the department name."
        confirmLabel="Archive"
        onConfirm={() => {
          if (archiving) patch(archiving.id, { archived: true });
          setArchiving(null);
        }}
      />
    </Panel>
  );
}
