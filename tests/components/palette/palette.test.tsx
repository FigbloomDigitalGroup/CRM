import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CommandPalette } from "../../../src/ui/screens/palette/CommandPalette";
import { buildPaletteItems, gotoShortcut } from "../../../src/ui/screens/palette/items";

const SALES = ["leads.view.own", "leads.create", "tasks.view.own", "tasks.create", "deals.view.own", "companies.view", "activities.create"];
const FINANCE = ["finance.view.payments", "deals.view.won", "reporting.view.own"];
const MANAGEMENT = [...SALES, "configuration.manage", "reporting.view.all", "deals.view.all", "contacts.view", "contacts.create", "companies.create"];

const titles = (keys: string[], query = "") => buildPaletteItems({ orgSlug: "figbloom", permissionKeys: keys, query }).flatMap((g) => g.items.map((i) => i.title));

describe("command palette: only what the role may use (X3, FIG-1172)", () => {
  it("lists create actions only for roles that may create", () => {
    expect(titles(SALES)).toContain("New lead");
    expect(titles(FINANCE)).not.toContain("New lead");
    expect(titles(FINANCE)).not.toContain("New task");
  });

  it("lists pages only for roles that may open them", () => {
    expect(titles(MANAGEMENT)).toContain("Go to Settings");
    expect(titles(SALES)).not.toContain("Go to Settings");
    expect(titles(FINANCE)).toContain("Go to Payments");
    expect(titles(SALES)).not.toContain("Go to Payments");
    expect(titles(FINANCE)).not.toContain("Go to Leads");
  });

  it("finds records only in lists the role may open", () => {
    expect(titles(SALES, "sarova")).toContain("Sarova Hotels");
    expect(titles(["finance.view.payments"], "sarova")).not.toContain("Sarova Hotels");
  });

  it("go-to shortcuts honour the same permissions", () => {
    expect(gotoShortcut("l", SALES, "figbloom")).toBe("/o/figbloom/leads");
    expect(gotoShortcut("l", FINANCE, "figbloom")).toBeNull();
    expect(gotoShortcut("z", SALES, "figbloom")).toBeNull();
  });
});

describe("<CommandPalette> keyboard", () => {
  function setup(keys = SALES) {
    const onClose = vi.fn();
    const onNavigate = vi.fn();
    const onRun = vi.fn();
    render(<CommandPalette open onClose={onClose} orgSlug="figbloom" permissionKeys={keys} onNavigate={onNavigate} onRun={onRun} />);
    return { onClose, onNavigate, onRun, user: userEvent.setup() };
  }

  it("focuses the box, moves with the arrows and opens with Enter", async () => {
    const { user, onNavigate, onClose } = setup();
    const box = screen.getByRole("combobox", { name: /search records/i });
    expect(box).toHaveFocus();
    await user.type(box, "go to tasks");
    await user.keyboard("{Enter}");
    expect(onNavigate).toHaveBeenCalledWith("/o/figbloom/tasks");
    expect(onClose).toHaveBeenCalled();
  });

  it("announces the highlighted option and wraps around", async () => {
    const { user } = setup();
    const box = screen.getByRole("combobox");
    const first = box.getAttribute("aria-activedescendant");
    await user.keyboard("{ArrowUp}");
    expect(box.getAttribute("aria-activedescendant")).not.toBe(first);
    expect(screen.getAllByRole("option").filter((o) => o.getAttribute("aria-selected") === "true")).toHaveLength(1);
  });

  it("runs shell commands (Ask Figbloom) instead of navigating", async () => {
    const { user, onRun, onNavigate } = setup();
    await user.type(screen.getByRole("combobox"), "ask figbloom");
    await user.keyboard("{Enter}");
    expect(onRun).toHaveBeenCalledWith("assistant");
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("closes on Escape and keeps Tab inside", async () => {
    const { user, onClose } = setup();
    await user.keyboard("{Tab}");
    expect(screen.getByRole("combobox")).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("says when nothing matches", async () => {
    const { user } = setup();
    await user.type(screen.getByRole("combobox"), "zzzzqq");
    expect(screen.getByRole("status")).toHaveTextContent("Nothing matches");
  });
});
