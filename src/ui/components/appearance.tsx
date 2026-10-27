"use client";

import { useId } from "react";
import { AA_TEXT, contrastRatio, formatRatio, isHexColour } from "@/preferences/contrast";
import type { ThemeDef } from "@/preferences/catalogue";
import { cx } from "../internal";
import { Badge } from "./basics";

/**
 * The appearance pieces from the design system's "07D Appearance and top bar" section, used by Preferences (F4.01) and the organisation's look
 * settings. They are in the library now so the gallery can show them and Preferences only has to arrange them.
 */

/** A theme as a small swatch card: sidebar, accent and highlight, with its name. A radio inside a group. */
export function ThemeCard({ theme, selected, onSelect, name = "theme" }: { theme: ThemeDef; selected: boolean; onSelect: () => void; name?: string }) {
  const id = useId();
  return (
    <label htmlFor={id} className={cx("fb-card", "fb-themecard")} style={{ display: "flex", flexDirection: "column", gap: 8, padding: 12, cursor: "pointer", outline: selected ? "2px solid var(--primary)" : undefined }}>
      <input id={id} type="radio" name={name} className="fb-sr-only" checked={selected} onChange={onSelect} />
      <span aria-hidden="true" style={{ display: "flex", height: 44, borderRadius: 10, overflow: "hidden", border: "1px solid var(--border)" }}>
        <span style={{ flex: 1, background: theme.sidebar }} />
        <span style={{ flex: 1, background: theme.accent }} />
        <span style={{ flex: 1, background: theme.highlight }} />
      </span>
      <span style={{ fontWeight: 600 }}>
        {theme.label}
        {selected ? <span className="fb-sr-only"> (selected)</span> : null}
      </span>
    </label>
  );
}

/** A hex colour input that says, as you type, whether it reads well against `against` (AA, 4.5:1) and why not. */
export function ColourField({ label, value, onChange, against, againstLabel = "the page" }: { label: string; value: string; onChange: (hex: string) => void; against: string; againstLabel?: string }) {
  const id = useId();
  const valid = isHexColour(value);
  const ratio = valid ? contrastRatio(value, against) : null;
  const ok = ratio !== null && ratio >= AA_TEXT;
  return (
    <div className="fb-field">
      <label className="fb-label" htmlFor={id}>{label}</label>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: 8, border: "1px solid var(--border-strong)", background: valid ? value : "transparent" }} />
        <input id={id} className="fb-input" style={{ maxWidth: 140 }} value={value} aria-invalid={!valid || !ok ? true : undefined} aria-describedby={`${id}-d`} onChange={(e) => onChange(e.target.value)} />
        <span id={`${id}-d`} role="status">
          {!valid ? <Badge wrap tone="danger">Use a six-digit hex colour such as #1F7A4D</Badge> : ok ? <Badge wrap tone="success">{formatRatio(ratio!)} against {againstLabel}: readable</Badge> : <Badge wrap tone="warning">{formatRatio(ratio!)} against {againstLabel}: needs {AA_TEXT}:1</Badge>}
        </span>
      </div>
    </div>
  );
}

/** A tiny table in the chosen density, so the choice can be seen before it is saved. */
export function DensitySample({ density }: { density: "comfortable" | "compact" }) {
  return (
    <div className="fb-app-sample" data-fb-density={density} style={{ ["--fb-row-y" as string]: density === "compact" ? "6px" : "12px" }}>
      <table className="fb-table" aria-label={`Sample rows, ${density}`}>
        <tbody>
          {["Wafula Ltd", "Kamau and Sons", "Njeri Fresh"].map((n) => (
            <tr key={n}>
              <td>{n}</td>
              <td>Qualified</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** How much of the session is left, as a thin bar with the time in words (the bar is never the only signal). */
export function SessionTimerBar({ secondsLeft, totalSeconds, warn }: { secondsLeft: number; totalSeconds: number; warn?: boolean }) {
  const pct = totalSeconds > 0 ? Math.max(0, Math.min(100, (secondsLeft / totalSeconds) * 100)) : 0;
  const minutes = Math.floor(secondsLeft / 60);
  return (
    <div>
      <div className="fb-sessionbar" data-warn={warn ? "true" : undefined} role="progressbar" aria-label="Time left in this session" aria-valuemin={0} aria-valuemax={totalSeconds} aria-valuenow={secondsLeft} aria-valuetext={`${minutes} minute${minutes === 1 ? "" : "s"} left`}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <span className="fb-help">{minutes} minute{minutes === 1 ? "" : "s"} left</span>
    </div>
  );
}
