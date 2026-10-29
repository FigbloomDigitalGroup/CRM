import { describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS } from "../prisma/seedData";
import { DEMO_CARDS, attendeesWithoutEmail, isLimitedMember, mentionQuery, mentionsIn, viewCard } from "../src/ui/screens/communication/demo/data";

const canOf = (role: string) => (key: string) => ROLE_PERMISSIONS[role]!.includes(key);
const deal = DEMO_CARDS.find((c) => c.kind === "deal" && c.paymentDueKes !== undefined)!;

describe("record cards in chat are masked by the viewer's role (hard rule 7)", () => {
  it("payments are visible only to Finance and Management", () => {
    for (const role of Object.keys(ROLE_PERMISSIONS)) {
      const v = viewCard(deal, canOf(role));
      const allowed = ["FINANCE", "MANAGEMENT"].includes(role);
      expect(v.paymentDue === null, role).toBe(!allowed);
      if (allowed) expect(v.paymentDue).toBe(deal.paymentDueKes);
    }
  });

  it("a masked figure is null, so the number cannot be rendered or leaked by formatting", () => {
    const v = viewCard(deal, () => false);
    expect(v.value).toBeNull();
    expect(v.margin).toBeNull();
    expect(v.paymentDue).toBeNull();
    expect(JSON.stringify(v)).not.toContain(String(deal.valueKes));
    expect(JSON.stringify(v)).not.toContain(String(deal.paymentDueKes));
  });

  it("value and margin follow their own permission keys, whoever posted the card", () => {
    expect(viewCard(deal, (k) => k === "deals.view.value").value).toBe(deal.valueKes);
    expect(viewCard(deal, (k) => k === "deals.view.value").margin).toBeNull();
    expect(viewCard(deal, (k) => k === "deals.margin").margin).toBe(deal.marginPct);
  });

  it("a company card has no figures to mask", () => {
    const company = DEMO_CARDS.find((c) => c.kind === "company")!;
    const v = viewCard(company, () => false);
    expect(v.value).toBeUndefined();
    expect(v.paymentDue).toBeUndefined();
  });
});

describe("who is limited in chat", () => {
  it("only Restricted Technical (no customer access) sees just the channels it was added to", () => {
    for (const role of Object.keys(ROLE_PERMISSIONS)) expect(isLimitedMember(canOf(role)), role).toBe(role === "RESTRICTED_TECHNICAL");
  });
});

describe("mentions and meetings helpers", () => {
  const people = [
    { id: "a", name: "Amina Wekesa" },
    { id: "j", name: "Joseph Otieno" },
  ];
  it("finds people named in full and the partial word being typed", () => {
    expect(mentionsIn("Thanks @Amina Wekesa and @Joseph Otieno", people)).toEqual(["a", "j"]);
    expect(mentionsIn("no one here", people)).toEqual([]);
    expect(mentionQuery("hello @Am")).toBe("Am");
    expect(mentionQuery("hello @")).toBe("");
    expect(mentionQuery("mail me at a@b")).toBeNull();
  });
  it("flags attendees with no email before invites go out", () => {
    expect(attendeesWithoutEmail(["a-esther", "a-lucy"]).map((a) => a.id)).toEqual(["a-lucy"]);
    expect(attendeesWithoutEmail(["a-esther"])).toEqual([]);
  });
});
