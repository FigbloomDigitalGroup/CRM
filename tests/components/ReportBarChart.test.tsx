import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReportBarChart } from "../../src/app/o/[orgSlug]/reports/charts/ReportBarChart";

describe("ReportBarChart", () => {
  it("renders one bar per datum with the given color", () => {
    const { container } = render(
      <ReportBarChart
        data={[
          { label: "Website", value: 12 },
          { label: "Referral", value: 7 },
        ]}
        color="var(--info)"
      />,
    );

    const bars = container.querySelectorAll("path.recharts-rectangle");
    expect(bars.length).toBe(2);
    bars.forEach((bar) => expect(bar).toHaveAttribute("fill", "var(--info)"));
  });

  it("shows a 'no data' message instead of an empty chart", () => {
    const { getByText, container } = render(
      <ReportBarChart data={[]} color="var(--info)" />,
    );

    expect(getByText("No data in range.")).toBeInTheDocument();
    expect(container.querySelector(".recharts-wrapper")).toBeNull();
  });
});
