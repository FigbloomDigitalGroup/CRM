import { describe, expect, it } from "vitest";
import { mobileTabs, tabForPath } from "../../../src/ui/screens/mobile/tabs";

const ids = (keys: string[]) => mobileTabs(keys).map((t) => t.id);

describe("mobile tabs follow permissions, not role names (F4.10)", () => {
  it("sales: Today, Leads, Capture, Customers, Tasks", () => {
    expect(ids(["leads.view.own", "leads.create", "contacts.create", "contacts.view", "companies.view", "tasks.view.own"])).toEqual(["today", "leads", "capture", "customers", "tasks"]);
  });
  it("delivery: Today, Customers, Note, Tasks", () => {
    expect(ids(["companies.view", "contacts.view", "activities.create", "tasks.view.own"])).toEqual(["today", "customers", "note", "tasks"]);
  });
  it("finance: Today, Customers, Alerts", () => {
    expect(ids(["companies.view", "contacts.view"])).toEqual(["today", "customers", "alerts"]);
  });
  it("technical: My work, Tasks, Alerts", () => {
    const tabs = mobileTabs(["mywork.view", "tasks.view.own"]);
    expect(tabs.map((t) => t.id)).toEqual(["today", "tasks", "alerts"]);
    expect(tabs[0]!.label).toBe("My work");
  });
  it("only the action in the middle is raised", () => {
    expect(mobileTabs(["leads.view.own", "leads.create", "contacts.create"]).filter((t) => t.center)).toHaveLength(1);
  });
  it("maps a path to its tab", () => {
    expect(tabForPath("/o/x/m", "x")).toBe("today");
    expect(tabForPath("/o/x/m/leads", "x")).toBe("leads");
    expect(tabForPath("/o/x/leads", "x")).toBeNull();
  });
});
