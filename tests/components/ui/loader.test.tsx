import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FigbloomLoader, LoaderBlock, LoadingState } from "@/ui";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the Figbloom Orbit loader", () => {
  it("announces that something is loading, with the logo and its label", () => {
    const { container } = render(<FigbloomLoader />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Getting things ready");
    expect(screen.getByRole("status").textContent).toMatch(/^Getting things ready\.\.\.$/);
    expect(container.querySelector(".fb-arc")).toBeTruthy();
    expect(container.querySelector(".fb-bowl")).toBeTruthy();
    expect(container.querySelector(".fb-leaf")).toBeTruthy();
  });

  it("covers the whole screen while the app or a page loads", () => {
    const { container } = render(<FigbloomLoader fullScreen label="Opening your workspace" />);
    expect((container.firstChild as HTMLElement).className).toBe("fb-loader-screen");
    expect(screen.getByRole("status", { name: "Opening your workspace" })).toBeInTheDocument();
  });

  it("has a small version for a card, a table or part of a page", () => {
    const { container } = render(<FigbloomLoader label="Loading" compact />);
    expect(screen.getByRole("status").className).toMatch(/fb-loader--compact/);
    expect((container.querySelector("svg") as SVGElement).style.width).toBe("48px");
  });

  it("LoaderBlock centres it in a page's space, or in a card when compact", () => {
    const page = render(<LoaderBlock label="Loading deals" />);
    expect((page.container.firstChild as HTMLElement).className).toBe("fb-loader-block");
    page.unmount();
    const card = render(<LoaderBlock label="Loading deals" compact />);
    expect((card.container.firstChild as HTMLElement).className).toMatch(/fb-loader-block--compact/);
  });

  it("LoadingState, the shared loading placeholder, is the loader too", () => {
    render(<LoadingState label="Loading the contact" />);
    expect(screen.getByRole("status", { name: "Loading the contact" }).className).toMatch(/fb-loader--compact/);
  });

  it("fades in when nothing was loading, and carries straight on from a loader that just went", () => {
    const t = 1_000_000;
    vi.spyOn(performance, "now").mockImplementation(() => t);
    const first = render(<FigbloomLoader label="Opening the page" />);
    expect(first.getByRole("status").className).toMatch(/fb-loader--fade-in/);
    first.unmount();
    const next = render(<FigbloomLoader label="Loading deals" />);
    expect(next.getByRole("status").className).not.toMatch(/fb-loader--fade-in/);
    expect(next.getByRole("status").style.getPropertyValue("--fb-phase")).toMatch(/^-?\d+(\.\d+)?ms$/);
  });
});
