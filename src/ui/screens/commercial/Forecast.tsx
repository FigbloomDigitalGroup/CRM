"use client";

import Link from "next/link";
import { useState } from "react";
import { MaskedValue, NoAccess, ReleaseTag, useMember } from "@/ui";
import { DemoNotice } from "../../demo/DemoBadge";
import { deals, DEMO_NOW } from "./demo/data";
import { setTarget, useDemoStore } from "./demo/store";
import { isOpen, monthBuckets, probabilityOf, targetProgress, weightedValue } from "./forecastMath";
import { formatKes, formatKesShort } from "./quoteMath";

/**
 * Forecast and targets (Q4, FIG-1170; design-spec/CrmGrowth.dc.html). An estimate from stage probabilities, never a commitment. "My forecast" is
 * the member's own deals; "Team" needs `forecast.view.all`. Targets are edited only with `targets.manage`; everyone else reads them.
 *
 * Masking: a deal's value is shown to its owner or with `deals.view.value`; every total over other people's deals needs `deals.view.value`.
 * The chart always has a table beside it (the "chart or table" switch) and a text description, so it never depends on colour or sight.
 * Demo data until B6.14 is wired.
 */

const MONTHS: (readonly [number, string])[] = [[9, "OCT"], [10, "NOV"], [11, "DEC"], [0, "JAN"]];
const NOW = new Date(DEMO_NOW);

