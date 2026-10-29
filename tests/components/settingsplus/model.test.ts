import { describe, expect, it } from "vitest";
import { fieldRows } from "../../../src/ui/screens/settingsplus/demo/data";
import {
  describeChange, diffFields, embedCode, generateSecret, maskSecret, nextAccess, previewValue, ruleImpact, stageRuleImpact, validateCatalogueItem, validateFields,
  validatePipelineName, validateRules, validateSequence, validateToken, validateWebhook,
} from "../../../src/ui/screens/settingsplus/model";

describe("roles and field access (FIG-1194)", () => {
  it("cycles Edit, Own, View, Hidden and back", () => {
    expect(["Edit", "Own", "View", "Hidden", "Edit"].map((a, i, all) => (i ? nextAccess(all[i - 1] as never) : a))).toEqual(["Edit", "Own", "View", "Hidden", "Edit"]);
  });

  it("refuses to save a layout where Management loses sight of a field", () => {
    const bad = fieldRows.map((r) => (r.key === "deals.values" ? { ...r, access: { ...r.access, management: "Hidden" as const } } : r));
    expect(validateFields(fieldRows)).toEqual([]);
    expect(validateFields(bad)).toHaveLength(1);
  });

  it("says in words what a change does, and previews what the role then sees", () => {
    const changed = fieldRows.map((r) => (r.key === "deals.margin" ? { ...r, access: { ...r.access, sales: "View" as const } } : r));
    const diff = diffFields(fieldRows, changed);
    expect(diff).toEqual([{ field: "Cost and margin", role: "sales", from: "Hidden", to: "View" }]);
    expect(describeChange(diff[0]!)).toBe("Sales will start to see “Cost and margin”.");
    expect(previewValue("Hidden", "42%", true)).toMatchObject({ text: "" });
    expect(previewValue("Own", "KES 540,000", false).text).toBe("Masked");
    expect(previewValue("Own", "KES 540,000", true).text).toBe("KES 540,000");
    expect(previewValue("View", "x", false).note).toBe("Read only");
  });
});

describe("approval rules and stage rules (FIG-1174)", () => {
  const rules = [
    { key: "discount", label: "Discount", unit: "%", on: true, threshold: 5 },
    { key: "export", label: "Export", unit: "rows", on: true, threshold: 500 },
  ] as const;

  it("rejects a zero threshold and a discount rule that could never trigger", () => {
    expect(validateRules(rules as never, 30)).toEqual([]);
    expect(validateRules([{ ...rules[0], threshold: 0 }] as never, 30)).toHaveLength(1);
    expect(validateRules([{ ...rules[0], threshold: 45 }] as never, 30)[0]).toMatch(/could never trigger/);
  });

  it("explains a switched-off rule as going straight through, and a new threshold with its old value", () => {
    const off = [{ ...rules[0], on: false }, rules[1]] as never;
    expect(ruleImpact(rules as never, off)[0]).toMatch(/no longer wait/);
    const moved = [{ ...rules[0], threshold: 10 }, rules[1]] as never;
    expect(ruleImpact(rules as never, moved)[0]).toBe("“Discount” now applies above 10 % (was 5).");
  });

  it("describes a stage rule being switched on, with how many deals it does not touch", () => {
    const before = [{ key: "won", label: "Closed Won needs a signed quote", detail: "", on: false }] as never;
    const after = [{ key: "won", label: "Closed Won needs a signed quote", detail: "", on: true }] as never;
    expect(stageRuleImpact(before, after, { proposal: 0, won: 3, lostReason: 0 })[0]).toMatch(/3 open deals are already past it/);
  });

  it("does not allow two pipelines with the same name, whatever the case", () => {
    expect(validatePipelineName("installations", ["Installations"])).toMatch(/already exists/);
    expect(validatePipelineName("  ", [])).toMatch(/name/);
    expect(validatePipelineName("Support", ["Installations"])).toBeNull();
  });

  it("a sequence needs a name, at least one step and no empty steps", () => {
    expect(validateSequence("Referral", ["Day 0 · Call"])).toEqual([]);
    expect(validateSequence("", [])).toHaveLength(2);
    expect(validateSequence("x", ["a", " "])).toEqual(["Step 2 is empty."]);
  });

  it("a catalogue item needs a price above zero, and Management cannot sell below cost", () => {
    expect(validateCatalogueItem({ name: "A", unit: "unit", price: 10, cost: 5 }, true)).toEqual([]);
    expect(validateCatalogueItem({ name: "A", unit: "unit", price: 0, cost: 0 }, false)).toHaveLength(1);
    expect(validateCatalogueItem({ name: "A", unit: "unit", price: 10, cost: 20 }, true)[0]).toMatch(/loss/);
    expect(validateCatalogueItem({ name: "A", unit: "unit", price: 10, cost: 20 }, false)).toEqual([]); // cost unknown to this role
  });

  it("the embed code is one script tag", () => {
    expect(embedCode("abc")).toBe('<script src="https://forms.figbloom.co.ke/f/abc.js" async></script>');
  });
});

describe("tokens and webhooks (FIG-1194)", () => {
  const random = (n: number) => Uint8Array.from({ length: n }, (_, i) => i * 7);

  it("makes a prefixed secret, and what is kept for display never contains the secret", () => {
    const s = generateSecret("fbk_live_", random);
    expect(s.startsWith("fbk_live_")).toBe(true);
    expect(s).toHaveLength("fbk_live_".length + 32);
    const mask = maskSecret(s);
    expect(mask).toMatch(/^fbk_live_••••.{3}$/);
    expect(mask).not.toContain(s.slice(9, 20));
  });

  it("a token needs a name and at least one scope", () => {
    expect(validateToken("Sync", ["deals:read"])).toEqual([]);
    expect(validateToken("", [])).toHaveLength(2);
  });

  it("a webhook must be an https address with at least one event", () => {
    expect(validateWebhook("https://example.co.ke/hook", ["deal.won"])).toEqual([]);
    expect(validateWebhook("http://example.co.ke/hook", ["deal.won"])[0]).toMatch(/https/);
    expect(validateWebhook("not a url", [])).toHaveLength(2);
  });
});
