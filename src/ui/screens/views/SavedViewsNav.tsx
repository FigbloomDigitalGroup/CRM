"use client";

import Link from "next/link";
import { Bookmark } from "lucide-react";
import { useMember } from "../../data/member";
import { toolsEnabled } from "../assistant/ToolsHost";
import { useSavedViews } from "./store";

/**
 * The "Saved views" group in the sidebar (X4): the views the person pinned, in their order (`GET /views?pinned=true`; the server already left out
 * shared views whose list this role may not open). Uses the sidebar's own section markup. Shows nothing while loading, or when the organisation is
 * not on V1.1 or the read fails: the sidebar must never get in the way of the rest of the app.
 */
export function SavedViewsNav({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const member = useMember();
  const on = toolsEnabled();
  const { views } = useSavedViews({ pinned: true, enabled: on });
  if (!on || views.length === 0) return null;
  return (
    <div className="fb-sidebar__section" data-testid="sidebar-saved-views">
      <div className="fb-sidebar__label">Saved views</div>
      {views.map((v) => (
        <Link key={v.id} href={`/o/${member.orgSlug}/${v.page}?savedView=${encodeURIComponent(v.id)}`} className="fb-navlink" title={collapsed ? v.name : undefined} onClick={onNavigate}>
          <span aria-hidden="true" style={{ display: "flex" }}>
            <Bookmark size={18} />
          </span>
          <span className="fb-sidebar__text">{v.name}</span>
          {v.shared ? <span className="fb-sr-only"> (shared)</span> : null}
        </Link>
      ))}
    </div>
  );
}
