import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { VerifyInviteForm } from "../../../src/app/invite/verify/VerifyInviteForm";

/** UC-F2: the new verify route's form. It posts the token and a fresh password to the accept endpoint and follows the hand-off. */
async function fill(password: string, confirm: string) {
  const fields = document.querySelectorAll<HTMLInputElement>("input[autocomplete='new-password']");
  const user = userEvent.setup();
  await user.type(fields[0], password);
  await user.type(fields[1], confirm);
  await user.click(screen.getByRole("button", { name: /Confirm and join/ }));
}

describe("VerifyInviteForm", () => {
  it("refuses a short password and a mismatch without calling the API", async () => {
    const call = vi.fn();
    render(<VerifyInviteForm token="tok" call={call as never} onDone={vi.fn()} />);
    await fill("short", "short");
    expect(screen.getByRole("alert").textContent).toMatch(/at least 10 characters/);
    expect(call).not.toHaveBeenCalled();
  });

  it("posts the token and the new password to the accept endpoint, then opens the organisation", async () => {
    const call = vi.fn(async () => ({ organizationSlug: "acme" }));
    const onDone = vi.fn();
    render(<VerifyInviteForm token="tok-1" call={call as never} onDone={onDone} />);
    await fill("a-fresh-password-1", "a-fresh-password-1");
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("/o/acme"));
    expect(call).toHaveBeenCalledWith("POST", "/api/auth/accept-invite", { token: "tok-1", password: "a-fresh-password-1" });
  });

  it("refuses a mismatch", async () => {
    const call = vi.fn();
    render(<VerifyInviteForm token="tok" call={call as never} onDone={vi.fn()} />);
    await fill("a-fresh-password-1", "a-different-password");
    expect(screen.getByRole("alert").textContent).toMatch(/do not match/);
    expect(call).not.toHaveBeenCalled();
  });

  it("follows the two-step hand-off when the organisation needs a second step", async () => {
    const call = vi.fn(async () => ({ organizationSlug: "acme", twoStepRequired: true, twoStepUrl: "/two-step" }));
    const onDone = vi.fn();
    render(<VerifyInviteForm token="tok-2" call={call as never} onDone={onDone} />);
    await fill("a-fresh-password-1", "a-fresh-password-1");
    await waitFor(() => expect(onDone).toHaveBeenCalledWith("/two-step"));
  });

  it("shows the server's refusal and stays on the page", async () => {
    const call = vi.fn(async () => {
      throw Object.assign(new Error("Invalid or expired invite link."), { status: 400 });
    });
    const onDone = vi.fn();
    render(<VerifyInviteForm token="tok-3" call={call as never} onDone={onDone} />);
    await fill("a-fresh-password-1", "a-fresh-password-1");
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(onDone).not.toHaveBeenCalled();
  });
});
