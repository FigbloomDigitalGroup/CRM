"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  IconArchive,
  IconConvert,
  IconEdit,
  IconLock,
  IconMore,
  IconReassign,
  IconRestore,
  IconView,
} from "../_shared/icons";
import type { LeadFields } from "./[leadId]/EditLeadForm";
import { EditLeadDrawer } from "./EditLeadDrawer";

export interface RowCaps {
  canEdit: boolean;
  canConvert: boolean;
  canArchive: boolean;
  canRestore: boolean;
  canReassign: boolean;
  reassignLocked: boolean;
}

/**
 * Per-row actions on the leads list: quick Edit and Convert buttons plus a
 * menu with the rest. What is shown comes from `leadCapabilities` (computed
 * on the server per lead), so Sales never sees a live Reassign and an
 * archived lead only offers View and Restore -- and the API enforces the
 * same rules whatever the UI shows.
 */
export function LeadRowActions({
  orgSlug,
  title,
  lead,
  ownerName,
  caps,
}: {
  orgSlug: string;
  title: string;
  lead: LeadFields;
  ownerName: string | null;
  caps: RowCaps;
}) {
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menu, setMenu] = useState<{ top: number; right: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const detailHref = `/o/${orgSlug}/leads/${lead.id}`;

  useEffect(() => {
    if (!menu) return;
    function close() {
      setMenu(null);
    }
    function onDown(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  function toggleMenu() {
    if (menu) return setMenu(null);
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMenu({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) });
  }

  async function run(action: "archive" | "restore") {
    setMenu(null);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/orgs/${orgSlug}/leads/${lead.id}/${action}`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Could not ${action} this lead.`);
      setDrawerOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${action} this lead.`);
    } finally {
      setBusy(false);
    }
  }

  const archiveButton = caps.canArchive ? (
    <button
      type="button"
      className="drawer-danger"
      disabled={busy}
      onClick={() => run("archive")}
    >
      <IconArchive size={15} />
      Archive
    </button>
  ) : null;

  return (
    <div className="row-actions">
      {caps.canEdit && (
        <button
          type="button"
          className="row-action-btn"
          onClick={() => setDrawerOpen(true)}
          aria-label="Edit lead"
          title="Edit lead"
        >
          <IconEdit />
        </button>
      )}
      {caps.canConvert && (
        <a
          className="row-action-btn"
          href={`${detailHref}#convert`}
          aria-label="Convert to deal"
          title="Convert to deal"
        >
          <IconConvert />
        </a>
      )}
      {caps.canRestore && (
        <button
          type="button"
          className="row-action-btn"
          disabled={busy}
          onClick={() => run("restore")}
          aria-label="Restore lead"
          title="Restore lead"
        >
          <IconRestore />
        </button>
      )}
      <button
        type="button"
        ref={triggerRef}
        className="row-action-btn"
        onClick={toggleMenu}
        aria-haspopup="menu"
        aria-expanded={Boolean(menu)}
        aria-label="More actions"
        title="More actions"
      >
        <IconMore />
      </button>

      {error && (
        <span className="row-error" role="alert">
          {error}
        </span>
      )}

      {menu &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            className="row-menu"
            style={{ top: menu.top, right: menu.right }}
          >
            <a role="menuitem" className="row-menu-item" href={detailHref}>
              <IconView />
              View details
            </a>
            {caps.canEdit && (
              <button
                type="button"
                role="menuitem"
                className="row-menu-item"
                onClick={() => {
                  setMenu(null);
                  setDrawerOpen(true);
                }}
              >
                <IconEdit size={16} />
                Edit lead
              </button>
            )}
            {caps.canConvert && (
              <a role="menuitem" className="row-menu-item" href={`${detailHref}#convert`}>
                <IconConvert />
                Convert to deal
              </a>
            )}
            {caps.canReassign && (
              <button
                type="button"
                role="menuitem"
                className="row-menu-item"
                onClick={() => {
                  setMenu(null);
                  setDrawerOpen(true);
                }}
              >
                <IconReassign />
                Reassign owner...
              </button>
            )}
            {caps.reassignLocked && !lead.converted && (
              <span
                role="menuitem"
                aria-disabled="true"
                className="row-menu-item is-locked"
              >
                <IconLock size={16} />
                Reassign owner
                <small>Management only</small>
              </span>
            )}
            {(caps.canArchive || caps.canRestore) && <div className="row-menu-sep" />}
            {caps.canArchive && (
              <button
                type="button"
                role="menuitem"
                className="row-menu-item is-danger"
                disabled={busy}
                onClick={() => run("archive")}
              >
                <IconArchive size={16} />
                Archive lead
              </button>
            )}
            {caps.canRestore && (
              <button
                type="button"
                role="menuitem"
                className="row-menu-item"
                disabled={busy}
                onClick={() => run("restore")}
              >
                <IconRestore size={16} />
                Restore lead
              </button>
            )}
          </div>,
          document.body,
        )}

      {drawerOpen && (
        <EditLeadDrawer
          orgSlug={orgSlug}
          title={title}
          lead={lead}
          ownerName={ownerName}
          canAssign={caps.canReassign}
          onClose={() => setDrawerOpen(false)}
          extraFooter={archiveButton}
        />
      )}
    </div>
  );
}
