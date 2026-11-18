"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Portal, useFocusTrap } from "../../internal";
import { Icon } from "./icons";

function useScrollLock() {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
}

/** The side drawer of the design (CrmOverlays): 480 px, header with title and subtitle, scrolling body, sticky footer. */
export function SideDrawer({
  title,
  subtitle,
  onClose,
  footer,
  children,
  label,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
  /** A stable name for tests and screen labels. */
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(ref, onClose);
  useScrollLock();
  return (
    <Portal>
      <div className="fb-ld-scrim" onClick={onClose} aria-hidden="true" />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} data-screen-label={label ?? title} tabIndex={-1} className="fb-ld-drawer">
        <div className="fb-ld-drawer__head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button type="button" className="fb-ld-close" aria-label="Close" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="fb-ld-drawer__body">{children}</div>
        {footer ? <div className="fb-ld-drawer__foot">{footer}</div> : null}
      </div>
    </Portal>
  );
}

/** The centred modal of the design: 560 px, 20 px radius, header / body / footer blocks. */
export function ModalShell({
  title,
  intro,
  onClose,
  dismissible = true,
  children,
  footer,
  label,
  eyebrow,
}: {
  title: string;
  intro?: ReactNode;
  onClose: () => void;
  dismissible?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  label?: string;
  eyebrow?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(ref, dismissible ? onClose : undefined);
  useScrollLock();
  return (
    <Portal>
      <div className="fb-ld-scrim fb-ld-scrim--modal" onClick={dismissible ? onClose : undefined}>
        <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} data-screen-label={label ?? title} tabIndex={-1} className="fb-ld-modal" onClick={(e) => e.stopPropagation()}>
          <div className="fb-ld-modal__head">
            {eyebrow}
            <h2 id={titleId}>{title}</h2>
            {intro ? <p>{intro}</p> : null}
          </div>
          <div className="fb-ld-modal__body">{children}</div>
          {footer ? <div className="fb-ld-modal__foot">{footer}</div> : null}
        </div>
      </div>
    </Portal>
  );
}
