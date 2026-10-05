import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReportDonutChart } from "../../src/app/o/[orgSlug]/reports/charts/ReportDonutChart";

describe("ReportDonutChart", () => {
  it("renders the center label/caption and a legend entry per segment", () => {
    render(
      <ReportDonutChart
        segments={[
          { label: "Won", value: 8, color: "var(--success)" },
          { label: "Lost", value: 2, color: "var(--danger)" },
        ]}
        centerLabel="80%"
        centerCaption="win rate"
      />,
    );

    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByText("win rate")).toBeInTheDocument();
    expect(screen.getByText("Won (8)")).toBeInTheDocument();
    expect(screen.getByText("Lost (2)")).toBeInTheDocument();
  });

  it("still renders a center label when every segment is zero", () => {
    render(
      <ReportDonutChart
        segments={[
          { label: "Won", value: 0, color: "var(--success)" },
          { label: "Lost", value: 0, color: "var(--danger)" },
        ]}
        centerLabel="--"
        centerCaption="win rate"
      />,
    );

    expect(screen.getByText("--")).toBeInTheDocument();
  });
});
