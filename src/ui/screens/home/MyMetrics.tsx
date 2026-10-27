"use client";

import { useMemo, useState } from "react";
import { describeError } from "../../errors";
import { ErrorState, NoAccess } from "../../components/states";
import { useApiQuery } from "../../data/hooks";
import { useMember } from "../../data/member";
import { moneyShort } from "./format";
import { ChartCard, HIcon, Seg } from "./kit";

interface Card {
  key: string;
  label: string;
  value: number | string | null;
  unit: "count" | "percent" | "money";
  definition: string;
}

const PERIODS = [
  { id: "7", label: "Last 7 days", days: 7 },
  { id: "30", label: "Last 30 days", days: 30 },
  { id: "90", label: "Last 90 days", days: 90 },
  { id: "365", label: "Last 12 months", days: 365 },
] as const;

const DOTS = ["var(--blue)", "var(--primary)", "var(--primary)", "var(--purple)", "var(--orange)", "var(--orange)", "var(--primary)", "var(--blue)", "var(--primary)", "var(--blue)", "var(--red)"];

function show(c: Card, masked: boolean): string {
  if (c.unit === "money") return masked ? "Hidden" : moneyShort(c.value);
  if (c.unit === "percent") return c.value === null ? "—" : `${Number(c.value)}%`;
  return c.value === null ? "—" : String(c.value);
}

/**
 * My metrics (R2): the person's own figures, nothing about anyone else. The numbers are the API's (`GET /reports/v2/my-metrics`, the same
 * definitions the organisation reports use); the screen shows them as cards, and the same series as bars with a table beside them.
 */
export function MyMetricsScreen() {
  const { orgSlug, can } = useMember();
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["id"]>("30");
  // The range is fixed when a period is chosen: a range that moved with every render would never settle in the cache.
  const range = useMemo(() => {
    const days = PERIODS.find((p) => p.id === period)!.days;
    const to = new Date();
    return { dateFrom: new Date(to.getTime() - days * 86_400_000).toISOString(), dateTo: to.toISOString() };
  }, [period]);
  const q = useApiQuery("getMyMetricsV2", { params: { orgSlug }, query: range });
  const exportHref = `/api/orgs/${orgSlug}/reports/v2/my-metrics/export?dateFrom=${encodeURIComponent(range.dateFrom)}&dateTo=${encodeURIComponent(range.dateTo)}`;

  const header = (
    <div className="fb-homehead">
      <div>
        <h1 className="fb-homehead__title">My metrics</h1>
        <div className="fb-homehead__sub" style={{ marginTop: 4 }}>
          How your own work is going. Same numbers your manager sees for you.
        </div>
        <div className="fb-homehead__meta">
          <span className="fb-scope fb-scope--mine">Personal</span>
          <span className="fb-homehead__sub">Only records you own or are assigned to.</span>
        </div>
      </div>
      {can("export.bulk") ? (
        <a className="fb-qbtn fb-qbtn--lg" style={{ fontWeight: 600 }} href={exportHref} download>
          <HIcon name="file" size={16} />
          Export CSV
        </a>
      ) : null}
    </div>
  );

  if (q.isError) {
    const e = describeError(q.error);
    return (
      <div className="fb-home">
        {header}
        {e.kind === "noAccess" ? <NoAccess area="My metrics" denial={e.denial} /> : <ErrorState error={q.error} area="Your metrics" onRetry={() => void q.refetch()} />}
      </div>
    );
  }

  const d = q.data;
  const masked = d?.valueMasked ?? false;
  const cards = ((d?.cards ?? []) as unknown as Card[]).filter(Boolean);
  const series = (d?.chart?.series ?? []) as { label: string; value: number | null }[];
  const unitOf = new Map(cards.map((c) => [c.label, c.unit]));
  const groups: { title: string; sub: string; unit: Card["unit"] }[] = [
    { title: "Your work in numbers", sub: "Counts for the range, and live figures where the card says so", unit: "count" },
    { title: "Your value", sub: "Amounts for the range, and your open pipeline right now", unit: "money" },
    { title: "Your conversion", sub: "How many of your leads became deals", unit: "percent" },
  ];

  return (
    <div className="fb-home" data-screen-label="My metrics">
      {header}
      <div className="fb-eyebrow">
        PERFORMANCE<span className="fb-eyebrow__rule" />
      </div>
      <Seg label="Period" value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ id: p.id, label: p.label }))} />
      <div className="fb-hp__sub" style={{ marginTop: -6, fontSize: 13 }}>
        Showing {new Date(range.dateFrom).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} to{" "}
        {new Date(range.dateTo).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}. Open pipeline is always a live snapshot.
      </div>

      {q.isPending ? (
        <div className="fb-mom" aria-busy="true">
          <span className="fb-sr-only" role="status">
            Loading your metrics
          </span>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="fb-hskel" style={{ height: 104, borderRadius: 14 }} />
          ))}
        </div>
      ) : cards.every((c) => !c.value || c.value === "0.00") ? (
        <div className="fb-search__empty" role="status">
          <div style={{ display: "flex", justifyContent: "center", color: "var(--orange-text)" }}>
            <HIcon name="chart" size={26} />
          </div>
          <div className="fb-search__emptytitle" style={{ fontSize: 18, marginTop: 10 }}>
            Not enough data yet
          </div>
          <div>Your numbers fill in once your leads and deals start moving. Check back after your first week.</div>
        </div>
      ) : (
        <>
          <div className="fb-mom" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
            {cards.map((c, i) => (
              <div key={c.key} className="fb-mom__card" data-testid={`metric-${c.key}`}>
                <div className="fb-mom__label" style={{ fontSize: 14 }}>
                  <span className="fb-mom__dot" style={{ background: DOTS[i % DOTS.length] }} aria-hidden="true" />
                  {c.label}
                </div>
                <div className="fb-mom__now" style={{ display: "block", marginTop: 8 }}>
                  {c.unit === "money" && masked ? "Hidden" : show(c, masked)}
                </div>
                <div className="fb-mom__prev" style={{ marginTop: 3 }}>
                  {c.definition}
                </div>
              </div>
            ))}
          </div>
          <div className="fb-hgrid fb-hgrid--narrow">
            {groups.map((g) => {
              const rows = series.filter((s) => unitOf.get(s.label) === g.unit);
              if (rows.length === 0) return null;
              if (g.unit === "money" && masked) return null;
              const max = Math.max(1, ...rows.map((r) => Number(r.value ?? 0)));
              const fmt = (r: { value: number | null }) => (g.unit === "money" ? moneyShort(r.value) : g.unit === "percent" ? `${r.value ?? 0}%` : String(r.value ?? 0));
              return (
                <ChartCard
                  key={g.unit}
                  title={g.title}
                  sub={g.sub}
                  columns={["Measure", "Value"]}
                  rows={rows.map((r) => ({ label: r.label, text: fmt(r) }))}
                  summary={`${g.title}: ${rows.map((r) => `${r.label} ${fmt(r)}`).join(", ")}.`}
                >
                  <div className="fb-mbars">
                    {rows.map((r) => (
                      <div key={r.label} className="fb-mbars__row">
                        <span className="fb-mbars__label">{r.label}</span>
                        <div className="fb-mbars__track">
                          <div className="fb-mbars__fill" style={{ width: `${Math.max(2, (Number(r.value ?? 0) / max) * 100)}%` }} />
                        </div>
                        <span className="fb-mbars__val">{fmt(r)}</span>
                      </div>
                    ))}
                  </div>
                </ChartCard>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
