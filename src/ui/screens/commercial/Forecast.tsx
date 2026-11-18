"use client";

import Link from "next/link";
import { useState } from "react";
import { LoadingState, MaskedValue, NoAccess, ReleaseTag, useApiMutation, useApiQuery, useMember, useToast } from "@/ui";
import { describeError } from "../../errors";
import { QueryFailure } from "../../featureUnavailable";
import { useAllDeals, useMemberName } from "../deals/data";
import type { DealItem } from "../deals/model";
import { monthName, targetNote, weightedOf, type ForecastPerson, type ForecastResponse } from "./forecastMath";
import { formatKes, formatKesShort } from "./quoteMath";

/**
 * Forecast and targets (Q4, FIG-1170; design-spec/CrmGrowth.dc.html), wired to `GET /api/orgs/{org}/forecast` and `/forecast/targets` (B6.14,
 * docs/FORECAST.md). An estimate from stage probabilities, never a commitment. "My forecast" is the member's own deals; "Team" needs
 * `forecast.view.all`. Targets are edited only with `targets.manage`; everyone else reads them.
 *
 * Masking: the API decides. A caller without `deals.view.value` gets counts and `null` money for other people's deals (`valueMasked`), and the
 * screen renders exactly that: no total is ever worked out here. The chart always has a table beside it (the "chart or table" switch) and a text
 * description, so it never depends on colour or sight.
 */

export function Forecast() {
  const { orgSlug, can, canAny, roleName } = useMember();
  const [mode, setMode] = useState<"mine" | "team">("team");
  const [view, setView] = useState<"chart" | "table">("chart");

  const all = can("forecast.view.all");
  const allowed = all || canAny("reporting.view.own", "reporting.view.all", "deals.view.own");
  const current = all ? mode : "mine";
  const q = useApiQuery("getForecast", { params: { orgSlug }, query: { scope: current } } as never, { enabled: allowed });

  if (!allowed) {
    return <NoAccess area="Forecast" denial={{ yourRole: roleName, ownerRoles: ["Management", "Sales"], whoToAsk: ["Management"] }} />;
  }
  if (q.isLoading) return <div className="fb-com" data-screen-label="Forecast and targets"><LoadingState label="Loading the forecast" lines={6} /></div>;
  if (q.error || !q.data) return <div className="fb-com" data-screen-label="Forecast and targets"><QueryFailure error={q.error} area="Forecast" onRetry={() => void q.refetch()} /></div>;
  return <ForecastBody data={q.data as unknown as ForecastResponse} current={current} all={all} setMode={setMode} view={view} setView={setView} orgSlug={orgSlug} />;
}

