import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CommandPalette } from "../../../src/ui/screens/palette/CommandPalette";
import { buildPaletteItems, gotoShortcut } from "../../../src/ui/screens/palette/items";
import { renderScreen, type Handlers } from "../screens/home/harness";

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

  it("lists the records the search returned, only while something is typed", () => {
    const records = [{ id: "r1", group: "RECORDS" as const, title: "Sarova Hotels", href: "/o/figbloom/companies/c1" }];
    const t = (query: string) => buildPaletteItems({ orgSlug: "figbloom", permissionKeys: SALES, query, records }).flatMap((g) => g.items.map((i) => i.title));
    expect(t("sarova")).toContain("Sarova Hotels");
    expect(t("")).not.toContain("Sarova Hotels");
  });

  it("uses the server's command index when there is one: only what it lists, nothing from the local tables", () => {
    const commands = [
      { id: "go-leads", kind: "navigate" as const, title: "Go to Leads", path: "/leads", hint: "G L" },
      { id: "ask", kind: "assistant" as const, title: "Ask Figbloom", path: null, hint: null },
    ];
    const items = buildPaletteItems({ orgSlug: "figbloom", permissionKeys: MANAGEMENT, query: "", commands }).flatMap((g) => g.items);
    expect(items.map((i) => i.title)).toEqual(["Ask Figbloom", "Go to Leads"]);
    expect(items.find((i) => i.id === "ask")?.run).toBe("assistant");
    expect(items.find((i) => i.id === "go-leads")?.href).toBe("/o/figbloom/leads");
  });

  it("go-to shortcuts honour the same permissions", () => {
    expect(gotoShortcut("l", SALES, "figbloom")).toBe("/o/figbloom/leads");
    expect(gotoShortcut("l", FINANCE, "figbloom")).toBeNull();
    expect(gotoShortcut("z", SALES, "figbloom")).toBeNull();
  });
});

describe("<CommandPalette> keyboard", () => {
  function setup(keys = SALES, handlers: Handlers = {}) {
    const onClose = vi.fn();
    const onNavigate = vi.fn();
    const onRun = vi.fn();
    const view = renderScreen(<CommandPalette open onClose={onClose} orgSlug="figbloom" permissionKeys={keys} onNavigate={onNavigate} onRun={onRun} />, handlers);
    return { onClose, onNavigate, onRun, user: userEvent.setup(), ...view };
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

describe("<CommandPalette> on the real API (FIG-1149)", () => {
  it("reads the command index and lists exactly what the server allows", async () => {
    setupApi();
    await screen.findByText("Go to Payments");
    expect(screen.queryByText("New lead")).toBeNull();
  });

  it("searches records with /search from two characters and opens a hit", async () => {
    const { user, onNavigate, last, count } = setupApi();
    await user.type(screen.getByRole("combobox"), "s");
    await new Promise((r) => setTimeout(r, 300));
    expect(count("search")).toBe(0);
    await user.type(screen.getByRole("combobox"), "a");
    await screen.findByText("Sarova Hotels");
    expect(last("search")?.query).toMatchObject({ q: "sa" });
    await user.click(screen.getByText("Sarova Hotels"));
    expect(onNavigate).toHaveBeenCalledWith("/o/figbloom/companies/c1");
  });

  it("falls back to the role's own pages when the index is unavailable (organisation not on V1.1)", async () => {
    const view = renderScreen(<CommandPalette open onClose={vi.fn()} orgSlug="figbloom" permissionKeys={SALES} onNavigate={vi.fn()} onRun={vi.fn()} />, {
      getCommands: () => {
        throw { status: 403, envelope: { code: "FEATURE_UNAVAILABLE", message: "x", requestId: "r", fieldErrors: [] } };
      },
    });
    await waitFor(() => expect(view.count("getCommands")).toBe(1));
    expect(screen.getByText("New lead")).toBeInTheDocument();
    expect(screen.queryByText("Go to Payments")).toBeNull();
  });
});

function setupApi() {
  const onNavigate = vi.fn();
  const view = renderScreen(<CommandPalette open onClose={vi.fn()} orgSlug="figbloom" permissionKeys={FINANCE} onNavigate={onNavigate} onRun={vi.fn()} />, {
    getCommands: () => ({ commands: [{ id: "go-payments", kind: "navigate", title: "Go to Payments", path: "/payments", hint: null }], search: { types: ["companies"] }, shortcuts: [] }),
    search: () => ({ groups: [{ type: "companies", items: [{ id: "c1", label: "Sarova Hotels", sublabel: "Hospitality" }] }] }),
  });
  return { ...view, onNavigate, user: userEvent.setup() };
}
