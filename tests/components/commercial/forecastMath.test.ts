import { describe, expect, it } from "vitest";
import { deals } from "../../../src/ui/screens/commercial/demo/data";
import { isOpen, monthBuckets, probabilityOf, targetProgress, weightedValue } from "../../../src/ui/screens/commercial/forecastMath";

describe("forecast arithmetic (FIG-1170)", () => {
  it("takes the probability from the stage, and an override wins and is visible on the deal", () => {
    const proposal = deals.find((d) => d.id === "d1")!; // Proposal Sent, no override
    const overridden = deals.find((d) => d.id === "d2")!; // Negotiation with a 60% override
    expect(probabilityOf(proposal)).toBe(0.5);
    expect(weightedValue(proposal)).toBe(210_000);
    expect(probabilityOf(overridden)).toBe(0.6);
    expect(weightedValue(overridden)).toBe(456_000);
  });

  it("counts only open deals: a won deal is not part of the pipeline", () => {
    expect(deals.filter(isOpen).every((d) => d.stage !== "Closed Won")).toBe(true);
    expect(deals.filter(isOpen)).toHaveLength(6);
  });

  it("groups expected closes by month, weighted and in full", () => {
    const months = monthBuckets(deals.filter(isOpen), [[9, "OCT"], [10, "NOV"], [11, "DEC"], [0, "JAN"]]);
    const oct = months[0]!;
    expect(oct.full).toBe(420_000 + 360_000); // Kijani and Pwani close in October
    expect(oct.weighted).toBe(210_000 + 180_000);
    expect(months.map((m) => m.label)).toEqual(["OCT", "NOV", "DEC", "JAN"]);
  });

  it("a person with no target is never short; otherwise won plus forecast against the target decides", () => {
    expect(targetProgress(100, 50, 0).state).toBe("no-target");
    expect(targetProgress(900_000, 300_000, 1_000_000)).toMatchObject({ state: "on-track", shortBy: 0 });
    expect(targetProgress(500_000, 100_000, 1_000_000)).toMatchObject({ state: "short", shortBy: 400_000 });
  });
});
