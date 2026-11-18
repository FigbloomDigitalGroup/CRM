"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export interface ComboboxProps {
  value: string;
  onChange: (value: string) => void;
  /** The suggestions. Typing narrows them; any typed text is still accepted as the value. */
  options: string[];
  placeholder?: string;
  maxLength?: number;
  id?: string;
  /** Names the input (it sits inside a label that would otherwise also read out the list). */
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
}

/**
 * A text field with a suggestion list that looks like the rest of the system (the browser's own datalist popup is drawn by the operating system, dark in some
 * browsers). Pick a suggestion or type your own: the text in the box is the value. Arrow keys move, Enter picks, Escape closes.
 */
export function Combobox({ value, onChange, options, placeholder, maxLength, id, ariaLabel, className, disabled, required, invalid, autoFocus }: ComboboxProps) {
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const shown = useMemo(() => {
    const unique = Array.from(new Set(options.filter(Boolean)));
    const q = value.trim().toLowerCase();
    const matching = q ? unique.filter((o) => o.toLowerCase().includes(q)) : unique;
    // A suggestion identical to what is typed adds nothing.
    return matching.length === 1 && matching[0]!.toLowerCase() === q ? [] : matching;
  }, [options, value]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  function pick(option: string) {
    onChange(option);
    setOpen(false);
    setActive(-1);
  }

  const listVisible = open && shown.length > 0;

  return (
    <div className="fb-cb" ref={root}>
      <input
        id={id}
        className={className ?? "fb-ld-input"}
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={listVisible}
        aria-controls={listVisible ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={listVisible && active >= 0 ? `${listId}-${active}` : undefined}
        aria-invalid={invalid ? true : undefined}
        aria-required={required ? true : undefined}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
        required={required}
        autoComplete="off"
        data-autofocus={autoFocus ? true : undefined}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => (shown.length === 0 ? -1 : (a + 1) % shown.length));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => (shown.length === 0 ? -1 : a <= 0 ? shown.length - 1 : a - 1));
          } else if (e.key === "Enter" && listVisible && active >= 0) {
            e.preventDefault();
            pick(shown[active]!);
          } else if (e.key === "Escape" && open) {
            e.stopPropagation();
            setOpen(false);
          } else if (e.key === "Tab") {
            setOpen(false);
          }
        }}
      />
      {listVisible ? (
        <ul className="fb-cb__list" id={listId} role="listbox">
          {shown.map((option, i) => (
            <li
              key={option}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`fb-cb__option${i === active ? " is-active" : ""}${option === value ? " is-current" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(option)}
            >
              {option}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
