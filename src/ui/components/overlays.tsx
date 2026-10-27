"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { cx, Portal, useDismiss, useFocusTrap } from "../internal";

/* Tooltip --------------------------------------------------------------------------------------------------------------------- */

/** Text that appears on hover and keyboard focus and is tied to its trigger for screen readers. Never the only place information lives. */
export function Tooltip({ text, children }: { text: string; children: ReactElement<{ "aria-describedby"?: string }> }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const child = Children.only(children);
  return (
    <span
      className="fb-anchor"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
    >
      {isValidElement(child) ? cloneElement(child, { "aria-describedby": id }) : child}
      <span id={id} role="tooltip" className="fb-tooltip" hidden={!open}>
        {text}
      </span>
    </span>
  );
}

/* Popover and menu ----------------------------------------------------------------------------------------------------------------- */

export function Popover({
  label,
  trigger,
  children,
  align = "start",
  triggerClassName,
  className,
  open: controlledOpen,
  onOpenChange,
}: {
  /** The accessible name of the panel (and of the trigger when it has no text). */
  label: string;
  trigger: ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: "start" | "end";
  triggerClassName?: string;
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [inner, setInner] = useState(false);
  const open = controlledOpen ?? inner;
  const set = useCallback((v: boolean) => (onOpenChange ? onOpenChange(v) : setInner(v)), [onOpenChange]);
  const ref = useRef<HTMLSpanElement>(null);
  const panelId = useId();
  useDismiss(ref, open, () => set(false));
  return (
    <span className="fb-anchor" ref={ref}>
      <button
        type="button"
        className={triggerClassName}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={typeof trigger === "string" ? undefined : label}
        onClick={() => set(!open)}
      >
        {trigger}
      </button>
      {open ? (
        <div id={panelId} role="dialog" aria-label={label} className={cx("fb-popover", align === "end" && "fb-popover--end", className)}>
          {typeof children === "function" ? children(() => set(false)) : children}
        </div>
      ) : null}
    </span>
  );
}

export interface MenuItem {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  onSelect?: () => void;
  href?: string;
  danger?: boolean;
  /** Shown instead of hiding the item: the reason this person cannot use it. */
  disabledReason?: string;
  separatorBefore?: boolean;
}

export function Menu({
  label,
  trigger,
  items,
  align = "start",
  triggerClassName,
}: {
  label: string;
  trigger: ReactNode;
  items: MenuItem[];
  align?: "start" | "end";
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useDismiss(ref, open, () => setOpen(false));

  useEffect(() => {
    if (open) ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')[active]?.focus();
  }, [open, active]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  function onKey(e: ReactKeyboardEvent) {
    if (!open) return;
    const last = items.length - 1;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i >= last ? 0 : i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? last : i - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(last);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <span className="fb-anchor" ref={ref} onKeyDown={onKey}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={typeof trigger === "string" ? undefined : label}
        onClick={() => {
          setActive(0);
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setActive(0);
            setOpen(true);
          }
        }}
      >
        {trigger}
      </button>
      {open ? (
        <div id={menuId} role="menu" aria-label={label} className={cx("fb-menu", align === "end" && "fb-menu--end")}>
          {items.map((item, i) => {
            const blocked = Boolean(item.disabledReason);
            const common = {
              role: "menuitem" as const,
              tabIndex: i === active ? 0 : -1,
              className: cx("fb-menuitem", item.danger && "fb-menuitem--danger"),
              "aria-disabled": blocked || undefined,
              title: item.disabledReason,
              "data-active": i === active ? "true" : undefined,
            };
            const select = () => {
              if (blocked) return;
              item.onSelect?.();
              close(true);
            };
            return (
              <span key={item.key}>
                {item.separatorBefore ? <hr /> : null}
                {item.href && !blocked ? (
                  <a {...common} href={item.href} onClick={select}>
                    {item.icon}
                    {item.label}
                  </a>
                ) : (
                  <button type="button" {...common} onClick={select}>
                    {item.icon}
                    {item.label}
                    {blocked ? <span className="fb-sr-only"> (unavailable: {item.disabledReason})</span> : null}
                  </button>
                )}
              </span>
            );
          })}
        </div>
      ) : null}
    </span>
  );
}

/* Dialog, confirm dialog, drawer -------------------------------------------------------------------------------------------------- */

function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);
}

function Overlay({ onClose, drawer, children }: { onClose: () => void; drawer?: boolean; children: ReactNode }) {
  return (
    <div
      className={cx("fb-overlay", drawer && "fb-overlay--drawer")}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {children}
    </div>
  );
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  actions,
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  /** False for a step that must be answered (a confirmation in flight). */
  dismissible?: boolean;
}) {
  if (!open) return null;
  return (
    <Portal>
      <DialogBody onClose={onClose} title={title} actions={actions} dismissible={dismissible}>
        {children}
      </DialogBody>
    </Portal>
  );
}

