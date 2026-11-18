"use client";

import { Download, BarChart3, Table2 } from "lucide-react";
import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { chartSummary, type BarRow, type ReportColumn } from "./model";

export interface ReportCardProps {
  /** Stable name for the card (test ids, file names). */
  id: string;
  title: string;
  sub?: ReactNode;
  columns: ReportColumn[];
  /** The visible table's cells (the totals row last, when there is one). */
  cells: string[][];
  /** True when the last row of `cells` is a totals row. */
  hasTotals?: boolean;
  /** Bars for the chart view; without them the card is a table only. */
  bars?: BarRow[];
  /** The colour a bar takes, by its label (identity, never rank). */
  colourFor?: (label: string) => string;
  /** The download: a server CSV link, or a function that writes the visible table. */
  csv?: { href: string; filename: string } | { onClick: () => void } | null;
  /** Shown instead of the table when there are no rows. */
  emptyText?: string;
  footer?: ReactNode;
  /** Controls above the body (a filter for this card only). */
  controls?: ReactNode;
  /** A link for the first cell of each body row (null for none), for rows that name a record. */
  rowLinks?: (string | null)[];
}

/**
 * One report card in the design (R1): a title, a chart-or-table toggle and a CSV button. The chart is drawn from the same rows as the table, every
 * bar carries its label and its figure (colour is never the only cue), and the table view is always there.
 */
export function ReportCard({ id, title, sub, columns, cells, hasTotals, bars, colourFor, csv, emptyText, footer, controls, rowLinks }: ReportCardProps) {
  const [view, setView] = useState<"chart" | "table">(bars && bars.length > 0 ? "chart" : "table");
  const headId = useId();
  const chartable = Boolean(bars && bars.length > 0);
  const showChart = chartable && view === "chart";
  const body = hasTotals ? cells.slice(0, -1) : cells;
  const totals = hasTotals ? cells[cells.length - 1] : null;
  return (
    <section className="fb-rep__card" aria-labelledby={headId} data-testid={`report-${id}`}>
      <div className="fb-rep__cardhead">
        <div>
          <h2 id={headId} className="fb-rep__cardtitle">{title}</h2>
          {sub ? <div className="fb-rep__cardsub">{sub}</div> : null}
        </div>
        <div className="fb-rep__tools">
          {chartable ? (
            <div role="group" aria-label={`${title}: view`} className="fb-rep__toggle">
              <button type="button" aria-label="Chart view" aria-pressed={view === "chart"} onClick={() => setView("chart")}>
                <BarChart3 size={14} aria-hidden="true" />
              </button>
              <button type="button" aria-label="Table view" aria-pressed={view === "table"} onClick={() => setView("table")}>
                <Table2 size={14} aria-hidden="true" />
              </button>
            </div>
          ) : null}
          {csv ? (
            "href" in csv ? (
              <a className="fb-rep__csv" href={csv.href} download={csv.filename} aria-label={`Download CSV: ${title}`} title="Download CSV">
                <Download size={14} aria-hidden="true" />
              </a>
            ) : (
              <button type="button" className="fb-rep__csv" onClick={csv.onClick} aria-label={`Download CSV: ${title}`} title="Download CSV">
                <Download size={14} aria-hidden="true" />
              </button>
            )
          ) : null}
        </div>
      </div>
      {controls ? <div className="fb-rep__controls">{controls}</div> : null}
      {showChart ? (
        <div role="img" aria-label={chartSummary(title, bars!)} className="fb-rep__bars">
          {bars!.map((r) => (
            <div key={r.label} className="fb-rep__barrow">
              <span className="fb-rep__barlabel" title={r.label}>{r.label}</span>
              <div className="fb-rep__track">
                <div className="fb-rep__fill" style={{ width: `${r.width}%`, background: colourFor?.(r.label) ?? "var(--primary)" }} />
              </div>
              <span className="fb-rep__barval">{r.text}</span>
            </div>
          ))}
        </div>
      ) : body.length === 0 ? (
        <div className="fb-rep__cardempty" role="status">{emptyText ?? "Nothing in this range."}</div>
      ) : (
        <div className="fb-rep__tablewrap">
          <table className="fb-rep__table">
            <caption className="fb-sr-only">{title}</caption>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} scope="col">{c.label.toUpperCase()}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((r, i) => (
                <tr key={i}>
                  {r.map((cell, j) =>
                    j === 0 ? (
                      <th key={j} scope="row">
                        {rowLinks?.[i] ? <Link href={rowLinks[i]!} className="fb-rep__link">{cell}</Link> : cell}
                      </th>
                    ) : (
                      <td key={j}>{cell}</td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
            {totals ? (
              <tfoot>
                <tr>
                  {totals.map((cell, j) => (j === 0 ? <th key={j} scope="row">{cell}</th> : <td key={j}>{cell}</td>))}
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      )}
      {footer}
    </section>
  );
}
