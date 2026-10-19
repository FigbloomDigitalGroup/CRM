"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { IconClose } from "./icons";

/** Slide-in shell shared by the company and contact edit drawers. */
export function AccountDrawer({
  heading,
  subheading,
  onClose,
  children,
}: {
  heading: string;
  subheading: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
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
      <aside className="drawer-panel" role="dialog" aria-modal="true" aria-label={heading}>
        <header className="drawer-head">
          <div>
            <div className="drawer-title">{heading}</div>
            <div className="drawer-sub">{subheading}</div>
          </div>
          <button type="button" className="row-action-btn" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </header>
        {children}
      </aside>
    </div>,
    document.body,
  );
}
