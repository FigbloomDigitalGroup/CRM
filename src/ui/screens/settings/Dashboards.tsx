"use client";

import { useState } from "react";
import { Button, LoadingState, useMember, useToast } from "@/ui";
import { useApiMutation, useApiQuery } from "../../data/hooks";
import { describeError } from "../../errors";
import { QueryFailure } from "../../featureUnavailable";
import { HOME_KINDS, HOME_KIND_LABEL, widgetsFor, type HomeKind, type LayoutEntry } from "../home/catalogue";
import { Panel, Switch } from "./kit";

/**
 * Dashboards (UC-W1, FIG-1802): Management picks which widgets each role's home shows and in what order, on `GET/PUT /dashboard-layouts`.
 * It can only hide or reorder; people only ever see widgets their own permissions allow (the server enforces that, not this screen).
 */
export function DashboardsEditor() {
  const [kind, setKind] = useState<HomeKind>("sales");
  return (
    <Panel
      title="Dashboards"
      description="Choose which widgets appear on each role’s home page, and in what order. People only ever see the widgets their permissions allow: hiding one here removes it for that role, but nothing here can show a figure a role may not see."
    >
      <label className="fb-dashed__pick">
        <span>Role</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as HomeKind)} aria-label="Role">
          {HOME_KINDS.map((k) => (
            <option key={k} value={k}>
              {HOME_KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <KindEditor key={kind} kind={kind} />
    </Panel>
  );
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

function KindEditor({ kind }: { kind: HomeKind }) {
  const { orgSlug, can } = useMember();
  const toast = useToast();
  const q = useApiQuery("getDashboardLayouts", { params: { orgSlug }, query: { kind } }, { retry: false });
  const save = useApiMutation("putDashboardLayouts", { invalidate: [["getDashboardLayouts"]] });
  const [draft, setDraft] = useState<LayoutEntry[] | null>(null);
  const mayEdit = can("configuration.manage");
  if (q.isPending) return <LoadingState label="Loading the dashboard" />;
  if (q.isError || !q.data) return <QueryFailure error={q.error} area="Dashboards" onRetry={() => void q.refetch()} />;

  const saved = q.data.widgets as LayoutEntry[];
  const rows = draft ?? saved;
  const dirty = JSON.stringify(rows) !== JSON.stringify(saved);
  const defs = new Map(widgetsFor(kind).map((w) => [w.id, w]));

  async function run(widgets: LayoutEntry[] | null, done: string) {
    try {
      await save.mutateAsync({ params: { orgSlug }, body: { kind, widgets } });
      setDraft(null);
      toast.show({ message: done, tone: "success" });
    } catch (err) {
      toast.show({ message: describeError(err).body, tone: "danger" });
    }
  }

  return (
    <>
      <ol className="fb-dashed__list" aria-label={`${HOME_KIND_LABEL[kind]} dashboard widgets`}>
        {rows.map((r, i) => {
          const w = defs.get(r.id);
          if (!w) return null;
          return (
            <li key={r.id} className="fb-dashed__row">
              <div className="fb-dashed__main">
                <strong>{w.title}</strong>
                <span className="fb-set-muted">{w.description}</span>
                {w.keys.length || w.anyKeys ? <span className="fb-set-muted">Only for people who can see {[...w.keys, ...(w.anyKeys ? [w.anyKeys.join(" or ")] : [])].join(" and ")}.</span> : null}
              </div>
              <div className="fb-dashed__ctl">
                <Button variant="ghost" aria-label={`Move ${w.title} up`} disabled={!mayEdit || i === 0} onClick={() => setDraft(move(rows, i, i - 1))}>
                  Up
                </Button>
                <Button variant="ghost" aria-label={`Move ${w.title} down`} disabled={!mayEdit || i === rows.length - 1} onClick={() => setDraft(move(rows, i, i + 1))}>
                  Down
                </Button>
                <Switch
                  checked={r.visible}
                  label={`Show ${w.title}`}
                  disabled={!mayEdit || !!w.locked}
                  disabledReason={w.locked ? "This widget is the whole home and cannot be hidden" : !mayEdit ? "Only Management changes this" : undefined}
                  onChange={(next) => setDraft(rows.map((x) => (x.id === r.id ? { ...x, visible: next } : x)))}
                />
              </div>
            </li>
          );
        })}
      </ol>
      <p className="fb-set-muted">Each person sees these widgets only if their own permissions allow them. A widget hidden here is hidden for everyone in this role.</p>
      <div className="fb-set-panel__actions">
        <Button variant="primary" disabled={!mayEdit || !dirty || save.isPending} onClick={() => void run(rows, "Dashboard saved")}>
          Save
        </Button>
        <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(null)}>
          Discard
        </Button>
        <Button variant="ghost" disabled={!mayEdit || ((q.data as { isDefault?: boolean }).isDefault === true && !dirty) || save.isPending} onClick={() => void run(null, "Dashboard reset to default")}>
          Reset to default
        </Button>
      </div>
    </>
  );
}
