import { describe, expect, it } from "vitest";
import { addView, mayEdit, moveView, nameProblem, pinnedViews, removeView, renameView, setPinned, setShared, visibleViews, type SavedView } from "../../../src/ui/screens/views/model";

const SALES = { membershipId: "m-sales", permissionKeys: ["leads.view.own"] };
const FINANCE = { membershipId: "m-fin", permissionKeys: ["finance.view.payments"] };
const STATE = { tab: "all", filters: { temp: "HOT" } };

function make(): SavedView[] {
  let v: SavedView[] = [];
  v = addView(v, { id: "a", name: "Hot", page: "leads", state: STATE, by: "m-sales", byName: "Sales" });
  v = addView(v, { id: "b", name: "Cold", page: "leads", state: STATE, by: "m-sales", byName: "Sales" });
  v = addView(v, { id: "c", name: "Mine", page: "leads", state: STATE, by: "m-other", byName: "Other" });
  return v;
}

describe("saved views (X4, FIG-1173)", () => {
  it("a new view is personal and not pinned", () => {
    const v = make();
    expect(v.find((x) => x.id === "a")).toMatchObject({ shared: false, pinned: false });
  });

  it("a personal view is seen only by its owner; sharing shows it to colleagues whose role may open the list", () => {
    let v = make();
    expect(visibleViews(v, SALES).map((x) => x.id)).toEqual(["a", "b"]);
    v = setShared(v, "c", true);
    expect(visibleViews(v, SALES).map((x) => x.id)).toEqual(["a", "b", "c"]);
    // A role that cannot open Leads sees none of them, shared or not: sharing never widens access.
    expect(visibleViews(v, FINANCE)).toEqual([]);
  });

  it("only pinned views appear in the sidebar, and a shared pinned view appears for permitted colleagues", () => {
    let v = make();
    v = setShared(setPinned(v, "c", true), "c", true);
    v = setPinned(v, "a", true);
    expect(pinnedViews(v, SALES).map((x) => x.id)).toEqual(["a", "c"]);
    expect(pinnedViews(v, FINANCE)).toEqual([]);
  });

  it("renames, and refuses an empty, over-long or duplicate name", () => {
    const v = make();
    expect(renameView(v, "a", "  Hottest ").find((x) => x.id === "a")!.name).toBe("Hottest");
    expect(() => renameView(v, "a", "")).toThrow("Give the view a name.");
    expect(() => renameView(v, "a", "cold")).toThrow("already have a view");
    expect(nameProblem("x".repeat(41), v)).toMatch(/40 characters/);
    expect(renameView(v, "a", "Hot")).toBeTruthy(); // its own name is not a duplicate
  });

  it("reorders among the views the person sees and keeps the order clean", () => {
    let v = make();
    v = moveView(v, "b", -1, SALES);
    expect(visibleViews(v, SALES).map((x) => x.id)).toEqual(["b", "a"]);
    // Moving the first up, or the last down, changes nothing.
    expect(moveView(v, "b", -1, SALES)).toBe(v);
    expect(moveView(v, "a", 1, SALES)).toBe(v);
  });

  it("deletes a view, and only the owner may edit one", () => {
    const v = make();
    expect(removeView(v, "a").map((x) => x.id)).toEqual(["b", "c"]);
    expect(mayEdit(v[0]!, "m-sales")).toBe(true);
    expect(mayEdit(v[2]!, "m-sales")).toBe(false);
  });
});
