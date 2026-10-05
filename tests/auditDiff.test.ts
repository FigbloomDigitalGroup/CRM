import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { diffAuditedFields } from "../src/services/auditDiff";

describe("diffAuditedFields", () => {
  it("returns null when none of the tracked fields changed", () => {
    const before = { name: "Acme", notes: "old notes" };
    const patch = { name: "Acme", notes: "new notes (untracked)" };
    expect(diffAuditedFields(before, patch, ["name"])).toBeNull();
  });

  it("detects a scalar change", () => {
    const diff = diffAuditedFields(
      { timezone: "Africa/Nairobi" },
      { timezone: "Europe/London" },
      ["timezone"],
    );
    expect(diff).toEqual({
      previousValue: { timezone: "Africa/Nairobi" },
      newValue: { timezone: "Europe/London" },
    });
  });

  it("does not flag an array field as changed when its content is the same but the reference differs (FIG-604 regression)", () => {
    // Array fields (e.g. Organization.workingDays) always arrive as a new
    // array instance in a patch -- a naive `!==` comparison would call
    // this "changed" every time, even when nothing actually moved.
    const before = { workingDays: ["MON", "TUE", "WED"] };
    const patch = { workingDays: ["MON", "TUE", "WED"] };
    expect(diffAuditedFields(before, patch, ["workingDays"])).toBeNull();
  });

  it("does detect a real array content change", () => {
    const diff = diffAuditedFields(
      { workingDays: ["MON", "TUE", "WED"] },
      { workingDays: ["MON", "TUE"] },
      ["workingDays"],
    );
    expect(diff).toEqual({
      previousValue: { workingDays: ["MON", "TUE", "WED"] },
      newValue: { workingDays: ["MON", "TUE"] },
    });
  });

  it("coerces a numeric-string patch value to match a Decimal DB value (deal value, FIG-600)", () => {
    const diff = diffAuditedFields(
      { value: new Prisma.Decimal("5000") },
      { value: "5000.00" },
      ["value"],
    );
    // Same amount, different representation -- not a real change.
    expect(diff).toBeNull();

    const changed = diffAuditedFields(
      { value: new Prisma.Decimal("5000") },
      { value: "6000" },
      ["value"],
    );
    expect(changed).toEqual({
      previousValue: { value: 5000 },
      newValue: { value: 6000 },
    });
  });

  it("does NOT coerce a numeric-looking free-text field (e.g. a phone number) into a number (FIG-604 regression)", () => {
    const diff = diffAuditedFields(
      { phone: "+254700000000" },
      { phone: "+254700000000" },
      ["phone"],
    );
    expect(diff).toBeNull();

    const changed = diffAuditedFields(
      { phone: "+254700000000" },
      { phone: "+254711111111" },
      ["phone"],
    );
    expect(changed).toEqual({
      previousValue: { phone: "+254700000000" },
      newValue: { phone: "+254711111111" },
    });
  });

  it("ignores a field missing from the patch entirely, vs. explicitly nulling one present as null", () => {
    const before = { phone: "+254700000000" };
    expect(diffAuditedFields(before, {}, ["phone"])).toBeNull();

    const diff = diffAuditedFields(before, { phone: null }, ["phone"]);
    expect(diff).toEqual({
      previousValue: { phone: "+254700000000" },
      newValue: { phone: null },
    });
  });
});
