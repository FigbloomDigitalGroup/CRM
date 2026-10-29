import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { TwoStepForm } from "../../../../src/app/two-step/TwoStepForm";

describe("Two-step code screen (FIG-1167, A5)", () => {
  it("says how many attempts are left after a wrong code and locks after five", async () => {
    render(<TwoStepForm />);
    for (let i = 4; i >= 1; i--) {
      await userEvent.clear(screen.getByLabelText("Authenticator code"));
      await userEvent.type(screen.getByLabelText("Authenticator code"), "000000");
      await userEvent.click(screen.getByRole("button", { name: "Verify and continue" }));
      expect(await screen.findByText(new RegExp(`${i} attempt`))).toBeInTheDocument();
    }
    await userEvent.clear(screen.getByLabelText("Authenticator code"));
    await userEvent.type(screen.getByLabelText("Authenticator code"), "000000");
    await userEvent.click(screen.getByRole("button", { name: "Verify and continue" }));
    expect(screen.getByText(/locked for 30 minutes/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Authenticator code")).not.toBeInTheDocument();
  });

  it("switches to a backup code", async () => {
    render(<TwoStepForm />);
    await userEvent.click(screen.getByRole("button", { name: "Use a backup code" }));
    expect(screen.getByLabelText("Backup code")).toBeInTheDocument();
    expect(screen.queryByText(/Remember this device/)).not.toBeInTheDocument();
  });
});
