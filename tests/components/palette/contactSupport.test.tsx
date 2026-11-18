import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ContactSupportDialog } from "../../../src/ui/screens/palette/ContactSupportDialog";
import { apiError, expectNoAxeViolations, renderScreen } from "../screens/home/harness";

vi.mock("next/navigation", () => ({ usePathname: () => "/o/figbloom/deals/d1" }));

/** Contact support (docs/SUPPORT_BY_EMAIL.md): any member asks Figbloom for help by email. */

function setup(handlers: Parameters<typeof renderScreen>[1] = {}) {
  const onClose = vi.fn();
  const view = renderScreen(<ContactSupportDialog onClose={onClose} />, handlers);
  return { onClose, user: userEvent.setup(), ...view };
}

describe("<ContactSupportDialog>", () => {
  it("cannot be sent until there is a subject and a message", async () => {
    const { user } = setup();
    const send = screen.getByRole("button", { name: "Send request" });
    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText("What do you need help with?"), "Cannot export");
    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText("Tell us more"), "Nothing happens.");
    expect(send).toBeEnabled();
  });

  it("sends the request with the page the member was on, and shows the reference to quote", async () => {
    const { user, last } = setup({ createSupportRequest: () => ({ reference: "FB-20261105-K7Q2X9", sent: true }) });
    await user.type(screen.getByLabelText("What do you need help with?"), "Cannot export");
    await user.type(screen.getByLabelText("Tell us more"), "Nothing happens.");
    await user.selectOptions(screen.getByLabelText("Kind of request"), "PROBLEM");
    await user.click(screen.getByLabelText(/This is urgent/));
    await user.click(screen.getByRole("button", { name: "Send request" }));

    expect(await screen.findByTestId("support-reference")).toHaveTextContent("FB-20261105-K7Q2X9");
    expect(screen.getByText("Your request is on its way")).toBeInTheDocument();
    expect(last("createSupportRequest")).toMatchObject({
      params: { orgSlug: "figbloom" },
      body: { subject: "Cannot export", message: "Nothing happens.", category: "PROBLEM", urgency: "URGENT", pagePath: "/o/figbloom/deals/d1" },
    });
  });

  it("says plainly when email delivery is not set up, instead of claiming it was sent", async () => {
    const { user } = setup({ createSupportRequest: () => ({ reference: "FB-20261105-AAAAAA", sent: false }) });
    await user.type(screen.getByLabelText("What do you need help with?"), "Hello");
    await user.type(screen.getByLabelText("Tell us more"), "Anyone there?");
    await user.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByText("Request recorded")).toBeInTheDocument();
    expect(screen.getByText(/nothing was sent/)).toBeInTheDocument();
  });

  it("keeps what was typed and shows the reason when the request fails", async () => {
    const { user } = setup({
      createSupportRequest: () => {
        throw apiError(429, { code: "RATE_LIMITED", message: "Too many requests. Please try again later." });
      },
    });
    await user.type(screen.getByLabelText("What do you need help with?"), "Cannot export");
    await user.type(screen.getByLabelText("Tell us more"), "Nothing happens.");
    await user.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Tell us more")).toHaveValue("Nothing happens."));
  });

  it("closes with Cancel and has no accessibility violations", async () => {
    const { user, onClose, baseElement } = setup();
    await expectNoAxeViolations(baseElement);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalled();
  });
});
