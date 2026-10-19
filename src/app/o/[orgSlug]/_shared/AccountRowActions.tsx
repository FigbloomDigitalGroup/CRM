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
} from "./icons";

export interface AccountRowCaps {
  canEdit: boolean;
  canArchive: boolean;
  canRestore: boolean;
  canMerge: boolean;
  canReassign: boolean;
  reassignLocked: boolean;
}

/**
 * Per-row actions on the companies and contacts lists: a quick Edit button
 * plus a menu with the rest. What is shown comes from `accountCapabilities`
 * (computed on the server per record), so a Delivery user never sees an
 * Edit button, a Sales user sees Reassign only as a locked "Management only"
 * line, and an archived record only offers View and Restore -- and the API
 * enforces the same rules whatever the UI shows.
 */
export function AccountRowActions({
  orgSlug,
  noun,
  basePath,
  detailHref,
  caps,
  renderDrawer,
}: {
  orgSlug: string;
  /** "company" | "contact" -- used in labels and error text. */
  noun: string;
  /** e.g. `companies/<id>` (used for the archive/restore POSTs). */
  basePath: string;
  detailHref: string;
  caps: AccountRowCaps;
  /** Renders the edit drawer; `footer` is the Archive button when allowed. */
  renderDrawer: (args: { onClose: () => void; footer: React.ReactNode }) => React.ReactNode;
}) {
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menu, setMenu] = useState<{ top: number; right: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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
      const res = await fetch(`/api/orgs/${orgSlug}/${basePath}/${action}`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Could not ${action} this ${noun}.`);
      setDrawerOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not ${action} this ${noun}.`);
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

  function openDrawer() {
    setMenu(null);
    setDrawerOpen(true);
  }

  return (
    <div className="row-actions">
      {caps.canEdit && (
        <button
          type="button"
          className="row-action-btn"
          onClick={openDrawer}
          aria-label={`Edit ${noun}`}
          title={`Edit ${noun}`}
        >
          <IconEdit />
        </button>
      )}
      {caps.canRestore && (
        <button
          type="button"
          className="row-action-btn"
          disabled={busy}
          onClick={() => run("restore")}
          aria-label={`Restore ${noun}`}
          title={`Restore ${noun}`}
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
              <button type="button" role="menuitem" className="row-menu-item" onClick={openDrawer}>
                <IconEdit size={16} />
                Edit {noun}
              </button>
            )}
            {caps.canMerge && (
              <a role="menuitem" className="row-menu-item" href={`${detailHref}#merge`}>
                <IconConvert />
                Merge duplicate...
              </a>
            )}
            {caps.canReassign && (
              <button type="button" role="menuitem" className="row-menu-item" onClick={openDrawer}>
                <IconReassign />
                Reassign owner...
              </button>
            )}
            {caps.reassignLocked && (
              <span role="menuitem" aria-disabled="true" className="row-menu-item is-locked">
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
                Archive {noun}
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
                Restore {noun}
              </button>
            )}
          </div>,
          document.body,
        )}

      {drawerOpen &&
        renderDrawer({ onClose: () => setDrawerOpen(false), footer: archiveButton })}
    </div>
  );
}
