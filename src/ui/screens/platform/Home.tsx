"use client";

import { AlertTriangle, CheckCircle2, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PageHead } from "./kit";
import { attentionItems, barHeights, homeTiles, TRENDS, type AttentionItem } from "./logic";
import { usePlatform } from "./store";

type HomeState = "ok" | "healthy" | "degraded" | "loading" | "error";
const STATES: [HomeState, string][] = [["ok", "Live"], ["healthy", "All healthy"], ["degraded", "Degraded"], ["loading", "Loading"], ["error", "Error"]];

const DOT = { orange: "var(--pl-orange)", red: "var(--pl-red)", blue: "var(--pl-blue)", purple: "var(--pl-purple)", primary: "var(--pl-primary)" } as const;

export function attentionHref(a: AttentionItem): string {
  if (a.go.page === "data-requests") return `/platform/data-requests${a.go.requestId ? `?id=${a.go.requestId}` : ""}`;
  return `/platform/${a.go.page}`;
}

/** PL1 Platform home: health and counts across organisations. No customer records are shown (FIG-1160). */
export function PlatformHome() {
  const { state, now } = usePlatform();
  const [view, setView] = useState<HomeState>("ok");
  const attention = view === "healthy" ? [] : attentionItems(state, now);
  const tiles = homeTiles(state);

  return (
    <>
      <PageHead title="Platform home" release="V1.1" sub="Health, counts and requests across organisations. No customer records are shown here.">
        <div className="fb-pl-seg" role="group" aria-label="State of this page">
          {STATES.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)}>
              {label}
            </button>
          ))}
        </div>
      </PageHead>
      

      {view === "loading" ? (
        <div className="fb-pl-tiles" role="status" aria-label="Loading platform metrics">
          {[1, 2, 3, 4].map((k) => (
            <div key={k} className="fb-pl-skel" />
          ))}
        </div>
      ) : null}

      {view === "error" ? (
        <div role="alert" className="fb-pl-errbox">
          <div style={{ color: "var(--pl-red)", display: "flex", justifyContent: "center" }}>
            <AlertTriangle size={24} aria-hidden="true" />
          </div>
          <div style={{ fontWeight: 700, marginTop: 8 }}>Platform metrics didn’t load</div>
          <div className="fb-pl-sub">Organisations keep working; only this console is affected.</div>
          <button type="button" className="fb-pl-btn fb-pl-btn--primary" style={{ marginTop: 12, height: 38 }} onClick={() => setView("ok")}>
            Retry
          </button>
        </div>
      ) : null}

      {view !== "loading" && view !== "error" ? (
        <>
          <section className="fb-pl-card fb-pl-card--flush" style={{ borderRadius: 16 }} aria-label="Needs attention">
            <div className="fb-pl-attn-h" style={attention.length ? { background: "var(--pl-orange-soft)", color: "var(--pl-orange-text)" } : { background: "var(--pl-primary-soft)", color: "var(--pl-primary-text)" }}>
              {attention.length ? <AlertTriangle size={17} aria-hidden="true" /> : <CheckCircle2 size={17} aria-hidden="true" />}
              {attention.length ? `${attention.length} things need attention` : "All systems healthy. Nothing needs attention."}
            </div>
            {attention.map((a) => (
              <Link key={a.key} href={attentionHref(a)} className="fb-pl-attn-item">
                <span className="fb-pl-dot" style={{ background: DOT[a.dot] }} />
                <span style={{ flex: 1 }}>
                  <strong>{a.title}</strong>
                  <span className="fb-pl-attn-sub">{a.sub}</span>
                </span>
                <ChevronRight size={15} aria-hidden="true" />
              </Link>
            ))}
          </section>

          <div className="fb-pl-tiles">
            {tiles.map((t) => (
              <Link key={t.key} href={`/platform/${t.go}`} className="fb-pl-tile">
                <div className="fb-pl-tile-l">
                  <span className="fb-pl-dot" style={{ width: 7, height: 7, background: DOT[t.dot as keyof typeof DOT] }} />
                  {t.l}
                </div>
                <div className="fb-pl-tile-v" style={t.warn ? { color: "var(--pl-orange-text)" } : undefined}>{t.v}</div>
                <div className="fb-pl-tile-sub">{t.sub}</div>
              </Link>
            ))}
          </div>

          <section className="fb-pl-card fb-pl-card--lg" aria-label="Trends">
            <h2 style={{ fontSize: 16 }}>Trends · last 8 days</h2>
            <div className="fb-pl-trends">
              {TRENDS.map((t) => (
                <div key={t.l}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span className="fb-pl-muted2">{t.l}</span>
                    <strong>{t.now}</strong>
                  </div>
                  <div className="fb-pl-bars" role="img" aria-label={`${t.l}, last 8 days: ${t.values.join(", ")}`}>
                    {barHeights(t.values).map((h, i) => (
                      <div key={i} style={{ height: `${h}%` }} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </>
  );
}
