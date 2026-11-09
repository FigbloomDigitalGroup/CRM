import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AcceptInvitePage } from "../../../src/ui/screens/platform/SignIn";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/platform/accept-invite",
  useSearchParams: () => new URLSearchParams(),
}));

describe("Platform accept-invite page", () => {
  it("without a token says the link is incomplete and calls nothing", () => {
    const call = vi.fn();
    render(<AcceptInvitePage token="" call={call as never} />);
    expect(screen.getByText("This link is incomplete")).toBeTruthy();
    expect(call).not.toHaveBeenCalled();
  });

  it("checks length and match, then posts the token and password to the platform route", async () => {
    const user = userEvent.setup();
    const calls: [string, string, unknown][] = [];
    const call = (async (m: string, p: string, b?: unknown) => {
      calls.push([m, p, b]);
      return {};
    }) as never;
    render(<AcceptInvitePage token="tok-123" call={call} />);

    await user.click(screen.getByRole("button", { name: /Set password/ }));
    expect(screen.getByRole("alert").textContent).toMatch(/at least 12 characters/);

    await user.type(screen.getByLabelText("New password"), "a-long-enough-pass");
    await user.type(screen.getByLabelText("Repeat the password"), "different-password");
    await user.click(screen.getByRole("button", { name: /Set password/ }));
    expect(screen.getByRole("alert").textContent).toMatch(/do not match/);
    expect(calls).toHaveLength(0);

    await user.clear(screen.getByLabelText("Repeat the password"));
    await user.type(screen.getByLabelText("Repeat the password"), "a-long-enough-pass");
    await user.click(screen.getByRole("button", { name: /Set password/ }));
    await waitFor(() => expect(screen.getByText("Password set")).toBeTruthy());
    expect(calls).toEqual([["POST", "/api/platform/auth/accept-invite", { token: "tok-123", password: "a-long-enough-pass" }]]);
    expect(screen.getByRole("link", { name: /Go to sign-in/ }).getAttribute("href")).toBe("/platform/sign-in");
  });

  it("a used or expired link shows one plain sentence, not the server's words", async () => {
    const user = userEvent.setup();
    const call = (async () => {
      throw Object.assign(new Error("Token already used"), { status: 400 });
    }) as never;
    render(<AcceptInvitePage token="used" call={call} />);
    await user.type(screen.getByLabelText("New password"), "a-long-enough-pass");
    await user.type(screen.getByLabelText("Repeat the password"), "a-long-enough-pass");
    await user.click(screen.getByRole("button", { name: /Set password/ }));
    expect(await screen.findByText(/not valid any more/)).toBeTruthy();
    expect(screen.queryByText(/already used/)).toBeNull();
  });
});
