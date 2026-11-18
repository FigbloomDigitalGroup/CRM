import { describe, expect, it } from "vitest";
import { NEWS, SHORTCUTS, TIPS, tipsFor } from "@/ui/screens/palette/helpContent";

describe("Help centre copy (X3)", () => {
  it("has tips for every main page a member can reach, not the home fallback", () => {
    for (const page of ["leads", "deals", "tasks", "companies", "contacts", "handoffs", "renewals", "payments", "reports", "preferences", "settings"]) {
      expect(tipsFor(`/o/acme/${page}`, "acme").title, page).toBe(TIPS[page]!.title);
    }
    expect(tipsFor("/o/acme", "acme").title).toBe("Home");
    expect(tipsFor("/o/acme/calendar", "acme").title).toBe("Tasks");
  });

  it("never prints a figure: no money amounts in any tip, news item or shortcut", () => {
    const text = JSON.stringify([TIPS, NEWS, SHORTCUTS]);
    expect(text).not.toMatch(/\$\s?\d|KES|USD|\d{1,3}(,\d{3})+/);
  });

  it("says who may see payments", () => {
    expect(TIPS.payments!.tips.join(" ")).toMatch(/Finance and Management only/);
  });
});