function DialogBody({ onClose, title, children, actions, dismissible }: { onClose: () => void; title: string; children?: ReactNode; actions?: ReactNode; dismissible: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(ref, dismissible ? onClose : undefined);
  useScrollLock(true);
  return (
    <Overlay onClose={dismissible ? onClose : () => undefined}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} className="fb-dialog" tabIndex={-1}>
        <h2 id={titleId} className="fb-dialog__title">{title}</h2>
        <div className="fb-dialog__body">{children}</div>
        {actions ? <div className="fb-dialog__actions">{actions}</div> : null}
      </div>
    </Overlay>
  );
}

export function Drawer({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children?: ReactNode; footer?: ReactNode }) {
  if (!open) return null;
  return (
    <Portal>
      <DrawerBody onClose={onClose} title={title} footer={footer}>
        {children}
      </DrawerBody>
    </Portal>
  );
}

function DrawerBody({ onClose, title, children, footer }: { onClose: () => void; title: string; children?: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(ref, onClose);
  useScrollLock(true);
  return (
    <Overlay onClose={onClose} drawer>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} className="fb-drawer" tabIndex={-1}>
        <div className="fb-drawer__head">
          <h2 id={titleId} className="fb-dialog__title" style={{ margin: 0 }}>{title}</h2>
          <button type="button" className="fb-iconbtn" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
        {footer ? <div className="fb-dialog__actions" style={{ marginTop: 0 }}>{footer}</div> : null}
      </div>
    </Overlay>
  );
}

/**
 * A yes/no question before something that is hard to undo. The confirm button shows progress while `onConfirm` runs, and the dialog
 * stays open (and says why) if it fails.
 */
export function ConfirmDialog({
  open,
  onClose,
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "primary",
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
  onConfirm: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) {
      setBusy(false);
      setError(null);
    }
  }, [open]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      dismissible={!busy}
      actions={
        <>
          <button type="button" className="fb-btn fb-btn--secondary" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            data-autofocus
            className={cx("fb-btn", tone === "danger" ? "fb-btn--danger" : "fb-btn--primary")}
            aria-disabled={busy || undefined}
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              setError(null);
              try {
                await onConfirm();
                onClose();
              } catch (err) {
                setError(err instanceof Error ? err.message : "That did not work. Try again.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <span className="fb-spinner" aria-hidden="true" /> : null}
            {confirmLabel}
          </button>
        </>
      }
    >
      <p style={{ margin: 0 }}>{body}</p>
      {error ? <p role="alert" className="fb-error" style={{ marginBottom: 0 }}>{error}</p> : null}
    </Dialog>
  );
}

/* Tabs ----------------------------------------------------------------------------------------------------------------------------- */

export interface TabDef {
  id: string;
  label: ReactNode;
  panel: ReactNode;
  /** Shown but not selectable, with the reason as its tooltip. */
  disabledReason?: string;
}

export function Tabs({ label, tabs, value, onChange }: { label: string; tabs: TabDef[]; value?: string; onChange?: (id: string) => void }) {
  const base = useId();
  const [inner, setInner] = useState(tabs[0]?.id);
  const current = value ?? inner;
  const set = (id: string) => (onChange ? onChange(id) : setInner(id));
  const enabled = tabs.filter((t) => !t.disabledReason);

  function onKey(e: ReactKeyboardEvent, id: string) {
    const i = enabled.findIndex((t) => t.id === id);
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % enabled.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + enabled.length) % enabled.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = enabled.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const target = enabled[next]!;
    set(target.id);
    document.getElementById(`${base}-tab-${target.id}`)?.focus();
  }

  const active = tabs.find((t) => t.id === current) ?? tabs[0];
  return (
    <div>
      <div role="tablist" aria-label={label} className="fb-tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            id={`${base}-tab-${t.id}`}
            type="button"
            role="tab"
            className="fb-tab"
            aria-selected={t.id === active?.id}
            aria-controls={`${base}-panel-${t.id}`}
            aria-disabled={t.disabledReason ? true : undefined}
            title={t.disabledReason}
            tabIndex={t.id === active?.id ? 0 : -1}
            onClick={() => !t.disabledReason && set(t.id)}
            onKeyDown={(e) => onKey(e, t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {active ? (
        <div id={`${base}-panel-${active.id}`} role="tabpanel" aria-labelledby={`${base}-tab-${active.id}`} className="fb-tabpanel" tabIndex={0}>
          {active.panel}
        </div>
      ) : null}
    </div>
  );
}
