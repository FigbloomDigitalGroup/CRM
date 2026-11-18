import { describe, expect, it } from "vitest";
import { clockLabel, clockOf, dayOf, defaultFollowUp, instantAt, overdueBy, quickChoices, snapClock, timeOptions, zoneLabel } from "../src/ui/components/dateTimeZone";

describe("date and time in the person's zone (P2-27)", () => {
  it("reads and writes the same instant: 15:30 in Nairobi is 12:30 UTC", () => {
    const at = instantAt("2026-11-14", "15:30", "Africa/Nairobi");
    expect(at.toISOString()).toBe("2026-11-14T12:30:00.000Z");
    expect(dayOf(at, "Africa/Nairobi")).toBe("2026-11-14");
    expect(clockOf(at, "Africa/Nairobi")).toBe("15:30");
  });

  it("23:30 in Nairobi is still that day, though it is the next day in Auckland and the same evening in UTC", () => {
    const at = instantAt("2026-11-14", "23:30", "Africa/Nairobi");
    expect(at.toISOString()).toBe("2026-11-14T20:30:00.000Z");
    expect(dayOf(at, "Africa/Nairobi")).toBe("2026-11-14");
    expect(dayOf(at, "UTC")).toBe("2026-11-14");
    expect(dayOf(at, "Pacific/Auckland")).toBe("2026-11-15");
  });

  it("follows daylight saving: 09:00 in New York is 14:00 UTC before the change and 13:00 after it", () => {
    expect(instantAt("2026-03-07", "09:00", "America/New_York").toISOString()).toBe("2026-03-07T14:00:00.000Z");
    expect(instantAt("2026-03-09", "09:00", "America/New_York").toISOString()).toBe("2026-03-09T13:00:00.000Z");
    // The day the clocks go back (1 November 2026): 01:30 happens once as EDT in the first pass.
    expect(clockOf(instantAt("2026-11-01", "08:00", "America/New_York"), "America/New_York")).toBe("08:00");
  });

  it("labels the clock for 12 or 24 hour people, in steps of 5 minutes", () => {
    expect(clockLabel("15:30", false)).toBe("15:30");
    expect(clockLabel("15:30", true)).toBe("3:30 PM");
    expect(clockLabel("00:05", true)).toBe("12:05 AM");
    expect(clockLabel("12:00", true)).toBe("12:00 PM");
    const options = timeOptions(true);
    expect(options).toHaveLength(288);
    expect(options[0]).toEqual({ value: "00:00", label: "12:00 AM" });
    expect(options[1]).toEqual({ value: "00:05", label: "12:05 AM" });
    expect(options.at(-1)).toEqual({ value: "23:55", label: "11:55 PM" });
    expect(snapClock("10:32")).toBe("10:30");
    expect(snapClock("23:58")).toBe("23:55");
  });

  it("offers Today 17:00 only while it is still ahead, Tomorrow 09:00 and Next week, all in the person's zone", () => {
    const morning = new Date("2026-11-18T05:00:00Z"); // Wednesday 08:00 in Nairobi
    const choices = quickChoices(morning, "Africa/Nairobi");
    expect(choices.map((c) => c.label)).toEqual(["Today 17:00", "Tomorrow 09:00", "Next week"]);
    expect(choices[0]!.at.toISOString()).toBe("2026-11-18T14:00:00.000Z");
    expect(choices[1]!.at.toISOString()).toBe("2026-11-19T06:00:00.000Z");
    expect(choices[2]!.at.toISOString()).toBe("2026-11-23T06:00:00.000Z"); // the next Monday, 09:00

    const night = new Date("2026-11-18T16:00:00Z"); // 19:00 in Nairobi: 17:00 has passed
    expect(quickChoices(night, "Africa/Nairobi").map((c) => c.key)).toEqual(["tomorrow", "next-week"]);
    expect(quickChoices(morning, "Africa/Nairobi", true).map((c) => c.label)).toEqual(["Today 5:00 PM", "Tomorrow 9:00 AM", "Next week"]);
  });

  it("the default follow-up is tomorrow at 09:00 in the person's zone, across the day boundary", () => {
    // 23:30 in Nairobi on the 14th is still the 14th there, so tomorrow is the 15th.
    expect(defaultFollowUp(new Date("2026-11-14T20:30:00Z"), "Africa/Nairobi").toISOString()).toBe("2026-11-15T06:00:00.000Z");
    // The same instant is already the 15th in Auckland, so tomorrow is the 16th.
    expect(defaultFollowUp(new Date("2026-11-14T20:30:00Z"), "Pacific/Auckland").toISOString()).toBe("2026-11-15T20:00:00.000Z");
  });

  it("shows the time zone and how late something is", () => {
    expect(zoneLabel("Africa/Nairobi", new Date("2026-11-14T12:00:00Z"))).toBe("Africa/Nairobi (UTC+3)");
    expect(zoneLabel("Asia/Kolkata", new Date("2026-11-14T12:00:00Z"))).toBe("Asia/Kolkata (UTC+5:30)");
    const due = new Date("2026-11-14T10:00:00Z");
    expect(overdueBy(due, new Date("2026-11-14T12:00:00Z"))).toBe("Overdue by 2 h");
    expect(overdueBy(due, new Date("2026-11-14T10:20:00Z"))).toBe("Overdue by 20 min");
    expect(overdueBy(due, new Date("2026-11-18T10:00:00Z"))).toBe("Overdue by 4 days");
    expect(overdueBy(due, new Date("2026-11-14T09:00:00Z"))).toBe("");
  });
});
