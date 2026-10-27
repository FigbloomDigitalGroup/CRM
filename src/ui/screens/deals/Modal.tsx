"use client";

import { useId, useRef, type ReactNode } from "react";
import { Portal, useFocusTrap } from "../../internal";

interface ModalProps {
  title: string;
  onClose: () => void;
  children?: ReactNode;
  actions?: ReactNode;
  badge?: ReactNode;
  lead?: ReactNode;
  dismissible?: boolean;
}

/**
 * The design's modal (CrmOverlays): a 560 px sheet with a 20 px radius, header, body and a right-aligned action row. Focus is trapped
 * inside, Escape and a click on the backdrop close it, and focus goes back to where it was. (The trap lives in the inner component, which
 * only mounts once the portal has its target; a trap set up before that would find nothing to hold.)
 */
export function DealModal(props: ModalProps) {
  return (
    <Portal>
      <ModalBody {...props} />
    </Portal>
  );
}

function ModalBody({ title, onClose, children, actions, badge, lead, dismissible = true }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(ref, dismissible ? onClose : undefined);
  return (
    <div className="fb-overlay fb-dm-overlay" onMouseDown={(e) => e.target === e.currentTarget && dismissible && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="fb-dm">
        <div className="fb-dm__head">
          {badge}
          <h2 id={titleId} className="fb-dm__title">{title}</h2>
          {lead ? <p className="fb-dm__lead">{lead}</p> : null}
        </div>
        {children ? <div className="fb-dm__body">{children}</div> : null}
        {actions ? <div className="fb-dm__actions">{actions}</div> : null}
      </div>
    </div>
  );
}
