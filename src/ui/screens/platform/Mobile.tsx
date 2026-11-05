"use client";

import { AlertTriangle, CheckCircle2, Home, Zap } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { BrandMark } from "@/app/_shared/BrandMark";
import { attentionHref } from "./Home";
import { useHealth } from "./HealthAudit";
import { SliceGate, StatusPill, whenLabel } from "./kit";
import { attentionItems, awaitingApproval, canApprove, homeTiles } from "./logic";
import { usePlatform } from "./store";

export type MobileTab = "home" | "health" | "approvals";
const TITLES: Record<MobileTab, string> = { home: "Platform home", health: "Health", approvals: "Approvals" };
const DOT = { orange: "var(--pl-orange)", red: "var(--pl-red)", blue: "var(--pl-blue)", purple: "var(--pl-purple)", primary: "var(--pl-primary)" } as const;

/** PLM Platform mobile: Home, Health and Approvals at 375 px, on the same platform API as the desktop console. Approving asks "Verify it's you" when the last check is old (FIG-1164). */
export function PlatformMobile({ tab, signOut }: { tab: MobileTab; signOut?: ReactNode }) {
  const { state, now, actions, slices } = usePlatform();
  const health = useHealth();
  const [busy, setBusy] = useState<string | null>(null);
  const attention = attentionItems(state);
  const approvals = state.requests.filter(awaitingApproval).map((r) => ({
    key: r.id,
    kind: r.approvalsRequired > 1 ? "SECOND-ADMIN APPROVAL" : "APPROVAL",
    t: `${r.type} · ${r.orgName}`,
    s: `${r.subject} · received ${r.received.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`,
    can: canApprove(r, state.me).ok,
    id: r.id,
    label: r.kind === "offboard" ? "Approve deletion" : "Approve export",
  }));

  return (
    <div className="fb-pl-m" data-screen-label={`PLM Platform mobile · ${tab}`}>
      <header className="fb-pl-m-top">
        <BrandMark className="fb-pl-brand-mark" />
        <h1>{TITLES[tab]}</h1>
        <span className="fb-pl-m-pill">Platform</span>
        {signOut}
      </header>
      <main className="fb-pl-m-main">
        {tab === "home" ? (
          <SliceGate slice={slices.home} area="Platform metrics">
            <div className="fb-pl-m-card" style={attention.length ? { background: "var(--pl-orange-soft)", color: "var(--pl-orange-text)", fontWeight: 700, display: "flex", gap: 8, alignItems: "center" } : { background: "var(--pl-primary-soft)", color: "var(--pl-primary-text)", fontWeight: 700, display: "flex", gap: 8, alignItems: "center" }}>
              {attention.length ? <AlertTriangle size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
              {attention.length ? `${attention.length} thing${attention.length === 1 ? "" : "s"} need${attention.length === 1 ? "s" : ""} attention` : "All systems healthy. Nothing needs attention."}
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
          </SliceGate>
        ) : null}

        {tab === "health" ? (
          <SliceGate slice={health.slice} area="System health">
            {health.data?.components.map((c) => (
              <div key={c.k} className="fb-pl-m-card">
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <strong style={{ flex: 1, fontSize: 14 }}>{c.l}</strong>
                  <StatusPill status={c.status} />
                </div>
                <div className="fb-pl-muted2 fb-pl-small" style={{ marginTop: 4 }}>{c.d}</div>
                <div className="fb-pl-muted fb-pl-small" style={{ marginTop: 6 }}>Checked {whenLabel(c.checkedAt, now)}</div>
              </div>
            ))}
            {health.data?.incidents.map((i) => (
              <div key={i.id} className="fb-pl-m-card">
                <div className="fb-pl-mono fb-pl-muted" style={{ fontSize: 10.5 }}>OPEN INCIDENT · {i.component}</div>
                <div style={{ fontWeight: 700, fontSize: 14, marginTop: 3 }}>{i.title}</div>
              </div>
            ))}
          </SliceGate>
        ) : null}

        {tab === "approvals" ? (
          <SliceGate slice={slices.requests} area="Approvals">
            {approvals.map((r) => (
              <div key={r.key} className="fb-pl-m-card" style={{ padding: 14 }}>
                <div className="fb-pl-mono fb-pl-muted" style={{ fontSize: 10.5 }}>{r.kind}</div>
                <div style={{ fontWeight: 700, fontSize: 15, marginTop: 3 }}>{r.t}</div>
                <div className="fb-pl-muted2" style={{ fontSize: 13, marginTop: 3 }}>{r.s}</div>
                {r.can ? (
                  <button
                    type="button"
                    className="fb-pl-btn fb-pl-btn--primary fb-pl-btn--block fb-pl-btn--tall"
                    style={{ marginTop: 10 }}
                    disabled={busy === r.id}
                    onClick={async () => {
                      setBusy(r.id);
                      await actions.decide(r.id, "APPROVE");
                      setBusy(null);
                    }}
                  >
                    {r.label}
                  </button>
                ) : (
                  <div className="fb-pl-muted fb-pl-small" style={{ marginTop: 8 }}>You already approved this. A different admin must approve it.</div>
                )}
              </div>
            ))}
            {!approvals.length ? <div className="fb-pl-muted2" style={{ padding: 24, textAlign: "center" }}>Nothing waiting for your approval.</div> : null}
          </SliceGate>
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
    </div>
  );
}
