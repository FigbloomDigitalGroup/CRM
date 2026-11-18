import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NavSection } from "../../../src/ui/shell/navModel";
import { Sidebar } from "../../../src/ui/shell/Sidebar";

vi.mock("next/navigation", () => ({ usePathname: () => "/o/figbloom" }));
vi.mock("../../../src/ui/data/hooks", () => ({ useApi: () => ({ call: vi.fn() }) }));

const SECTIONS: NavSection[] = [
  { key: "overview", label: "Overview", items: [{ key: "dashboard", label: "Dashboard", path: "", icon: "dashboard", tint: "w", exact: true }] },
  { key: "insights", label: "Insights & settings", bottom: true, items: [{ key: "forecast", label: "Forecast & targets", path: "/forecast", icon: "forecast", tint: "o" }] },
  { key: "workspace", label: "Sales workspace", items: [{ key: "leads", label: "Leads", path: "/leads", icon: "leads", tint: "g" }] },
];

beforeEach(() => localStorage.clear());

describe("the sidebar's look (the HR-style revamp)", () => {
  it("draws 'Insights & settings' inside the one scrolling list, after the other sections, not as a pinned block", () => {
    const { container } = render(<Sidebar orgSlug="figbloom" sections={SECTIONS} initialCollapsed={false} />);
    expect(container.querySelector(".fb-sidebar__bottom")).toBeNull();
    const labels = Array.from(container.querySelectorAll(".fb-sidebar__nav .fb-sidebar__label")).map((e) => e.textContent);
    expect(labels).toEqual(["Overview", "Sales workspace", "Insights & settings"]);
  });

  it("gives Forecast & targets its own target icon, apart from My metrics", () => {
    render(<Sidebar orgSlug="figbloom" sections={SECTIONS} initialCollapsed={false} />);
    const icon = screen.getByRole("link", { name: "Forecast & targets" }).querySelector("svg");
    expect(icon?.getAttribute("class")).toContain("lucide-target");
  });

  it("keeps the order of the links the same for every role: top sections, then insights", () => {
    render(<Sidebar orgSlug="figbloom" sections={SECTIONS} initialCollapsed={false} />);
    expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual(["Dashboard", "Leads", "Forecast & targets"]);
  });
});
