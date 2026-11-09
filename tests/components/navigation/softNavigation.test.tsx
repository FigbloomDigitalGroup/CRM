import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Menu, isInAppHref } from "../../../src/ui/components/overlays";
import { AssistantPanel } from "../../../src/ui/screens/assistant/AssistantPanel";
import { HelpCentre } from "../../../src/ui/screens/palette/HelpCentre";
import { HelpPanel } from "../../../src/ui/screens/palette/HelpPanel";
import { renderScreen } from "../screens/home/harness";

/**
 * In-app links must be client-side transitions (next/link), not document loads that rebuild the shell. `next/link` is replaced by a stand-in that
 * marks itself and cancels the browser's own navigation, exactly as the real one does after it hands the click to the router.
 */
const soft = vi.hoisted(() => ({ navigations: [] as string[] }));
vi.mock("next/link", () => ({
  default: ({ href, children, onClick, ...rest }: { href: string; children: React.ReactNode; onClick?: (e: React.MouseEvent) => void } & Record<string, unknown>) => (
    <a
      {...rest}
      href={href}
      data-soft-link="true"
      onClick={(e) => {
        onClick?.(e);
        e.preventDefault();
        soft.navigations.push(href);
      }}
    >
      {children}
    </a>
  ),
}));

describe("in-app links navigate softly (no document reload)", () => {
  it("only app pages count as in-app hrefs", () => {
    expect(isInAppHref("/o/figbloom/leads")).toBe(true);
    for (const h of ["/api/orgs/x/export", "//evil.example", "https://example.com", "tel:+254700000000", "mailto:a@b.c", "#x"]) expect(isInAppHref(h)).toBe(false);
  });

  it("a row menu item with an app path is a Link; api, tel and external items stay plain anchors; onSelect still runs", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <Menu
        label="Row actions"
        trigger="Actions"
        items={[
          { key: "open", label: "Open", href: "/o/figbloom/leads/l1", onSelect },
          { key: "csv", label: "Export", href: "/api/orgs/figbloom/leads/export" },
          { key: "call", label: "Call", href: "tel:+254700000000" },
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Actions" }));
    const open = screen.getByRole("menuitem", { name: "Open" });
    expect(open).toHaveAttribute("data-soft-link", "true");
    expect(open).toHaveAttribute("href", "/o/figbloom/leads/l1");
    expect(screen.getByRole("menuitem", { name: "Export" })).not.toHaveAttribute("data-soft-link");
    expect(screen.getByRole("menuitem", { name: "Call" })).not.toHaveAttribute("data-soft-link");
    await user.click(open);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(soft.navigations).toContain("/o/figbloom/leads/l1");
  });

  it("the Help panel links go through Link", () => {
    renderScreen(<HelpPanel open onClose={() => undefined} pathname="/o/figbloom/leads" orgSlug="figbloom" />, {});
    for (const [name, href] of [["Open the Help centre", "/o/figbloom/help"], ["All that’s new", "/o/figbloom/help/whats-new"]] as const) {
      const a = screen.getByRole("link", { name });
      expect(a).toHaveAttribute("data-soft-link", "true");
      expect(a).toHaveAttribute("href", href);
    }
  });

  it("the Help centre tabs go through Link and keep aria-current", () => {
    renderScreen(<HelpCentre orgSlug="figbloom" view="help" />, { getHelp: () => ({ items: [] }), getCommands: () => ({ shortcuts: [] }) });
    const help = screen.getByRole("link", { name: "Help" });
    expect(help).toHaveAttribute("data-soft-link", "true");
    expect(help).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "What’s new" })).toHaveAttribute("href", "/o/figbloom/help/whats-new");
  });

  it("the assistant's Settings link goes through Link", () => {
    renderScreen(
      <AssistantPanel open onClose={() => undefined} enabled={false} ctx={{ page: "leads" } as never} respond={(async () => ({})) as never} onConfirmAction={() => undefined as never} onDismissAction={() => undefined as never} onFeedback={() => undefined as never} settingsHref="/o/figbloom/settings?tab=ai" />,
      {},
    );
    const a = screen.getByRole("link", { name: /Settings, AI assistant/ });
    expect(a).toHaveAttribute("data-soft-link", "true");
    expect(a).toHaveAttribute("href", "/o/figbloom/settings?tab=ai");
  });

  it("no in-app anchor is left as a plain <a href> in the screens that were converted (chat card, mobile sync)", () => {
    for (const file of ["src/ui/screens/communication/ChatWorkspace.tsx", "src/ui/screens/mobile/Sheets.tsx", "src/ui/screens/palette/HelpCentre.tsx", "src/ui/screens/palette/HelpPanel.tsx"]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/<a\s[^>]*href=\{`\/o\//);
      expect(source, file).toMatch(/import Link from "next\/link"/);
    }
  });
});
