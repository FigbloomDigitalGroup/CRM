import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  TEAM_ACTIVITY_HOURLY_CAP,
  TEAM_EVENT_DEFS,
  composeText,
  digestDueAt,
  groupItems,
  isOverRateCap,
  type TeamItem,
} from "../src/notifications/teamActivity";

/** FIG-1600 (P2-17): grouping, wording, masking and digest timing, without a database. */

const at = (iso: string) => new Date(iso);
function item(over: Partial<TeamItem> & { n?: number } = {}): TeamItem {
  const n = over.n ?? 1;
  return {
    eventKey: "LEAD_CREATED",
    actorMembershipId: "amina",
    entityType: "Lead",
    entityId: `lead-${n}`,
    label: `Company ${n}`,
    path: `/o/x/leads/lead-${n}`,
    createdAt: at(`2026-11-12T08:${String(n % 60).padStart(2, "0")}:00Z`),
    ...over,
  };
}

describe("grouping", () => {
  it("makes one group per event and team member, oldest first", () => {
    const items = [
      ...Array.from({ length: 12 }, (_, i) => item({ n: 12 - i })),
      item({ n: 30, actorMembershipId: "brian" }),
      item({ n: 31, eventKey: "CONTACT_CREATED" }),
    ];
    const groups = groupItems(items);
    expect(groups).toHaveLength(3);
    const amina = groups.find((g) => g.eventKey === "LEAD_CREATED" && g.actorMembershipId === "amina")!;
    expect(amina.items).toHaveLength(12);
    expect(amina.items[0]!.entityId).toBe("lead-1");
  });

  it("words twelve leads as one sentence with the window", () => {
    const group = groupItems(Array.from({ length: 12 }, (_, i) => item({ n: i + 1 })))[0]!;
    const text = composeText(group, "Amina", { canSeeValue: false, window: "in the last hour" });
    expect(text.title).toBe("Amina added 12 leads in the last hour");
    expect(text.body).toBe("Company 1, Company 2, Company 3 and 9 more");
  });

  it("words one lead and one won deal on their own", () => {
    expect(composeText(groupItems([item()])[0]!, "Amina", { canSeeValue: false }).title).toBe("Amina added a lead: Company 1");
    const won = item({ eventKey: "DEAL_CLOSED", entityType: "Deal", label: "Acme", detail: { outcome: "WON", value: "1200000", currency: "KES" } });
    expect(composeText(groupItems([won])[0]!, "Amina", { canSeeValue: true }).title).toBe("Amina marked a deal won: Acme");
    const lost = item({ eventKey: "DEAL_CLOSED", entityType: "Deal", label: "Acme", detail: { outcome: "LOST" } });
    expect(composeText(groupItems([lost])[0]!, "Amina", { canSeeValue: true }).title).toContain("lost");
  });
});

describe("masking in the text", () => {
  const deal = item({ eventKey: "DEAL_CREATED", entityType: "Deal", label: "Acme", detail: { value: "1200000", currency: "KES" } });
  it("puts a deal value in the text only for a viewer who may see values", () => {
    expect(composeText(groupItems([deal])[0]!, "Amina", { canSeeValue: true }).body).toBe("Acme · KES 1,200,000");
    const hidden = composeText(groupItems([deal])[0]!, "Amina", { canSeeValue: false });
    expect(`${hidden.title} ${hidden.body}`).not.toMatch(/1,?200,?000|KES/);
  });
  it("never has a place to put a payment figure", () => {
    const code = readFileSync("src/notifications/teamActivity.ts", "utf8")
      .split(/\r?\n/)
      .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line))
      .join(" ");
    expect(code).not.toMatch(/payment|invoice/i);
  });
});

describe("digest timing", () => {
  it("an hourly digest is due an hour after the first item was held", () => {
    expect(digestDueAt("HOURLY", at("2026-11-12T08:10:00Z"), "Africa/Nairobi").toISOString()).toBe("2026-11-12T09:10:00.000Z");
  });
  it("a daily digest is due at 08:00 on the person's own clock", () => {
    // 05:00 UTC is 08:00 in Nairobi. An item held at 06:00 Nairobi (03:00 UTC) goes out at 08:00 the same morning...
    expect(digestDueAt("DAILY", at("2026-11-12T03:00:00Z"), "Africa/Nairobi").toISOString()).toBe("2026-11-12T05:00:00.000Z");
    // ...and one held at 10:00 Nairobi (07:00 UTC) goes out at 08:00 the next day.
    expect(digestDueAt("DAILY", at("2026-11-12T07:00:00Z"), "Africa/Nairobi").toISOString()).toBe("2026-11-13T05:00:00.000Z");
  });
});

describe("rate cap and defaults", () => {
  it("caps instant notifications per person per hour", () => {
    expect(isOverRateCap(TEAM_ACTIVITY_HOURLY_CAP - 1)).toBe(false);
    expect(isOverRateCap(TEAM_ACTIVITY_HOURLY_CAP)).toBe(true);
  });
  it("is instant for won or lost and digest for new leads, companies and contacts", () => {
    const mode = (k: string) => TEAM_EVENT_DEFS.find((d) => d.key === k)!.defaultMode;
    expect(mode("DEAL_CLOSED")).toBe("INSTANT");
    expect(mode("LEAD_CREATED")).toBe("HOURLY");
    expect(mode("CONTACT_CREATED")).toBe("HOURLY");
    expect(mode("COMPANY_CREATED")).toBe("HOURLY");
  });
  it("rule 9: the notifier and the catalogue cannot move a deal or approve anything", () => {
    for (const file of ["src/notifications/teamActivity.ts", "src/services/teamActivityNotifier.ts"]) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(/updateDeal|assignDeal|decideApproval|approveRequest|pipelineStageId|discountPercent\s*[:=]/);
    }
  });
});
