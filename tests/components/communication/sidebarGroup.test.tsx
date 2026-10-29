import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NavSection } from "../../../src/ui/shell/navModel";
import { Sidebar, SIDEBAR_GROUPS_KEY } from "../../../src/ui/shell/Sidebar";

let path = "/o/figbloom/leads";
vi.mock("next/navigation", () => ({ usePathname: () => path }));

const SECTIONS: NavSection[] = [
  { key: "workspace", label: "Sales workspace", items: [{ key: "leads", label: "Leads", path: "/leads", icon: "leads", tint: "g" }] },
  {
    key: "communication",
    label: "Communication",
    collapsible: true,
    icon: "communication",
    items: [
      { key: "conversations", label: "Conversations", path: "/conversations", icon: "conversations", tint: "o" },
      { key: "mail", label: "Mail", path: "/mail", icon: "mail", tint: "o", badge: 3 },
      { key: "chat", label: "Chat", path: "/chat", icon: "chat", tint: "o" },
      { key: "video", label: "Video Conference", path: "/video", icon: "video", tint: "o" },
    ],
  },
];

beforeEach(() => {
  localStorage.clear();
  path = "/o/figbloom/leads";
});

describe("the Communication dropdown (F6.20)", () => {
  it("is closed on a page outside the group, shows the unread count, and opens on a click", async () => {
    render(<Sidebar orgSlug="figbloom" sections={SECTIONS} initialCollapsed={false} />);
    const header = screen.getByRole("button", { name: /Communication/ });
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(header).toHaveTextContent("3");
    expect(screen.queryByRole("link", { name: "Chat" })).not.toBeInTheDocument();
    await userEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Conversations" })).toHaveAttribute("href", "/o/figbloom/conversations");
    expect(screen.getByRole("link", { name: "Video Conference" })).toHaveAttribute("href", "/o/figbloom/video");
    expect(JSON.parse(localStorage.getItem(SIDEBAR_GROUPS_KEY)!)).toEqual({ communication: true });
  });

  it("opens by itself on a page it holds and marks that page", () => {
    path = "/o/figbloom/chat";
    render(<Sidebar orgSlug="figbloom" sections={SECTIONS} initialCollapsed={false} />);
    expect(screen.getByRole("button", { name: /Communication/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Chat" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Conversations" })).not.toHaveAttribute("aria-current");
  });

  it("keeps the person's own choice on this device, even on a page it holds", async () => {
    localStorage.setItem(SIDEBAR_GROUPS_KEY, JSON.stringify({ communication: false }));
    path = "/o/figbloom/mail";
    render(<Sidebar orgSlug="figbloom" sections={SECTIONS} initialCollapsed={false} />);
    expect(await screen.findByRole("button", { name: /Communication/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("is operable from the keyboard", async () => {
    render(<Sidebar orgSlug="figbloom" sections={SECTIONS} initialCollapsed={false} />);
    const header = screen.getByRole("button", { name: /Communication/ });
    header.focus();
    await userEvent.keyboard("{Enter}");
    expect(header).toHaveAttribute("aria-expanded", "true");
    await userEvent.keyboard(" ");
    expect(header).toHaveAttribute("aria-expanded", "false");
  });

  it("opens while the filter box is in use, so a match inside it is found", async () => {
    render(<Sidebar orgSlug="figbloom" sections={SECTIONS} initialCollapsed={false} />);
    await userEvent.type(screen.getByRole("searchbox", { name: "Filter navigation" }), "video");
    expect(screen.getByRole("link", { name: "Video Conference" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Leads" })).not.toBeInTheDocument();
  });

  it("shows the links on their own, with no header, when the sidebar is collapsed to icons", () => {
    render(<Sidebar orgSlug="figbloom" sections={SECTIONS} initialCollapsed />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).queryByRole("button", { name: /Communication/ })).not.toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Chat" })).toBeInTheDocument();
  });
});
