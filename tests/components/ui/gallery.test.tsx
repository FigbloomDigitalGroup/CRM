import axe from "axe-core";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../../src/ui";
import { Gallery } from "../../../src/ui/Gallery";
import { defaultLook } from "../../../src/ui/theme/resolve";
import { ThemeProvider } from "../../../src/ui/theme/ThemeProvider";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

/**
 * F1.02: axe over the component gallery, which shows every component in every variant and state. jsdom has no layout, so the colour-contrast
 * rule (which needs rendered colours) is not run here: the contrast of every token pair is checked exactly in themeEngine.test.ts, and the
 * rendered check runs in the browser in e2e/ui-gallery.spec.ts.
 */

function page() {
  return (
    <ThemeProvider initialLook={defaultLook()} initialDensity="COMFORTABLE">
      <ToastProvider>
        <main>
          <h1>Component gallery</h1>
          <Gallery />
        </main>
      </ToastProvider>
    </ThemeProvider>
  );
}

async function violations(root: Element) {
  const result = await axe.run(root as HTMLElement, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  return result.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join("; ")})`);
}

describe("component gallery accessibility", () => {
  it("has no axe violations as it first renders (every component, variant and state)", async () => {
    const { container } = render(page());
    expect(await violations(container)).toEqual([]);
  });

  it("has none with every device mode on (bold, higher contrast, reduced motion, markers, compact, 375px preview)", async () => {
    const user = userEvent.setup();
    const { container } = render(page());
    for (const name of ["Bold text", "Higher contrast", "Reduce motion", "Status markers", "Preview at 375px"]) await user.click(screen.getByRole("checkbox", { name }));
    await user.click(screen.getByRole("button", { name: /Density/ }));
    expect(await violations(container)).toEqual([]);
    expect(screen.getByTestId("gallery-frame")).toHaveStyle({ width: "375px" });
  });

  it("has none with a dialog, a confirm dialog and a drawer open", async () => {
    const user = userEvent.setup();
    render(page());
    for (const [open, name] of [["Dialog", "Rename view"], ["Confirm dialog", "Archive this lead?"], ["Drawer", "New lead"]] as const) {
      await user.click(screen.getByRole("button", { name: open }));
      const dialog = await screen.findByRole("dialog", { name });
      expect(await violations(dialog)).toEqual([]);
      await user.keyboard("{Escape}");
    }
  });

  it("every interactive control can be reached with the keyboard alone", async () => {
    const user = userEvent.setup();
    const { container } = render(page());
    const interactive = container.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, [role='tab'], [role='combobox']");
    const tabbable = new Set<HTMLElement>();
    // Walk the page with Tab (bounded) and record what receives focus.
    for (let i = 0; i < 400; i++) {
      await user.tab();
      const el = document.activeElement as HTMLElement;
      if (!el || el === document.body) break;
      if (tabbable.has(el)) break;
      tabbable.add(el);
    }
    // A radio group is one tab stop (arrow keys move within it), so a radio is reachable when its group has a tab stop.
    const groupReached = (el: HTMLElement) => el instanceof HTMLInputElement && el.type === "radio" && [...tabbable].some((t) => t instanceof HTMLInputElement && t.type === "radio" && t.name === el.name);
    const unreachable = [...interactive].filter((el) => !tabbable.has(el) && !groupReached(el) && el.tabIndex >= 0 && !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true" && !el.closest("[hidden]"));
    expect(unreachable.map((el) => el.outerHTML.slice(0, 80))).toEqual([]);
  });

  it("shows each of the seven states", () => {
    render(page());
    for (const title of ["State: loading", "State: empty", "State: error", "State: no access", "State: masked value", "State: archived", "State: offline"]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
    const noAccess = screen.getByRole("heading", { name: "State: no access" }).closest("section")!;
    expect(within(noAccess).getByText("Leads isn’t part of your workspace.")).toBeInTheDocument();
  });
});
