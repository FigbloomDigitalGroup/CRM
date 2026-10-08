"use client";

import { useState } from "react";

/** 18x18 stroke icons matching src/app/o/[orgSlug]/_shared/icons.tsx's style. */
const iconProps = {
  width: 17,
  height: 17,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function IconEye() {
  return (
    <svg {...iconProps}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconEyeOff() {
  return (
    <svg {...iconProps}>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.2A10.7 10.7 0 0 1 12 5c6.5 0 10 7 10 7a13.2 13.2 0 0 1-3.1 3.9M6.1 6.9C3.9 8.6 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 4.1-.9" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

/**
 * A password `<input>` with a show/hide toggle. Standalone rather than
 * reusing `src/app/o/[orgSlug]/_shared/icons.tsx` -- that set belongs to a
 * different route scope (inside the authenticated org shell), while this is
 * used only on the pre-auth pages (/login, /signup, /reset-password).
 */
export function PasswordInput({
  value,
  onChange,
  autoComplete,
  minLength,
  required,
  id,
  placeholder,
  variant = "default",
}: {
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  minLength?: number;
  required?: boolean;
  id?: string;
  placeholder?: string;
  /** "pill" is the rounded, icon-led field used on the redesigned /login screen. */
  variant?: "default" | "pill";
}) {
  const [visible, setVisible] = useState(false);

  if (variant === "pill") {
    return (
      <div className="lg-field">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          minLength={minLength}
          required={required}
          placeholder={placeholder}
        />
        <button
          type="button"
          className="lg-eye"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          title={visible ? "Hide password" : "Show password"}
        >
          {visible ? <IconEyeOff /> : <IconEye />}
        </button>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", display: "flex" }}>
      <input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        minLength={minLength}
        required={required}
        placeholder={placeholder}
        style={{ flex: 1, paddingRight: 36 }}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        title={visible ? "Hide password" : "Show password"}
        style={{
          position: "absolute",
          right: 4,
          top: "50%",
          transform: "translateY(-50%)",
          padding: 4,
          border: "none",
          background: "none",
          color: "var(--text-secondary)",
        }}
      >
        {visible ? <IconEyeOff /> : <IconEye />}
      </button>
    </div>
  );
}
