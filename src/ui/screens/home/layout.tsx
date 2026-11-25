"use client";

import type { ReactNode } from "react";
import { useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { HCols } from "./kit";
import { DASHBOARD_WIDGETS, resolveLayout, type HomeKind, type LayoutEntry, type WidgetDef } from "./catalogue";

/**
 * Lays a role's home out from the saved dashboard layout (UC-W1). With no saved layout, or while it loads or fails, the catalogue default is used,
 * which is the home exactly as it was before layouts existed. Widgets are given as ready elements keyed by catalogue id; one the layout hides, or
 * the person's permission keys do not grant, is never mounted (so it fetches nothing). Consecutive panels sit two to a row, full-width ones alone.
 */

const DEFS = new Map<string, WidgetDef>(DASHBOARD_WIDGETS.map((w) => [w.id, w]));

type Offered = Record<string, ReactNode | undefined | false>;

export function useHomeLayout(kind: HomeKind): LayoutEntry[] {
  const m = useMember();
  const q = useApiQuery("getDashboardLayouts", { params: { orgSlug: m.orgSlug }, query: undefined }, { retry: false, staleTime: 60_000 });
  const stored = q.data && q.data.kind === kind ? (q.data.widgets as LayoutEntry[]) : null;
  return resolveLayout(kind, stored, m.can);
}

/** The ids to render, in order: visible, known to the catalogue, and actually offered by the screen (absent ones are skipped). */
export function orderedWidgets(layout: readonly LayoutEntry[], offered: Offered): string[] {
  return layout.filter((e) => e.visible && DEFS.has(e.id) && offered[e.id]).map((e) => e.id);
}

export function LayoutBody({ kind, widgets, grid }: { kind: HomeKind; widgets: Offered; grid?: boolean }) {
  const layout = useHomeLayout(kind);
  const ids = orderedWidgets(layout, widgets);
  const out: ReactNode[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const key = `run-${out.length}`;
    if (grid) {
      out.push(
        <div key={key} className="fb-hgrid fb-hgrid--wide">
          {run.map((id) => (
            <div key={id}>{widgets[id]}</div>
          ))}
        </div>,
      );
    } else {
      out.push(
        <HCols
          key={key}
          left={run.filter((_, i) => i % 2 === 0).map((id) => <div key={id}>{widgets[id]}</div>)}
          right={run.filter((_, i) => i % 2 === 1).map((id) => <div key={id}>{widgets[id]}</div>)}
        />,
      );
    }
    run = [];
  };
  for (const id of ids) {
    if (DEFS.get(id)!.width === "panel") run.push(id);
    else {
      flush();
      out.push(<div key={id}>{widgets[id]}</div>);
    }
  }
  flush();
  return <>{out}</>;
}