export function Forecast() {
  const { orgSlug, can, canAny, userName, roleName } = useMember();
  const store = useDemoStore();
  const [mode, setMode] = useState<"mine" | "team">("team");
  const [view, setView] = useState<"chart" | "table">("chart");

  const all = can("forecast.view.all");
  if (!all && !canAny("reporting.view.own", "reporting.view.all", "deals.view.own")) {
    return <NoAccess area="Forecast" denial={{ yourRole: roleName, ownerRoles: ["Management", "Sales"], whoToAsk: ["Management"] }} />;
  }

  const current = all ? mode : "mine";
  const seesValues = can("deals.view.value");
  const mayEditTargets = can("targets.manage");
  const mine = (owner: string) => owner === userName;
  const valueVisible = (owner: string) => seesValues || mine(owner);
  const inScope = (owner: string) => current === "team" || mine(owner);

  // Totals are only built from deals whose value the viewer may see, so a total can never reveal a masked one.
  const open = deals.filter((d) => isOpen(d) && inScope(d.owner) && valueVisible(d.owner));
  const won = deals.filter((d) => d.stage === "Closed Won" && d.wonAt && new Date(d.wonAt).getMonth() === NOW.getMonth() && inScope(d.owner) && valueVisible(d.owner));
  const months = monthBuckets(open, MONTHS);
  const maxFull = Math.max(1, ...months.map((m) => m.full));
  const weightedTotal = open.reduce((a, d) => a + weightedValue(d), 0);
  const wonTotal = won.reduce((a, d) => a + d.value, 0);

  const people = (current === "team" ? Object.keys(store.targets) : [userName]).filter((p) => current !== "team" || store.targets[p] != null);
  const targetTotal = people.reduce((a, p) => a + (store.targets[p] ?? 0), 0);
  const gap = Math.max(0, targetTotal - wonTotal - (months[0]?.weighted ?? 0));
  const sub = `${current === "team" ? "Whole team" : "Your own deals"}. A forecast is an estimate from stage probabilities, not a commitment.`;
  const summary = `Weighted closes: ${months.map((m) => `${m.label} ${formatKesShort(m.weighted)}`).join(", ")}`;

  const kpis = [
    { label: "Won in October", value: formatKesShort(wonTotal), sub: `${won.length} deal${won.length === 1 ? "" : "s"}`, tone: "green" },
    { label: "Weighted pipeline", value: formatKesShort(weightedTotal), sub: `${open.length} open deal${open.length === 1 ? "" : "s"}`, tone: "orange" },
    { label: "Target", value: targetTotal ? formatKesShort(targetTotal) : "Not set", sub: targetTotal ? `${Math.round((wonTotal / targetTotal) * 100)}% reached so far` : "Management sets targets", tone: "blue" },
    { label: "Gap to target", value: targetTotal ? formatKesShort(gap) : "—", sub: "after this month’s weighted closes", tone: "red" },
  ];

  return (
    <div className="fb-com" data-screen-label="Forecast and targets">
      <DemoNotice what="The forecast" />
      <header className="fb-com-head">
        <div>
          <div className="fb-com-titlerow">
            <h1 className="fb-com__title">Forecast &amp; targets</h1>
            <ReleaseTag release="v1.1" />
          </div>
          <p className="fb-com__sub">{sub}</p>
        </div>
        <div className="fb-com-actions">
          {all ? (
            <div role="group" aria-label="Whose forecast" className="fb-com-seg">
              {(["mine", "team"] as const).map((m) => (
                <button key={m} type="button" aria-pressed={current === m} onClick={() => setMode(m)}>{m === "mine" ? "My forecast" : "Team"}</button>
              ))}
            </div>
          ) : null}
          <div role="group" aria-label="Show as" className="fb-com-seg">
            {(["chart", "table"] as const).map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>{v === "chart" ? "Chart" : "Table"}</button>
            ))}
          </div>
        </div>
      </header>

      <div className="fb-com-kpis">
        {kpis.map((k) => (
          <div key={k.label} className="fb-com-card fb-com-kpi">
            <div className="fb-com-eyebrow"><span className={`fb-com-dot fb-com-dot--${k.tone}`} aria-hidden="true" /> {k.label}</div>
            <div className="fb-com-kpi__value">{k.value}</div>
            <div className="fb-com-muted">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="fb-com-cols fb-com-cols--even">
        <section className="fb-com-card">
          <h2>Expected closes by month</h2>
          <p className="fb-com-muted">Weighted by stage: Solution Presented 25% · Proposal Sent 50% · Negotiation 75%</p>
          {view === "chart" ? (
            <>
              <div className="fb-com-bars" role="img" aria-label={summary}>
                {months.map((m) => (
                  <div key={m.label} className="fb-com-bar">
                    <span className="fb-com-bar__v">{formatKesShort(m.weighted)}</span>
                    <div className="fb-com-bar__full" style={{ height: `${Math.max(4, (m.full / maxFull) * 100)}%` }}>
                      <div className="fb-com-bar__weighted" style={{ height: `${m.full ? (m.weighted / m.full) * 100 : 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="fb-com-bars__axis" aria-hidden="true">{months.map((m) => <div key={m.label}>{m.label}</div>)}</div>
              <p className="fb-com-legend"><span><i className="fb-com-key fb-com-key--w" /> Weighted</span><span><i className="fb-com-key fb-com-key--f" /> Full value if all close</span></p>
            </>
          ) : (
            <table className="fb-com-table">
              <caption className="fb-sr-only">Expected closes by month</caption>
              <thead><tr><th scope="col">Month</th><th scope="col" className="fb-com-num">Weighted</th><th scope="col" className="fb-com-num">Full value</th></tr></thead>
              <tbody>{months.map((m) => <tr key={m.label}><th scope="row">{m.label}</th><td className="fb-com-num">{formatKes(m.weighted)}</td><td className="fb-com-num">{formatKes(m.full)}</td></tr>)}</tbody>
            </table>
          )}
        </section>

        <section className="fb-com-card">
          <div className="fb-com-card__head">
            <h2>Targets · October</h2>
            {mayEditTargets ? <span className="fb-com-muted">Edit a target to change it</span> : null}
          </div>
          <div className="fb-com-targets">
            {people.map((p) => {
              const target = store.targets[p] ?? 0;
              const ownWon = deals.filter((d) => d.stage === "Closed Won" && d.owner === p && d.wonAt && new Date(d.wonAt).getMonth() === NOW.getMonth()).reduce((a, d) => a + d.value, 0);
              const f = deals.filter((d) => d.owner === p && isOpen(d) && new Date(d.close).getMonth() === NOW.getMonth()).reduce((a, d) => a + weightedValue(d), 0);
              const prog = targetProgress(ownWon, f, target);
              const visible = valueVisible(p);
              const wonPct = target ? Math.min(100, (ownWon / target) * 100) : 0;
              const fcPct = target ? Math.min(100 - wonPct, (f / target) * 100) : 0;
              const note = prog.state === "no-target" ? "Ask Management to set a target" : prog.state === "on-track" ? "On track if this month’s deals close" : `${formatKesShort(prog.shortBy)} short even if this month’s deals close`;
              return (
                <div key={p} className="fb-com-target">
                  <div className="fb-com-target__row">
                    <span className="fb-com-strong">{p}</span>
                    {visible ? (
                      <span>
                        {formatKesShort(ownWon)} of{" "}
                        {mayEditTargets ? (
                          <input className="fb-input fb-com-targetinput" type="number" min={0} value={target} aria-label={`Target for ${p}`} onChange={(e) => setTarget(p, Number(e.target.value))} />
                        ) : (
                          <strong>{target ? formatKesShort(target) : "no target"}</strong>
                        )}
                      </span>
                    ) : (
                      <MaskedValue />
                    )}
                  </div>
                  {visible ? (
                    <div className="fb-com-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(wonPct)} aria-label={`${p} won against target`}>
                      <div className="fb-com-progress__won" style={{ width: `${wonPct}%` }} />
                      <div className="fb-com-progress__fc" style={{ width: `${fcPct}%` }} />
                    </div>
                  ) : null}
                  <div className={`fb-com-muted${prog.state === "short" ? " fb-com-bad" : ""}`}>{visible ? note : "You can’t see this person’s figures."}</div>
                </div>
              );
            })}
          </div>
          <p className="fb-com-legend"><span><i className="fb-com-key fb-com-key--won" /> Won</span><span><i className="fb-com-key fb-com-key--w" /> Weighted forecast</span></p>
        </section>
      </div>

      <section className="fb-com-card">
        <h2>Deals in the forecast</h2>
        <p className="fb-com-muted">Probability comes from the stage. Override it on the deal if you know better; overrides are shown.</p>
        <div className="fb-com-tablewrap">
          <table className="fb-com-table">
            <thead>
              <tr>
                <th scope="col">Deal</th><th scope="col">Stage</th><th scope="col">Owner</th><th scope="col">Expected close</th>
                <th scope="col" className="fb-com-num">Value</th><th scope="col" className="fb-com-num">Probability</th><th scope="col" className="fb-com-num">Weighted</th>
              </tr>
            </thead>
            <tbody>
              {deals
                .filter((d) => isOpen(d) && inScope(d.owner))
                .sort((a, b) => a.close.localeCompare(b.close))
                .map((d) => {
                  const show = valueVisible(d.owner);
                  const passed = new Date(d.close) < NOW;
                  return (
                    <tr key={d.id}>
                      <td>
                        <Link href={`/o/${orgSlug}/quotes/${d.id}`} className="fb-com-linkbtn">{d.company}</Link>
                        <div className="fb-com-muted">{d.title}</div>
                      </td>
                      <td>{d.stage}</td>
                      <td>{d.owner}</td>
                      <td className={passed ? "fb-com-bad" : undefined}>
                        {new Date(d.close).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}
                        {passed ? <span className="fb-com-muted fb-com-bad"> · close date passed</span> : null}
                      </td>
                      <td className="fb-com-num">{show ? formatKes(d.value) : <MaskedValue />}</td>
                      <td className="fb-com-num">{Math.round(probabilityOf(d) * 100)}%{d.prob != null ? " (override)" : ""}</td>
                      <td className="fb-com-num">{show ? formatKes(weightedValue(d)) : <MaskedValue />}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        {!seesValues ? <p className="fb-com-muted">Values on deals you don’t own are hidden for your role.</p> : null}
      </section>
    </div>
  );
}
