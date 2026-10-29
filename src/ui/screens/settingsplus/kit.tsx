"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Button, ConfirmDialog, FormErrorSummary, ReleaseTag, useToast } from "@/ui";
import { Panel } from "../settings/kit";

/**
 * The frame every V1.1 and V2 settings editor sits in (FIG-1174, FIG-1194): a draft the person edits freely, the problems that stop a save, the
 * plain-language impact of the change, and a confirmation that repeats the impact before anything is saved. A saved change is audited (the list
 * under each editor); the demo keeps that list in memory. Nothing saves while there is a problem, and the Save button says why.
 */

interface AuditEntry {
  id: number;
  area: string;
  what: string;
  detail: string;
  by: string;
  at: string;
}

let entries: AuditEntry[] = [];
const listeners = new Set<() => void>();

export function recordAudit(area: string, what: string, detail: string, by: string) {
  entries = [{ id: entries.length + 1, area, what, detail, by, at: new Date().toISOString() }, ...entries];
  listeners.forEach((l) => l());
}

export function resetAudit() {
  entries = [];
  listeners.forEach((l) => l());
}

export function useAudit(area: string): AuditEntry[] {
  const all = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => entries,
    () => entries,
  );
  return all.filter((e) => e.area === area);
}

export function AuditTrail({ area }: { area: string }) {
  const rows = useAudit(area);
  if (rows.length === 0) return null;
  return (
    <section className="fb-sp-audit" aria-label={`${area} changes`}>
      <h3 className="fb-sp-audit__title">Recent changes</h3>
      <ul>
        {rows.map((e) => (
          <li key={e.id}>
            <strong>{e.what}</strong> · {e.detail} <span className="fb-set-muted">· {e.by} · {new Date(e.at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function EditorFrame({
  area,
  title,
  description,
  release,
  dirty,
  errors,
  impact,
  onSave,
  onDiscard,
  actions,
  confirmTitle,
  disabledReason,
  children,
}: {
  area: string;
  title: string;
  description: string;
  release: "v1.1" | "v2";
  dirty: boolean;
  errors: string[];
  impact: string[];
  onSave: () => void;
  onDiscard: () => void;
  actions?: ReactNode;
  confirmTitle?: string;
  /** Why the whole editor is read-only for this person (shown instead of Save). */
  disabledReason?: string;
  children: ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);
  const toast = useToast();
  const blocked = disabledReason ?? (errors.length ? "Fix the problems above first" : !dirty ? "Nothing has changed" : undefined);
  return (
    <>
      
      <Panel
        title={
          <span style={{ display: "inline-flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            {title} <ReleaseTag release={release} />
          </span>
        }
        description={description}
        actions={actions}
      >
        {children}
        {errors.length ? <FormErrorSummary errors={errors.map((message, i) => ({ path: `e${i}`, message }))} title="Fix these before saving" /> : null}
        {dirty && !errors.length && impact.length ? (
          <div className="fb-sp-impact" role="status">
            <strong>What this will change</strong>
            <ul>{impact.map((i) => <li key={i}>{i}</li>)}</ul>
          </div>
        ) : null}
        <div className="fb-set-panel__actions">
          <Button variant="primary" disabledReason={blocked} onClick={() => setConfirming(true)}>Save changes</Button>
          <Button variant="ghost" disabled={!dirty} onClick={onDiscard}>Discard</Button>
        </div>
      </Panel>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={confirmTitle ?? `Save changes to ${title.toLowerCase()}?`}
        body={
          <>
            <p>The change is recorded in the audit log with your name.</p>
            <ul>{(impact.length ? impact : ["No visible effect."]).map((i) => <li key={i}>{i}</li>)}</ul>
          </>
        }
        confirmLabel="Save"
        onConfirm={() => {
          onSave();
          setConfirming(false);
          toast.show({ message: `${title} saved`, tone: "success" });
        }}
      />
      <AuditTrail area={area} />
    </>
  );
}
