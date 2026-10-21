"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { IconClose } from "../_shared/icons";
import { EditLeadForm, type LeadFields } from "./[leadId]/EditLeadForm";
import { useLeadRefs } from "./LeadRefs";

/**
 * Slide-in editor for one lead, opened from the list so people can change
 * temperature, status, notes and (for Management) the owner without
 * leaving the table.
 */
export function EditLeadDrawer({
  orgSlug,
  title,
  lead,
  ownerName,
  canAssign,
  onClose,
  extraFooter,
}: {
  orgSlug: string;
  title: string;
  lead: LeadFields;
  ownerName: string | null;
  canAssign: boolean;
  onClose: () => void;
  extraFooter?: React.ReactNode;
}) {
  const refs = useLeadRefs();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return createPortal(
    <div className="drawer-root">
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer-panel" role="dialog" aria-modal="true" aria-label="Edit lead">
        <header className="drawer-head">
          <div>
            <div className="drawer-title">Edit lead</div>
            <div className="drawer-sub">{title}</div>
          </div>
          <button
            type="button"
            className="row-action-btn"
            onClick={onClose}
            aria-label="Close"
          >
            <IconClose />
          </button>
        </header>
        <EditLeadForm
          orgSlug={orgSlug}
          lead={lead}
          leadStatuses={refs.leadStatuses}
          leadSources={refs.leadSources}
          lostReasons={refs.lostReasons}
          owners={refs.owners}
          ownerName={ownerName}
          canAssign={canAssign}
          onCancel={onClose}
          onSaved={onClose}
          extraFooter={extraFooter}
        />
      </aside>
    </div>,
    document.body,
  );
}
