"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface ReportBarDatum {
  label: string;
  value: number;
}

/**
 * One horizontal-category bar chart, shared by the lead-volume-by-source,
 * pipeline-by-stage, and sales-by-service charts (FIG-603) -- they differ
 * only in which metric is plotted and how it's formatted, not in shape.
 */
export function ReportBarChart({
  data,
  color,
  formatValue = (n) => n.toLocaleString(),
}: {
  data: ReportBarDatum[];
  color: string;
  formatValue?: (n: number) => string;
}) {
  if (data.length === 0) {
    return <p className="who">No data in range.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
          interval={0}
          angle={-20}
          textAnchor="end"
          height={50}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
          tickFormatter={formatValue}
          width={56}
        />
        <Tooltip formatter={(value) => formatValue(Number(value))} />
        {/* isAnimationActive=false: an instant dashboard render beats a
            "growing" entrance animation here, and it sidesteps a jsdom
            testing quirk where recharts defers the actual <path> until its
            animation frame resolves, which jsdom's RAF timing never does
            synchronously. */}
        <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
