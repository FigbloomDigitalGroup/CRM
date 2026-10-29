"use client";

import { AlertTriangle, CheckCircle2, Home, Zap } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { BrandMark } from "@/app/_shared/BrandMark";
import { DemoNotice } from "@/ui/demo/DemoBadge";
import { attentionHref } from "./Home";
import { StatusPill } from "./kit";
import { attentionItems, awaitingSecond, canApprove, dueLabel, homeTiles } from "./logic";
import { HealthTimeline } from "./HealthAudit";
import { usePlatform } from "./store";
import { VerifyDialog } from "./Verify";

export type MobileTab = "home" | "health" | "approvals";
const TITLES: Record<MobileTab, string> = { home: "Platform home", health: "Health", approvals: "Approvals" };
const DOT = { orange: "var(--pl-orange)", red: "var(--pl-red)", blue: "var(--pl-blue)", purple: "var(--pl-purple)", primary: "var(--pl-primary)" } as const;

/** PLM Platform mobile: Home, Health and Approvals at 375 px. Approving a deletion asks "Verify it's you" first (FIG-1164). */
export function PlatformMobile({ tab, signOut }: { tab: MobileTab; signOut?: ReactNode }) {
  const { state, now, dispatch } = usePlatform();
  const [verifyFor, setVerifyFor] = useState<string | null>(null);
  const orgName = (id: string) => state.orgs.find((o) => o.id === id)?.name ?? "—";
  const attention = attentionItems(state, now);
  const approvals = [
    ...state.requests.filter(awaitingSecond).map((r) => ({ key: r.id, kind: "SECOND-ADMIN APPROVAL", t: `${r.type} · ${orgName(r.org)}`, s: `${r.subject} · ${dueLabel(r.due, now)}`, can: canApprove(r, state.me).ok, id: r.id })),
    ...state.support.filter((s) => s.status === "Pending organisation approval").map((s) => ({ key: s.id, kind: "SUPPORT ACCESS · WAITING FOR ORGANISATION", t: orgName(s.org), s: s.reason, can: false, id: "" })),
  ];

  return (
    <div className="fb-pl-m" data-screen-label={`PLM Platform mobile · ${tab}`}>
      <header className="fb-pl-m-top">
        <BrandMark className="fb-pl-brand-mark" />
        <h1>{TITLES[tab]}</h1>
        <span className="fb-pl-m-pill">Platform</span>
        {signOut}
      </header>
      <div className="fb-pl-devstrip" style={{ fontSize: 11.5, padding: "6px 12px" }} role="status">Dev only: verification skipped</div>
      <main className="fb-pl-m-main">
        <DemoNotice what="Platform mobile" />
        {tab === "home" ? (
          <>
            <div className="fb-pl-m-card" style={attention.length ? { background: "var(--pl-orange-soft)", color: "var(--pl-orange-text)", fontWeight: 700, display: "flex", gap: 8, alignItems: "center" } : { background: "var(--pl-primary-soft)", color: "var(--pl-primary-text)", fontWeight: 700, display: "flex", gap: 8, alignItems: "center" }}>
              {attention.length ? <AlertTriangle size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
              {attention.length ? `${attention.length} things need attention` : "All systems healthy. Nothing needs attention."}
            </div>
            {attention.map((a) => (
              <Link key={a.key} href={a.mobileTab === "health" ? "/platform/m/health" : "/platform/m/approvals"} className="fb-pl-m-card" style={{ display: "flex", gap: 10, alignItems: "center" }} data-desktop={attentionHref(a)}>
                <span className="fb-pl-dot" style={{ background: DOT[a.dot] }} />
                <span style={{ flex: 1 }}>
                  <span style={{ display: "block", fontWeight: 600, fontSize: 14 }}>{a.title}</span>
                  <span className="fb-pl-muted fb-pl-small" style={{ display: "block" }}>{a.sub}</span>
                </span>
              </Link>
            ))}
            <div className="fb-pl-m-tiles">
              {homeTiles(state).map((t) => (
                <div key={t.key} className="fb-pl-m-card">
                  <div style={{ fontSize: 20, fontWeight: 700, color: t.warn ? "var(--pl-orange-text)" : undefined }}>{t.v}</div>
                  <div className="fb-pl-muted2 fb-pl-small" style={{ lineHeight: 1.3 }}>{t.l}</div>
                </div>
              ))}
            </div>
          </>
        ) : null}

        {tab === "health" ? state.health.map((c) => (
          <div key={c.k} className="fb-pl-m-card">
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <strong style={{ flex: 1, fontSize: 14 }}>{c.l}</strong>
              <StatusPill status={c.status} />
            </div>
            <div className="fb-pl-muted2 fb-pl-small" style={{ marginTop: 4 }}>{c.d}</div>
            <div style={{ marginTop: 8 }}><HealthTimeline c={c} /></div>
          </div>
        )) : null}

        {tab === "approvals" ? (
          <>
            {approvals.map((r) => (
              <div key={r.key} className="fb-pl-m-card" style={{ padding: 14 }}>
                <div className="fb-pl-mono fb-pl-muted" style={{ fontSize: 10.5 }}>{r.kind}</div>
                <div style={{ fontWeight: 700, fontSize: 15, marginTop: 3 }}>{r.t}</div>
                <div className="fb-pl-muted2" style={{ fontSize: 13, marginTop: 3 }}>{r.s}</div>
                {r.can ? (
                  <button type="button" className="fb-pl-btn fb-pl-btn--primary fb-pl-btn--block fb-pl-btn--tall" style={{ marginTop: 10 }} onClick={() => setVerifyFor(r.id)}>Approve deletion</button>
                ) : r.id ? (
                  <div className="fb-pl-muted fb-pl-small" style={{ marginTop: 8 }}>You already approved this. A different admin must approve it.</div>
                ) : null}
              </div>
            ))}
            {!approvals.length ? <div className="fb-pl-muted2" style={{ padding: 24, textAlign: "center" }}>Nothing waiting for your approval.</div> : null}
          </>
        ) : null}
      </main>
      <nav className="fb-pl-m-nav" aria-label="Platform mobile">
        {([["home", "Home", Home, "/platform/m"], ["health", "Health", Zap, "/platform/m/health"], ["approvals", "Approvals", CheckCircle2, "/platform/m/approvals"]] as const).map(([id, label, Icon, href]) => (
          <Link key={id} href={href} aria-current={tab === id ? "page" : undefined}>
            <Icon size={21} aria-hidden="true" />
            {label}
          </Link>
        ))}
      </nav>
      <VerifyDialog open={verifyFor !== null} onClose={() => setVerifyFor(null)} action="Approving a deletion" onVerified={() => verifyFor && dispatch({ type: "request-approve", id: verifyFor })} />
    </div>
  );
}
