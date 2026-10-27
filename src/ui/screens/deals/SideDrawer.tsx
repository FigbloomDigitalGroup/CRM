"use client";

import { X } from "lucide-react";
import { useId, useRef, type ReactNode } from "react";
import { Portal, useFocusTrap } from "../../internal";

interface DrawerProps {
  title: string;
  sub?: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}

/** The design's side drawer (480 px, header with a subtitle, scrolling body, footer actions); focus is trapped and Escape closes it. */
export function SideDrawer(props: DrawerProps) {
  return (
    <Portal>
      <DrawerBody {...props} />
    </Portal>
  );
}

function DrawerBody({ title, sub, onClose, children, footer }: DrawerProps) {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(panel, onClose);
  return (
    <div className="fb-dd-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="fb-dd">
        <div className="fb-dd__head">
          <div style={{ flex: 1 }}>
            <h2 id={titleId} className="fb-dd__title">{title}</h2>
            {sub ? <p className="fb-dd__sub">{sub}</p> : null}
          </div>
          <button type="button" className="fb-dd__close" aria-label="Close" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="fb-dd__body">{children}</div>
        <div className="fb-dd__foot">{footer}</div>
      </aside>
    </div>
  );
}