function ForecastBody({ data, current, all, setMode, view, setView, orgSlug }: { data: ForecastResponse; current: "mine" | "team"; all: boolean; setMode: (m: "mine" | "team") => void; view: "chart" | "table"; setView: (v: "chart" | "table") => void; orgSlug: string }) {
  const { can, membershipId } = useMember();
  const mayEditTargets = can("targets.manage");
  const masked = data.valueMasked;
  const month = monthName(data.month);
  const months = data.buckets;
  const metric = (m: { count: number; full: number | null; weighted: number | null }) => ({ full: masked ? m.count : (m.full ?? 0), weighted: masked ? m.count : (m.weighted ?? 0) });
  const maxFull = Math.max(1, ...months.map((m) => metric(m).full));
  const barLabel = (m: (typeof months)[number]) => (masked ? `${m.count} deal${m.count === 1 ? "" : "s"}` : formatKesShort(m.weighted ?? 0));

  const self = data.people.find((p) => p.membershipId === membershipId);
  const headline = current === "team" ? data.team : self ?? null;
  const target = headline?.target ?? null;
  const sub = `${current === "team" ? "Whole team" : "Your own deals"}. A forecast is an estimate from stage probabilities, not a commitment.`;
  const summary = `Weighted closes: ${months.map((m) => `${monthName(m.month, true)} ${barLabel(m)}`).join(", ")}`;
  const probabilities = data.stages.filter((s) => s.probabilitySet && s.probability > 0).map((s) => `${s.name} ${s.probability}%`).join(" · ");

  const kpis: { label: string; value: number | string | null; sub: string; tone: string }[] = [
    { label: `Won in ${month}`, value: data.won.total, sub: `${data.won.count} deal${data.won.count === 1 ? "" : "s"}`, tone: "green" },
    { label: "Weighted pipeline", value: data.pipeline.weighted, sub: `${data.pipeline.count} open deal${data.pipeline.count === 1 ? "" : "s"}`, tone: "orange" },
    {
      label: "Target",
      value: target ? target : "Not set",
      sub: target ? (headline?.attainmentPercent == null ? "Progress is hidden for your role" : `${headline.attainmentPercent}% reached so far`) : "Management sets targets",
      tone: "blue",
    },
    { label: "Gap to target", value: target && headline?.shortBy != null ? headline.shortBy : "—", sub: "after this month’s weighted closes", tone: "red" },
  ];
  const show = (v: number | string | null) => (v === null ? <MaskedValue /> : typeof v === "number" ? formatKesShort(v) : v);

  return (
    <div className="fb-com" data-screen-label="Forecast and targets">
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
            <div className="fb-com-kpi__value">{show(k.value)}</div>
            <div className="fb-com-muted">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="fb-com-cols fb-com-cols--even">
        <section className="fb-com-card">
          <h2>Expected closes by month</h2>
          <p className="fb-com-muted">Weighted by stage{probabilities ? `: ${probabilities}` : ""}</p>
          {masked ? <p className="fb-com-muted">Deal values are hidden for your role, so the months show the number of deals.</p> : null}
          {view === "chart" ? (
            <>
              <div className="fb-com-bars" role="img" aria-label={summary}>
                {months.map((m) => {
                  const v = metric(m);
                  return (
                    <div key={m.month} className="fb-com-bar">
                      <span className="fb-com-bar__v">{barLabel(m)}</span>
                      <div className="fb-com-bar__full" style={{ height: `${Math.max(4, (v.full / maxFull) * 100)}%` }}>
                        <div className="fb-com-bar__weighted" style={{ height: `${v.full ? (v.weighted / v.full) * 100 : 0}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="fb-com-bars__axis" aria-hidden="true">{months.map((m) => <div key={m.month}>{monthName(m.month, true)}</div>)}</div>
              <p className="fb-com-legend"><span><i className="fb-com-key fb-com-key--w" /> Weighted</span><span><i className="fb-com-key fb-com-key--f" /> Full value if all close</span></p>
            </>
          ) : (
            <table className="fb-com-table">
              <caption className="fb-sr-only">Expected closes by month</caption>
              <thead><tr><th scope="col">Month</th><th scope="col" className="fb-com-num">Deals</th><th scope="col" className="fb-com-num">Weighted</th><th scope="col" className="fb-com-num">Full value</th></tr></thead>
              <tbody>
                {[
                  ...(data.earlier.count ? [{ key: "earlier", label: "Earlier (close date passed)", m: data.earlier }] : []),
                  ...months.map((m) => ({ key: m.month, label: monthName(m.month, true), m })),
                  ...(data.later.count ? [{ key: "later", label: "Later", m: data.later }] : []),
                  ...(data.unscheduled.count ? [{ key: "unscheduled", label: "No close date", m: data.unscheduled }] : []),
                ].map((r) => (
                  <tr key={r.key}>
                    <th scope="row">{r.label}</th>
                    <td className="fb-com-num">{r.m.count}</td>
                    <td className="fb-com-num">{r.m.weighted === null ? <MaskedValue /> : formatKes(r.m.weighted)}</td>
                    <td className="fb-com-num">{r.m.full === null ? <MaskedValue /> : formatKes(r.m.full)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <TargetsCard data={data} mayEdit={mayEditTargets && current === "team"} />
      </div>

      <DealsInForecast data={data} current={current} orgSlug={orgSlug} />
    </div>
  );
}

function TargetsCard({ data, mayEdit }: { data: ForecastResponse; mayEdit: boolean }) {
  return (
    <section className="fb-com-card">
      <div className="fb-com-card__head">
        <h2>Targets · {monthName(data.month)}</h2>
        {mayEdit ? <span className="fb-com-muted">Edit a target to change it</span> : null}
      </div>
      <div className="fb-com-targets">
        {data.people.length === 0 ? <p className="fb-com-muted">No one has a target or a deal this month yet.</p> : null}
        {data.people.map((p) => <TargetRow key={p.membershipId} person={p} month={data.month} mayEdit={mayEdit} />)}
      </div>
      <p className="fb-com-legend"><span><i className="fb-com-key fb-com-key--won" /> Won</span><span><i className="fb-com-key fb-com-key--w" /> Weighted forecast</span></p>
    </section>
  );
}

function TargetRow({ person: p, month, mayEdit }: { person: ForecastPerson; month: string; mayEdit: boolean }) {
  const { orgSlug } = useMember();
  const toast = useToast();
  const save = useApiMutation("putForecastTargets", {
    invalidate: [["getForecast"], ["getForecastTargets"]],
    onSuccess: () => toast.show({ message: `Target saved for ${p.name}`, tone: "success" }),
    onError: (e) => toast.show({ message: describeError(e).body, tone: "danger" }),
  });
  const [draft, setDraft] = useState<string | null>(null);
  const visible = p.state !== "masked";
  const target = p.target ?? 0;
  const won = p.won ?? 0;
  const wonPct = target ? Math.min(100, (won / target) * 100) : 0;
  const fcPct = target ? Math.min(100 - wonPct, ((p.weighted ?? 0) / target) * 100) : 0;
  const commit = () => {
    if (draft === null) return;
    const amount = draft.trim() === "" ? null : Number(draft);
    setDraft(null);
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) return toast.show({ message: "A target is an amount of 0 or more.", tone: "danger" });
    if (amount === (p.target ?? null)) return;
    save.mutate({ params: { orgSlug }, body: { month, membershipId: p.membershipId, amount } } as never);
  };
  return (
    <div className="fb-com-target">
      <div className="fb-com-target__row">
        <span className="fb-com-strong">{p.name}</span>
        {visible ? (
          <span>
            {formatKesShort(won)} of{" "}
            {mayEdit ? (
              <input
                className="fb-input fb-com-targetinput"
                type="number"
                min={0}
                value={draft ?? String(target)}
                aria-label={`Target for ${p.name}`}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit();
                }}
              />
            ) : (
              <strong>{target ? formatKesShort(target) : "no target"}</strong>
            )}
          </span>
        ) : (
          <MaskedValue />
        )}
      </div>
      {visible ? (
        <div className="fb-com-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(wonPct)} aria-label={`${p.name} won against target`}>
          <div className="fb-com-progress__won" style={{ width: `${wonPct}%` }} />
          <div className="fb-com-progress__fc" style={{ width: `${fcPct}%` }} />
        </div>
      ) : null}
      <div className={`fb-com-muted${p.state === "short" ? " fb-com-bad" : ""}`}>{targetNote(p.state, p.shortBy, formatKesShort)}</div>
    </div>
  );
}

/** Open deals behind the numbers. Read from the deals list, so each value is masked by the same rule as everywhere else. */
function DealsInForecast({ data, current, orgSlug }: { data: ForecastResponse; current: "mine" | "team"; orgSlug: string }) {
  const { membershipId } = useMember();
  const nameOf = useMemberName();
  const deals = useAllDeals(false);
  const percentOf = new Map(data.stages.map((s) => [s.id, s.probability]));
  const now = new Date(data.asOf);
  const rows = (deals.data?.items ?? [])
    .filter((d: DealItem) => d.outcome === "OPEN" && (current === "team" || d.ownerMembershipId === membershipId))
    .sort((a, b) => String(a.expectedCloseDate ?? "9999").localeCompare(String(b.expectedCloseDate ?? "9999")));
  const anyHidden = rows.some((d) => d.valueMasked);
  return (
    <section className="fb-com-card">
      <h2>Deals in the forecast</h2>
      <p className="fb-com-muted">Probability comes from the deal’s stage (set in Settings › Pipelines).</p>
      {deals.isLoading ? <LoadingState label="Loading deals" lines={3} /> : null}
      {deals.error ? <p className="fb-com-muted" role="status">The list of deals could not be loaded for your role. The totals above are not affected.</p> : null}
      {deals.data ? (
        <div className="fb-com-tablewrap">
          <table className="fb-com-table">
            <thead>
              <tr>
                <th scope="col">Deal</th><th scope="col">Stage</th><th scope="col">Owner</th><th scope="col">Expected close</th>
                <th scope="col" className="fb-com-num">Value</th><th scope="col" className="fb-com-num">Probability</th><th scope="col" className="fb-com-num">Weighted</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={7} className="fb-com-muted">No open deals in this forecast.</td></tr> : null}
              {rows.map((d) => {
                const close = d.expectedCloseDate ? String(d.expectedCloseDate) : null;
                const passed = close !== null && new Date(close) < now;
                const percent = percentOf.get(d.pipelineStageId) ?? 0;
                const value = d.valueMasked || d.value === null ? null : Number(d.value);
                return (
                  <tr key={d.id}>
                    <td><Link href={`/o/${orgSlug}/deals/${d.id}`} className="fb-com-linkbtn">{d.company.name}</Link></td>
                    <td>{d.pipelineStage.name}</td>
                    <td>{nameOf(d.ownerMembershipId)}</td>
                    <td className={passed ? "fb-com-bad" : undefined}>
                      {close ? new Date(close).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" }) : "No date"}
                      {passed ? <span className="fb-com-muted fb-com-bad"> · close date passed</span> : null}
                    </td>
                    <td className="fb-com-num">{value === null ? <MaskedValue /> : formatKes(value)}</td>
                    <td className="fb-com-num">{percent}%</td>
                    <td className="fb-com-num">{value === null ? <MaskedValue /> : formatKes(weightedOf(value, percent) ?? 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {anyHidden ? <p className="fb-com-muted">Values on deals you don’t own are hidden for your role.</p> : null}
    </section>
  );
}
