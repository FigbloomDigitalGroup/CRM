import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EmptyHome } from "../../src/ui/screens/home/Home";

vi.mock("../../src/ui/data/member", () => ({
  useMember: () => ({ orgSlug: "acme", can: () => true }),
}));

describe("Home first-run calls to action (FIG-1586)", () => {
  it("Management: Invite members opens Members and Connect the website form opens Website integration", () => {
    render(<EmptyHome kind="management" />);
    expect(screen.getByRole("link", { name: /Invite members/ }).getAttribute("href")).toBe("/o/acme/settings?tab=members");
    expect(screen.getByRole("link", { name: /Connect the website form/ }).getAttribute("href")).toBe("/o/acme/settings?tab=website");
  });

  it("other roles get no Settings link", () => {
    for (const kind of ["sales", "delivery", "finance", "technical"] as const) {
      const { container, unmount } = render(<EmptyHome kind={kind} />);
      expect(container.querySelector('a[href*="/settings"]')).toBeNull();
      unmount();
    }
  });
});
