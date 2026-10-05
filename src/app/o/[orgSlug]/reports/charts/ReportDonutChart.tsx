"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

export interface ReportDonutSegment {
  label: string;
  value: number;
  color: string;
}

/**
 * A two-(or-more)-segment donut with a figure in the middle, shared by the
 * conversion chart (converted vs. not-yet) and the won/lost chart (FIG-603)
 * -- both are "share of a whole" questions, not category comparisons, which
 * is why they're a donut rather than another bar chart.
 */
export function ReportDonutChart({
  segments,
  centerLabel,
  centerCaption,
}: {
  segments: ReportDonutSegment[];
  centerLabel: string;
  centerCaption: string;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  return (
    <div style={{ position: "relative", height: 220 }}>
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={segments}
            dataKey="value"
            nameKey="label"
            innerRadius="65%"
            outerRadius="90%"
            paddingAngle={total > 0 ? 2 : 0}
            stroke="none"
          >
            {segments.map((segment) => (
              <Cell key={segment.label} fill={segment.color} />
            ))}
          </Pie>
          <Tooltip formatter={(value) => Number(value).toLocaleString()} />
        </PieChart>
      </ResponsiveContainer>
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          textAlign: "center",
          pointerEvents: "none",
        }}
      >
        <div style={{ fontSize: 24, fontWeight: 700, color: "var(--text-primary)" }}>
          {centerLabel}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{centerCaption}</div>
      </div>
      <ul
        style={{
          display: "flex",
          gap: 14,
          justifyContent: "center",
          listStyle: "none",
          margin: "8px 0 0",
          padding: 0,
          fontSize: 12,
          color: "var(--text-secondary)",
        }}
      >
        {segments.map((segment) => (
          <li key={segment.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: segment.color,
                display: "inline-block",
              }}
            />
            {segment.label} ({segment.value.toLocaleString()})
          </li>
        ))}
      </ul>
    </div>
  );
}
