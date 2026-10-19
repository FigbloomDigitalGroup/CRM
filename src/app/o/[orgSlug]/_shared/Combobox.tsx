"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconChevronDown, IconCheck } from "./icons";

export interface ComboOption {
  value: string;
  label: string;
  /** Shown as a smaller muted line under the label, open-panel only (e.g. a role name under a person's name). */
  sublabel?: string;
  /** 1-2 letters; when set, renders a colored initials circle in front of the row. Omit for plain-text options (status, temperature, etc). */
  avatarLabel?: string;
}

const AVATAR_PALETTE = [
  "#1f5c3a",
  "#2f6fb0",
  "#b0552f",
  "#6b6f66",
  "#8a4fae",
  "#2f8f8a",
];

function colorFor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length]!;
}

/**
 * Custom dropdown replacing the native `<select>` across the Leads page
 * (reassign column, filter bar, new-lead form) -- a native select's open
 * popup is sized/positioned by the browser itself (content-width, not
 * CSS-controllable), which is what let it spill out from a narrow table
 * column into the page's side rail. This renders its own panel through a
 * portal with an explicit, fixed width, positioned (and viewport-clamped)
 * from the trigger's own measured position -- it can never be wider or
 * further right than this component decides, and it's immune to any
 * ancestor's `overflow: hidden/auto` (e.g. `.table-card`) since it isn't a
 * descendant of it in the DOM once portaled to `document.body`.
 */
export function Combobox({
  value,
  options,
  onChange,
  placeholder = "Select...",
  disabled,
  width = 260,
  ariaLabel,
  searchable,
}: {
  value: string;
  options: ComboOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  width?: number;
  ariaLabel?: string;
  /** Show a type-to-filter box in the open panel. Defaults to on for lists longer than 8 options (company pickers etc.). */
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(
    null,
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const filterable = searchable ?? options.length > 8;
  const needle = query.trim().toLowerCase();
  const visible =
    filterable && needle
      ? options.filter((o) =>
          `${o.label} ${o.sublabel ?? ""}`.toLowerCase().includes(needle),
        )
      : options;

  const selected = options.find((o) => o.value === value);
  const triggerText = selected
    ? selected.sublabel
      ? `${selected.label} (${selected.sublabel})`
      : selected.label
    : placeholder;

  function openPanel() {
    if (disabled || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const panelWidth = Math.max(width, rect.width);
    const margin = 8;
    const left = Math.min(rect.left, window.innerWidth - margin - panelWidth);
    setCoords({ top: rect.bottom + 6, left: Math.max(margin, left), width: panelWidth });
    setQuery("");
    setActiveIndex(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  }

  function closePanel() {
    setOpen(false);
  }

  function choose(index: number) {
    const opt = visible[index];
    if (!opt) return;
    onChange(opt.value);
    closePanel();
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (open && filterable) searchRef.current?.focus();
  }, [open, filterable]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      closePanel();
    }
    function handleScrollOrResize() {
      closePanel();
    }
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [open]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        openPanel();
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closePanel();
      triggerRef.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(visible.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" || (e.key === " " && !filterable)) {
      e.preventDefault();
      choose(activeIndex);
    }
  }

  return (
    <div className="combo">
      <button
        type="button"
        ref={triggerRef}
        className="combo-trigger"
        disabled={disabled}
        onClick={() => (open ? closePanel() : openPanel())}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <span className="combo-trigger-label">{triggerText}</span>
        <IconChevronDown className="combo-chevron" />
      </button>

      {open &&
        coords &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            id={listboxId}
            className="combo-panel"
            style={{ top: coords.top, left: coords.left, width: coords.width }}
          >
            {filterable && (
              <input
                ref={searchRef}
                className="combo-search"
                type="text"
                placeholder="Search..."
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActiveIndex(0);
                }}
                onKeyDown={handleKeyDown}
                aria-label="Search options"
              />
            )}
            <div className="combo-options">
              {visible.length === 0 && (
                <div className="combo-empty">No matches</div>
              )}
              {visible.map((opt, index) => {
                const isSelected = opt.value === value;
                const isActive = index === activeIndex;
                return (
                  <div
                    key={opt.value}
                    role="option"
                    aria-selected={isSelected}
                    className={`combo-option${isActive ? " is-active" : ""}${isSelected ? " is-selected" : ""}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => choose(index)}
                  >
                    {opt.avatarLabel && (
                      <span className="combo-avatar" style={{ background: colorFor(opt.label) }}>
                        {opt.avatarLabel}
                      </span>
                    )}
                    <span className="combo-option-text">
                      <span className="combo-option-label">{opt.label}</span>
                      {opt.sublabel && (
                        <span className="combo-option-sublabel">{opt.sublabel}</span>
                      )}
                    </span>
                    {isSelected && <IconCheck className="combo-check" />}
                  </div>
                );
              })}
            </div>
            <div className="combo-hint">
              <span>
                <kbd>↑↓</kbd> navigate
              </span>
              <span>
                <kbd>↵</kbd> select
              </span>
              <span>
                <kbd>esc</kbd> close
              </span>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
