"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cx, useDismiss } from "../internal";

/* The field shell: label, required marker, help and error, wired to the control for screen readers --------------------------------- */

export interface FieldShellProps {
  label: ReactNode;
  required?: boolean;
  help?: ReactNode;
  /** The validation message; shown under the control and announced. */
  error?: string | null;
  /** Why the control is unavailable ("Only Management can change this"): shown as help text, not a tooltip. */
  disabledReason?: string;
}

export interface FieldControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  "aria-required"?: true;
}

export function Field({ label, required, help, error, disabledReason, children }: FieldShellProps & { children: (props: FieldControlProps) => ReactNode }) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = [help || disabledReason ? helpId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="fb-field">
      <label className="fb-label" htmlFor={id}>
        {label}
        {required ? (
          <>
            <span className="fb-req" aria-hidden="true">*</span>
            <span className="fb-sr-only"> (required)</span>
          </>
        ) : null}
      </label>
      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
        "aria-required": required ? true : undefined,
      })}
      {help || disabledReason ? <span id={helpId} className="fb-help">{disabledReason ?? help}</span> : null}
      {error ? <span id={errorId} className="fb-error" role="alert">{error}</span> : null}
    </div>
  );
}

type WithShell<T> = Omit<T, "id"> & FieldShellProps;

export const Input = forwardRef<HTMLInputElement, WithShell<InputHTMLAttributes<HTMLInputElement>>>(function Input(
  { label, required, help, error, disabledReason, className, disabled, ...rest },
  ref,
) {
  return (
    <Field label={label} required={required} help={help} error={error} disabledReason={disabledReason}>
      {(a11y) => <input ref={ref} className={cx("fb-input", className)} disabled={disabled || Boolean(disabledReason)} required={required} {...a11y} {...rest} />}
    </Field>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, WithShell<TextareaHTMLAttributes<HTMLTextAreaElement>>>(function Textarea(
  { label, required, help, error, disabledReason, className, disabled, ...rest },
  ref,
) {
  return (
    <Field label={label} required={required} help={help} error={error} disabledReason={disabledReason}>
      {(a11y) => <textarea ref={ref} className={cx("fb-input", className)} disabled={disabled || Boolean(disabledReason)} required={required} {...a11y} {...rest} />}
    </Field>
  );
});

export const Select = forwardRef<HTMLSelectElement, WithShell<SelectHTMLAttributes<HTMLSelectElement>> & { options: { value: string; label: string; disabled?: boolean }[]; placeholder?: string }>(
  function Select({ label, required, help, error, disabledReason, className, disabled, options, placeholder, ...rest }, ref) {
    return (
      <Field label={label} required={required} help={help} error={error} disabledReason={disabledReason}>
        {(a11y) => (
          <select ref={ref} className={cx("fb-input", className)} disabled={disabled || Boolean(disabledReason)} required={required} {...a11y} {...rest}>
            {placeholder ? <option value="">{placeholder}</option> : null}
            {options.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))}
          </select>
        )}
      </Field>
    );
  },
);

export const Checkbox = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: ReactNode }>(function Checkbox(
  { label, className, ...rest },
  ref,
) {
  return (
    <label className={cx("fb-check", className)}>
      <input ref={ref} type="checkbox" {...rest} />
      <span>{label}</span>
    </label>
  );
});

/** Native date and time pickers: the browser's own control is the most accessible one, and follows the device's locale. */
export const DateField = forwardRef<HTMLInputElement, WithShell<Omit<InputHTMLAttributes<HTMLInputElement>, "type">>>(function DateField(props, ref) {
  return <Input ref={ref} type="date" {...props} />;
});
export const TimeField = forwardRef<HTMLInputElement, WithShell<Omit<InputHTMLAttributes<HTMLInputElement>, "type">>>(function TimeField(props, ref) {
  return <Input ref={ref} type="time" {...props} />;
});

/* Searchable select (the ARIA combobox pattern) --------------------------------------------------------------------------------- */

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
}

export function SearchableSelect({
  label,
  options,
  value,
  onChange,
  placeholder = "Type to search",
  required,
  help,
  error,
  disabledReason,
  emptyText = "No matches",
}: FieldShellProps & {
  options: SelectOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  emptyText?: string;
}) {
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const selected = options.find((o) => o.value === value) ?? null;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q) || (o.hint ?? "").toLowerCase().includes(q)) : options;
  }, [options, query]);
  useDismiss(wrapRef, open, () => setOpen(false));
  useEffect(() => setActive(0), [query, open]);

  const choose = useCallback(
    (o: SelectOption | undefined) => {
      if (!o || o.disabled) return;
      onChange(o.value);
      setQuery("");
      setOpen(false);
    },
    [onChange],
  );

  return (
    <Field label={label} required={required} help={help} error={error} disabledReason={disabledReason}>
      {(a11y) => (
        <div className="fb-combo" ref={wrapRef}>
          <input
            {...a11y}
            role="combobox"
            className="fb-input"
            autoComplete="off"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && shown[active] ? `${listId}-${active}` : undefined}
            disabled={Boolean(disabledReason)}
            placeholder={selected ? selected.label : placeholder}
            value={open ? query : (selected?.label ?? "")}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setOpen(true);
                setActive((i) => Math.min(i + 1, shown.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" && open) {
                e.preventDefault();
                choose(shown[active]);
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
          />
          {open ? (
            <ul id={listId} role="listbox" aria-label={typeof label === "string" ? label : undefined} className="fb-listbox">
              {shown.length === 0 ? (
                <li role="option" aria-disabled="true" aria-selected="false" className="fb-option" style={{ cursor: "default" }}>{emptyText}</li>
              ) : (
                shown.map((o, i) => (
                  <li
                    key={o.value}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={o.value === value}
                    aria-disabled={o.disabled || undefined}
                    data-active={i === active ? "true" : undefined}
                    className="fb-option"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      choose(o);
                    }}
                  >
                    {o.label}
                    {o.hint ? <span className="fb-help" style={{ marginLeft: "auto" }}>{o.hint}</span> : null}
                  </li>
                ))
              )}
            </ul>
          ) : null}
        </div>
      )}
    </Field>
  );
}

/* The form layer ---------------------------------------------------------------------------------------------------------------- */

/** A list of problems at the top of a form, announced when it appears, for forms with more than a field or two. */
export function FormErrorSummary({ errors, title = "Fix these before saving" }: { errors: { path: string; message: string }[]; title?: string }) {
  if (errors.length === 0) return null;
  return (
    <div className="fb-form-summary" role="alert">
      <strong>{title}</strong>
      <ul>
        {errors.map((e, i) => (
          <li key={`${e.path}-${i}`}>{e.message}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Turns the API's error envelope (`fieldErrors: [{ path, message }]`) into a `{ field: message }` map a form can hand to its fields.
 * The first message per field wins; a nested path ("items.0.name") is also reachable by its last segment ("name").
 */
export function fieldErrorMap(fieldErrors: { path: string; message: string }[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { path, message } of fieldErrors ?? []) {
    if (!(path in out)) out[path] = message;
    const last = path.split(".").pop();
    if (last && !(last in out)) out[last] = message;
  }
  return out;
}

/**
 * Warns before a form with unsaved changes is left: the browser's own prompt for a reload or a closed tab, and `confirmDiscard()`
 * for in-app closes (a drawer's Cancel). Returns whether to go ahead.
 */
export function useDirtyGuard(dirty: boolean, message = "You have unsaved changes. Leave without saving?") {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
  const confirmDiscard = useCallback(() => !dirty || window.confirm(message), [dirty, message]);
  return { confirmDiscard };
}
