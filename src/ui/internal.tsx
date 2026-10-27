"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

/** Joins class names, skipping the falsy ones. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * Overlays render inside `.fb-app` (not on `<body>`), so they inherit the theme tokens and the root modes. Outside the app (tests, the
 * gallery in isolation) they fall back to `<body>`.
 */
export function Portal({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState<Element | null>(null);
  useEffect(() => {
    setTarget(document.querySelector(".fb-app") ?? document.body);
  }, []);
  return target ? createPortal(children, target) : null;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute("hidden") && el.getAttribute("aria-hidden") !== "true");
}

/**
 * Keeps keyboard focus inside `ref` while it is mounted, moves focus in on open and puts it back where it was on close. Escape calls
 * `onEscape`. This is the one focus-trap every dialog and drawer uses.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, onEscape?: () => void) {
  const escape = useRef(onEscape);
  escape.current = onEscape;
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const previous = document.activeElement as HTMLElement | null;
    const first = root.querySelector<HTMLElement>("[data-autofocus]") ?? focusableIn(root)[0] ?? root;
    first.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        escape.current?.();
        return;
      }
      if (e.key !== "Tab" || !root) return;
      const items = focusableIn(root);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const head = items[0]!;
      const tail = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === head) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && document.activeElement === tail) {
        e.preventDefault();
        head.focus();
      }
    }
    root.addEventListener("keydown", onKey);
    return () => {
      root.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [ref]);
}

/** Calls `onOutside` for a pointer press outside `ref`, and on Escape. */
export function useDismiss(ref: RefObject<HTMLElement | null>, active: boolean, onDismiss: () => void) {
  const cb = useRef(onDismiss);
  cb.current = onDismiss;
  useEffect(() => {
    if (!active) return;
    function down(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) cb.current();
    }
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") cb.current();
    }
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [ref, active]);
}
