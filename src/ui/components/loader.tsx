"use client";

import { useEffect, useState } from "react";
import "./loader.css";

/**
 * The Figbloom "Orbit" loader (from bloomHR): the logo's ring sweeps round (accent to orange) while the leaf folds away
 * and springs back. It is the one loading indicator of the app: a whole screen while the app or a page's code loads
 * (`fullScreen`), the middle of a page's content area (`LoaderBlock`), or a small version inside a card or a table
 * while its data arrives (`compact`). Its animation lives in `ui.css` (.fb-loader…) and stands still for people who
 * ask for reduced motion.
 *
 * Loaders often follow one another (a page's code arrives, then the page loads its data), so they don't restart:
 * every loader runs on the same clock, so the next one carries on where the last left off; and one that comes right
 * after another shows at once, while a first one fades in after a moment, so a quick load shows none.
 */

const CYCLE_MS = 2200; // the length of the animation in ui.css
const FOLLOW_ON_MS = 600; // a loader within this long of another carries straight on
let shown = 0;
let lastHiddenAt = -Infinity;
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

function useLoaderTiming() {
  const [timing] = useState(() => {
    const t = now();
    return { phase: -(t % CYCLE_MS), followsOn: shown > 0 || t - lastHiddenAt < FOLLOW_ON_MS };
  });
  useEffect(() => {
    shown += 1;
    return () => {
      shown -= 1;
      lastHiddenAt = now();
    };
  }, []);
  return timing;
}

export interface FigbloomLoaderProps {
  /** what is loading: read by screen readers and shown under the logo */
  label?: string;
  /** cover the whole screen (while the app or a page loads) */
  fullScreen?: boolean;
  /** a small logo and label, for a card or a part of a page */
  compact?: boolean;
  /** width and height of the logo, in px */
  size?: number;
}

export function FigbloomLoader({ label = "Getting things ready", fullScreen = false, compact = false, size = compact ? 48 : 112 }: FigbloomLoaderProps) {
  const { phase, followsOn } = useLoaderTiming();
  const className = ["fb-loader", compact && "fb-loader--compact", !followsOn && "fb-loader--fade-in"].filter(Boolean).join(" ");
  const loader = (
    <div className={className} role="status" aria-live="polite" aria-busy="true" aria-label={label} suppressHydrationWarning style={{ ["--fb-phase" as string]: `${phase}ms` }}>
      <svg viewBox="8 5 48 48" aria-hidden="true" focusable="false" style={{ width: size, height: size }}>
        <circle className="fb-arc" cx="32" cy="29" r="19" pathLength={360} fill="none" strokeWidth="5.5" strokeLinecap="round" />
        <circle className="fb-bowl" cx="32" cy="29" r="9" fill="none" strokeWidth="6.5" />
        <path className="fb-leaf" d="M33 14.5 C33 8.5 38 5.5 43 5.5 C43 11.5 39 14.5 33 14.5 Z" />
      </svg>
      <div className="fb-loader__text">
        {label}
        <span className="fb-loader__dot">.</span>
        <span className="fb-loader__dot">.</span>
        <span className="fb-loader__dot">.</span>
      </div>
    </div>
  );
  return fullScreen ? <div className="fb-loader-screen">{loader}</div> : loader;
}

/**
 * The loader centred in the space a page or a card would fill: a page's content area (the default), or a card or a
 * part of a page (`compact`). Use it where grey placeholder blocks used to stand.
 */
export function LoaderBlock({ label = "Loading", compact = false }: { label?: string; compact?: boolean }) {
  return (
    <div className={compact ? "fb-loader-block fb-loader-block--compact" : "fb-loader-block"}>
      <FigbloomLoader label={label} compact={compact} />
    </div>
  );
}
