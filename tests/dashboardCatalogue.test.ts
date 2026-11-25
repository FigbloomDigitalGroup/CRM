import { describe, expect, it } from "vitest";
import {
  DASHBOARD_WIDGETS,
  HOME_KINDS,
  defaultLayout,
  homeKindFrom,
  layoutProblems,
  resolveLayout,
  widgetAllowed,
  widgetsFor,
} from "../src/ui/screens/home/catalogue";

/** UC-W1: the widget catalogue and the layout merge. Pure, no database. */

const keys = (...k: string[]) => (key: string) => k.includes(key);

describe("widget catalogue", () => {
  it("covers every home, with unique ids and a default order per home that is a strict sequence", () => {
    expect(new Set(DASHBOARD_WIDGETS.map((w) => w.id)).size).toBe(DASHBOARD_WIDGETS.length);
    for (const kind of HOME_KINDS) {
      const ws = widgetsFor(kind);
      expect(ws.length, kind).toBeGreaterThan(0);
      const orders = ws.map((w) => w.order[kind]);
      expect(orders.every((o) => typeof o === "number")).toBe(true);
      expect(new Set(orders).size).toBe(orders.length);
    }
  });

  it("keeps the masked widgets behind their keys (rule 7)", () => {
    const byId = (id: string) => DASHBOARD_WIDGETS.find((w) => w.id === id)!;
    expect(widgetAllowed(byId("invoice_tiles"), keys("invoices.view"))).toBe(false);
    expect(widgetAllowed(byId("invoice_tiles"), keys("invoices.view", "finance.view.payments"))).toBe(true);
    expect(widgetAllowed(byId("ageing"), keys())).toBe(false);
    expect(widgetAllowed(byId("quotes"), keys())).toBe(false);
    expect(widgetAllowed(byId("social"), keys("social.view"))).toBe(true);
    expect(widgetAllowed(byId("invoice_drafts"), keys("invoices.create"))).toBe(true);
    expect(widgetAllowed(byId("invoice_drafts"), keys())).toBe(false);
  });

  it("picks the same home the screen always did", () => {
    const has = (...s: string[]) => (k: string) => s.includes(k);
    expect(homeKindFrom(has("management", "sales_today"), keys())).toBe("management");
    expect(homeKindFrom(has("sales_today"), keys())).toBe("sales");
    expect(homeKindFrom(has("my_metrics"), keys("social.view"))).toBe("marketing");
    expect(homeKindFrom(has("my_metrics"), keys())).toBeNull();
  });
});

describe("resolveLayout", () => {
  const all = () => true;

  it("falls back to the catalogue default when nothing is stored", () => {
    for (const kind of HOME_KINDS) expect(resolveLayout(kind, null, all)).toEqual(defaultLayout(kind));
  });

  it("hides and reorders what Management chose, and appends widgets added to the catalogue later", () => {
    const out = resolveLayout("sales", [{ id: "quotes", visible: true }, { id: "todo", visible: false }], all);
    expect(out.slice(0, 2)).toEqual([{ id: "quotes", visible: true }, { id: "todo", visible: false }]);
    expect(out.map((e) => e.id).sort()).toEqual(widgetsFor("sales").map((w) => w.id).sort());
    expect(out.slice(2).every((e) => e.visible)).toBe(true);
  });

  it("never reveals a widget the keys do not grant, whatever was stored", () => {
    const stored = [
      { id: "invoice_tiles", visible: true },
      { id: "quotes", visible: true },
      { id: "social", visible: true },
    ];
    const out = resolveLayout("management", stored, keys());
    const ids = out.map((e) => e.id);
    expect(ids).not.toContain("invoice_tiles");
    expect(ids).not.toContain("quotes");
    expect(ids).not.toContain("social");
    // With the keys they come back, in the stored order.
    const full = resolveLayout("management", stored, keys("invoices.view", "finance.view.payments", "quotes.view", "social.view")).map((e) => e.id);
    expect(full.slice(0, 3)).toEqual(["invoice_tiles", "quotes", "social"]);
  });

  it("drops unknown ids, ids of another home and duplicates; a locked widget cannot be hidden", () => {
    const out = resolveLayout("marketing", [{ id: "social_overview", visible: false }, { id: "nope", visible: true }, { id: "todo", visible: true }, { id: "social_overview", visible: true }], all);
    expect(out).toEqual([{ id: "social_overview", visible: true }]);
  });
});

describe("layoutProblems", () => {
  it("accepts a good layout and refuses foreign, duplicate and locked-hidden widgets and unknown homes", () => {
    expect(layoutProblems("sales", [{ id: "todo", visible: false }])).toEqual([]);
    expect(layoutProblems("sales", [{ id: "ageing", visible: true }])).toHaveLength(1);
    expect(layoutProblems("sales", [{ id: "todo", visible: true }, { id: "todo", visible: true }])).toHaveLength(1);
    expect(layoutProblems("marketing", [{ id: "social_overview", visible: false }])).toHaveLength(1);
    expect(layoutProblems("nobody", [])).toHaveLength(1);
    expect(layoutProblems("sales", "x")).toHaveLength(1);
  });
});
