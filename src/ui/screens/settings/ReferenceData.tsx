"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Button, ConfirmDialog, Dialog, Input, Select } from "../..";
import { describeError } from "../../errors";
import { newIdempotencyKey } from "../../data/client";
import { useApi, useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { Gate, Panel, asArray, useReport } from "./kit";

/** One value of a reference list (src/services/referenceAdminService.ts `ReferenceValueView`; the contract types it loosely). */
export interface RefValue {
  id: string;
  kind: string;
  name: string;
  key: string | null;
  hidden: boolean;
  order: number | null;
  usageCount: number;
  protected: boolean;
  entityType: string | null;
  fieldType: string | null;
  capabilities: { rename: true; reorder: boolean; hide: boolean; delete: boolean; merge: boolean };
}
interface KindInfo {
  kind: string;
  label: string;
  capabilities: { create: boolean; reorder: boolean; hide: boolean; delete: boolean; merge: boolean };
  note: string | null;
}

export const REF_TABS: [string, string][] = [
  ["leadSources", "Lead sources"],
  ["leadStatuses", "Lead statuses"],
  ["pipelineStages", "Pipeline stages"],
  ["lostReasons", "Lost reasons"],
  ["services", "Services"],
  ["customerLifecycleStates", "Customer lifecycle"],
];

/**
 * Reference data (S1, FIG-1106): the lists people pick from. A value in use is hidden, not deleted, so history stays readable: a hidden value leaves the
 * pickers and stays on the records that carry it (B4.06). Pipeline stages are fixed in V1 (rename only); the values the system itself relies on can be
 * renamed but never hidden, deleted or merged away, and the card says so.
 */
export function ReferenceData() {
  const [kind, setKind] = useState(REF_TABS[0]![0]);
  return (
    <Panel title="Reference data" description="The lists people pick from. Items in use can be hidden but not deleted, so history stays readable.">
      <div className="fb-set-seg" role="group" aria-label="Reference lists">
        {REF_TABS.map(([k, label]) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{label}</button>
        ))}
      </div>
      <ReferenceList key={kind} kind={kind} />
    </Panel>
  );
}

