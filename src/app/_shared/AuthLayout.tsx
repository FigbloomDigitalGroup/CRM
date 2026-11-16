import type { ReactNode } from "react";
import { BrandMark } from "./BrandMark";

/**
 * The shared frame for the sign-in side pages that are not the two-column sign-in and sign-up screens: forgot password, reset password,
 * accept invite, two-step sign-in and its set-up, not found, and the error page (FIG-1592). Visual only: it holds no state and calls nothing.
 * Plain CSS in `globals.css` (`.auth-*`); these pages are outside the organisation layout and never load the design system stylesheet.
 */
export function AuthLayout({
  title,
  lead,
  children,
  wide,
  screenLabel,
  pill,
}: {
  title: string;
  /** One short sentence under the title: what this page is for, or what happened. */
  lead?: ReactNode;
  children?: ReactNode;
  /** A little wider card, for pages that carry more text. */
  wide?: boolean;
  /** Design reference (the screen checklist id), kept as `data-screen-label`. */
  screenLabel?: string;
  /** A small tag above the title, such as "Two-step sign-in". */
  pill?: string;
}) {
  return (
    <div className="auth-shell">
      <main className={wide ? "auth-card auth-card--wide" : "auth-card"} data-screen-label={screenLabel} aria-labelledby="auth-title">
        <div className="auth-brand">
          <BrandMark className="brand-mark" />
          <div className="auth-brand-name">
            Figbloom<span className="accent"> CRM</span>
          </div>
        </div>
        {pill ? <span className="auth-pill">{pill}</span> : null}
        <h1 id="auth-title" className="auth-title">
          {title}
        </h1>
        {lead ? <p className="auth-lead">{lead}</p> : null}
        {children}
      </main>
    </div>
  );
}

const ICON = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, focusable: false };

/**
 * A message that is explained, not just coloured: an icon, a short bold line and the detail. `error` and `warning` are announced at once
 * (role="alert"); `success` and `info` are announced politely (role="status"). Pass `id` to tie it to a field with `aria-describedby`.
 */
export function AuthNotice({
  kind,
  title,
  children,
  id,
}: {
  kind: "success" | "info" | "warning" | "error";
  title?: string;
  children?: ReactNode;
  id?: string;
}) {
  return (
    <div id={id} className={`auth-notice auth-notice--${kind}`} role={kind === "error" || kind === "warning" ? "alert" : "status"}>
      <span className="auth-notice__icon">
        {kind === "success" ? (
          <svg {...ICON}>
            <circle cx="12" cy="12" r="9" />
            <path d="m8.5 12.5 2.5 2.5 4.5-5" />
          </svg>
        ) : kind === "info" ? (
          <svg {...ICON}>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5M12 8h.01" />
          </svg>
        ) : (
          <svg {...ICON}>
            <path d="M12 3 2.5 20h19L12 3Z" />
            <path d="M12 10v4M12 17h.01" />
          </svg>
        )}
      </span>
      <div className="auth-notice__body">
        {title ? <strong>{title}</strong> : null}
        {children ? <div>{children}</div> : null}
      </div>
    </div>
  );
}

/** The way out of any dead end: one or two quiet links under the form. */
export function AuthLinks({ children }: { children: ReactNode }) {
  return <p className="auth-links">{children}</p>;
}

/** The only password rule the server enforces is the length (`MIN_PASSWORD_LENGTH`, 10). Shown as you type; the server remains the judge. */
export function PasswordRules({ value, min = 10, id }: { value: string; min?: number; id?: string }) {
  const met = value.length >= min;
  const left = Math.max(0, min - value.length);
  return (
    <ul className="auth-rules" id={id} aria-label="Password rules">
      <li className={met ? "is-met" : value.length > 0 ? "is-unmet" : undefined}>
        <span className="auth-rules__mark" aria-hidden="true">
          {met ? "✓" : "○"}
        </span>
        <span>
          At least {min} characters
          <span className="auth-rules__state"> {met ? "(done)" : value.length > 0 ? `(${left} more to go)` : ""}</span>
        </span>
      </li>
    </ul>
  );
}
