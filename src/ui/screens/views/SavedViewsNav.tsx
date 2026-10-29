"use client";

import { Bookmark } from "lucide-react";
import { useMember } from "../../data/member";
import { toolsEnabled } from "../assistant/ToolsHost";
import { pinnedViews } from "./model";
import { useSavedViews } from "./store";

/**
 * The "Saved views" group in the sidebar (X4): the views pinned by the person, and shared ones pinned by colleagues whose lists this role may
 * open. Uses the sidebar's own section markup so it looks and behaves like the other groups.
 */
export function SavedViewsNav({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const member = useMember();
  const [views] = useSavedViews(member.orgSlug);
  if (!toolsEnabled()) return null;
  const pinned = pinnedViews(views, { membershipId: member.membershipId, permissionKeys: member.permissionKeys });
  if (pinned.length === 0) return null;
  return (
    <div className="fb-sidebar__section" data-testid="sidebar-saved-views">
      <div className="fb-sidebar__label">Saved views</div>
      {pinned.map((v) => (
        <a key={v.id} href={`/o/${member.orgSlug}/${v.page}?savedView=${encodeURIComponent(v.id)}`} className="fb-navlink" title={collapsed ? v.name : undefined} onClick={onNavigate}>
          <span aria-hidden="true" style={{ display: "flex" }}>
            <Bookmark size={18} />
          </span>
          <span className="fb-sidebar__text">{v.name}</span>
          {v.shared ? <span className="fb-sr-only"> (shared)</span> : null}
        </a>
      ))}
    </div>
  );
}