/** One generic list manager over `/reference-admin/{kind}`: add, rename, reorder, hide, delete when unused, merge. */
export function ReferenceList({ kind, noun = "item", decorate, extraEdit, addLabel }: { kind: string; noun?: string; decorate?: (v: RefValue) => ReactNode; extraEdit?: (v: RefValue, done: () => void) => ReactNode; addLabel?: string }) {
  const { orgSlug } = useMember();
  const api = useApi();
  const qc = useQueryClient();
  const report = useReport();
  const kinds = useApiQuery("listReferenceKinds", { params: { orgSlug } });
  const q = useApiQuery("listReferenceValues", { params: { orgSlug, kind } });
  const info = asArray<KindInfo>((kinds.data as unknown as { items?: unknown[] } | undefined)?.items).find((k) => k.kind === kind);
  const values = asArray<RefValue>((q.data as unknown as { items?: unknown[] } | undefined)?.items);
  const [name, setName] = useState("");
  const [edit, setEdit] = useState<RefValue | null>(null);
  const [rename, setRename] = useState("");
  const [del, setDel] = useState<RefValue | null>(null);
  const [merge, setMerge] = useState<RefValue | null>(null);
  const [into, setInto] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["listReferenceValues", { orgSlug, kind }, null] }), qc.invalidateQueries({ queryKey: ["getReferenceData", { orgSlug }, null] }), qc.invalidateQueries({ queryKey: ["getTags"] })]);
  const p = (v: RefValue) => ({ orgSlug, kind, valueId: v.id });

  async function act(work: () => Promise<unknown>, done: string, what: string) {
    try {
      await work();
      report.ok(done);
    } catch (e) {
      report.fail(e, what);
    } finally {
      await refresh();
    }
  }

  return (
    <Gate q={q} area="This list">
      {info?.note ? <div className="fb-set-note">{info.note}</div> : null}
      <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        {values.length === 0 ? <div className="fb-set-row" style={{ borderTop: 0 }}><span className="fb-set-muted">Nothing here yet.</span></div> : null}
        {values.map((v, i) => (
          <div key={v.id} className={`fb-set-row ${v.hidden ? "fb-set-row--hidden" : ""}`} style={i === 0 ? { borderTop: 0 } : undefined}>
            <div className="fb-set-row__main">
              <span style={{ fontWeight: 600 }}>{decorate ? decorate(v) : v.name}</span>
              {v.hidden ? <span className="fb-set-pill" style={{ marginLeft: 8 }}>Hidden</span> : null}
              {v.protected && kind !== "pipelineStages" ? <span className="fb-set-pill fb-set-pill--plan" style={{ marginLeft: 8 }}>Used by the system</span> : null}
              {v.fieldType ? <span className="fb-set-muted" style={{ marginLeft: 8 }}>{v.fieldType}</span> : null}
            </div>
            <span className="fb-set-muted">{v.usageCount === 0 ? "Not in use" : `In use: ${v.usageCount}`}</span>
            {v.capabilities.reorder ? (
              <>
                <Button size="sm" variant="ghost" aria-label={`Move ${v.name} up`} disabledReason={i === 0 ? "Already first." : undefined} onClick={() => void act(() => api.call("reorderReferenceValue", { params: p(v), body: { direction: "up" } }), `${v.name} moved up.`, "It did not move")}>↑</Button>
                <Button size="sm" variant="ghost" aria-label={`Move ${v.name} down`} disabledReason={i === values.length - 1 ? "Already last." : undefined} onClick={() => void act(() => api.call("reorderReferenceValue", { params: p(v), body: { direction: "down" } }), `${v.name} moved down.`, "It did not move")}>↓</Button>
              </>
            ) : null}
            <Button size="sm" aria-label={`Edit ${v.name}`} onClick={() => { setRename(v.name); setEdit(v); }}>Edit</Button>
            <Button
              size="sm"
              aria-label={`${v.hidden ? "Show" : "Hide"} ${v.name}`}
              disabledReason={v.capabilities.hide ? undefined : v.protected ? "The system relies on this value, so it cannot be hidden." : "This list cannot be hidden."}
              onClick={() => void act(() => api.call("updateReferenceValue", { params: p(v), body: { hidden: !v.hidden } }), v.hidden ? `${v.name} is back in the pickers.` : `${v.name} hidden. It stays on the records that carry it.`, "That did not change")}
            >
              {v.hidden ? "Show" : "Hide"}
            </Button>
            {v.capabilities.merge ? <Button size="sm" variant="ghost" aria-label={`Merge ${v.name}`} onClick={() => { setInto(""); setMerge(v); }}>Merge</Button> : null}
            {v.capabilities.delete ? (
              <Button size="sm" variant="ghost" aria-label={`Delete ${v.name}`} disabledReason={v.usageCount > 0 ? `In use (${v.usageCount}). Hide it instead.` : undefined} onClick={() => setDel(v)}>Delete</Button>
            ) : null}
          </div>
        ))}
      </div>
      {info?.capabilities.create !== false ? (
        <form
          className="fb-set-inline"
          style={{ maxWidth: 420 }}
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            setAddError(null);
            try {
              await api.call("createReferenceValue", { params: { orgSlug, kind }, body: { name: name.trim() }, idempotencyKey: newIdempotencyKey() });
              report.ok(`Added ${name.trim()}.`);
              setName("");
              await refresh();
            } catch (err) {
              setAddError(describeError(err).body);
            }
          }}
        >
          <Input label={addLabel ?? `Add ${noun}`} value={name} onChange={(e) => setName(e.target.value)} error={addError} />
          <Button type="submit" variant="primary" disabledReason={name.trim() ? undefined : `Type a name for the ${noun}.`}>Add</Button>
        </form>
      ) : null}

      {edit ? (
        <Dialog open onClose={() => setEdit(null)} title={`Edit ${edit.name}`} actions={<><Button onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" disabledReason={rename.trim() ? undefined : "A name is required."} onClick={() => { const v = edit; setEdit(null); void act(() => api.call("updateReferenceValue", { params: p(v), body: { name: rename.trim() } }), `Renamed to ${rename.trim()}.`, "The name did not save"); }}>Save</Button></>}>
          <Input label="Name" value={rename} onChange={(e) => setRename(e.target.value)} />
          {extraEdit ? extraEdit(edit, () => { setEdit(null); void refresh(); }) : null}
        </Dialog>
      ) : null}
      <ConfirmDialog
        open={del !== null}
        onClose={() => setDel(null)}
        title={`Delete ${del?.name ?? "this value"}?`}
        body="It is not used anywhere, so deleting it loses nothing. This cannot be undone."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={async () => {
          const v = del!;
          setDel(null);
          await act(() => api.call("deleteReferenceValue", { params: p(v) }), `${v.name} deleted.`, "It was not deleted");
        }}
      />
      {merge ? (
        <Dialog open onClose={() => setMerge(null)} title={`Merge ${merge.name}`} actions={<><Button onClick={() => setMerge(null)}>Cancel</Button><Button variant="primary" disabledReason={into ? undefined : "Choose what to merge it into."} onClick={() => { const v = merge; setMerge(null); void act(() => api.call("mergeReferenceValues", { params: p(v), body: { intoId: into } }), `${v.name} merged. Everything that used it now uses the other value.`, "It was not merged"); }}>Merge</Button></>}>
          <p style={{ marginTop: 0 }}>Everything that uses “{merge.name}” will use the value you choose, and “{merge.name}” is removed.</p>
          <Select label="Merge into" value={into} onChange={(e) => setInto(e.target.value)} placeholder="Choose a value" options={values.filter((x) => x.id !== merge.id && !x.hidden).map((x) => ({ value: x.id, label: x.name }))} />
        </Dialog>
      ) : null}
    </Gate>
  );
}
