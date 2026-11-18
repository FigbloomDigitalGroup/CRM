"use client";

import { AlertTriangle, CheckCircle2, ChevronRight } from "lucide-react";
import Link from "next/link";
import { PageHead, SliceGate } from "./kit";
import { attentionItems, homeTiles, type AttentionItem } from "./logic";
import { usePlatform } from "./store";

const DOT = { orange: "var(--pl-orange)", red: "var(--pl-red)", blue: "var(--pl-blue)", purple: "var(--pl-purple)", primary: "var(--pl-primary)" } as const;

export function attentionHref(a: AttentionItem): string {
  if (a.go.page === "data-requests") return `/platform/data-requests${a.go.requestId ? `?id=${a.go.requestId}` : ""}`;
  return `/platform/${a.go.page}`;
}

/** PL1 Platform home: health and counts across organisations, read from /api/platform/home. No customer records are shown (FIG-1160). */
export function PlatformHome() {
  const { state, slices } = usePlatform();
  const attention = attentionItems(state);
  const tiles = homeTiles(state);

  return (
    <>
      <PageHead title="Platform home" release="V1.1" sub="Health, counts and requests across organisations. No customer records are shown here." />
      <SliceGate slice={slices.home} area="Platform metrics">
        <section className="fb-pl-card fb-pl-card--flush" style={{ borderRadius: 16 }} aria-label="Needs attention">
          <div className="fb-pl-attn-h" style={attention.length ? { background: "var(--pl-orange-soft)", color: "var(--pl-orange-text)" } : { background: "var(--pl-primary-soft)", color: "var(--pl-primary-text)" }}>
            {attention.length ? <AlertTriangle size={17} aria-hidden="true" /> : <CheckCircle2 size={17} aria-hidden="true" />}
            {attention.length ? `${attention.length} thing${attention.length === 1 ? "" : "s"} need${attention.length === 1 ? "s" : ""} attention` : "All systems healthy. Nothing needs attention."}
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
      </SliceGate>
    </>
  );
}
