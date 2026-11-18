import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { landingFor, TwoStepForm } from "../../../../src/app/two-step/TwoStepForm";
import { SetupForm } from "../../../../src/app/two-step/setup/SetupForm";
import { apiError } from "../deals/harness";

const call = vi.hoisted(() => vi.fn());
vi.mock("../../../../src/ui/data/client", async (orig) => ({ ...(await orig<typeof import("../../../../src/ui/data/client")>()), callUncontracted: call }));

const assign = vi.fn();
beforeEach(() => {
  call.mockReset();
  assign.mockReset();
  vi.stubGlobal("location", { ...window.location, assign });
});

describe("Two-step code screen (FIG-1167, A5, wired to FIG-1134)", () => {
  it("asks the API for the challenge, counts attempts from the 401s and ends after the last one", async () => {
    call.mockImplementation(async (method: string, path: string) => {
      if (method === "GET") return { purpose: "VERIFY", attemptsLeft: 2 };
      expect(path).toBe("/api/auth/two-step/verify");
      throw apiError(401);
    });
    render(<TwoStepForm />);
    const field = await screen.findByLabelText("Authenticator code");
    await userEvent.type(field, "000000");
    await userEvent.click(screen.getByRole("button", { name: "Verify and continue" }));
    expect(await screen.findByText(/1 attempt left/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Verify and continue" }));
    expect(await screen.findByText(/Too many wrong codes/, { selector: "h1" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Authenticator code")).not.toBeInTheDocument();
  });

  it("signs in with a good code and opens the organisation", async () => {
    call.mockImplementation(async (method: string) => (method === "GET" ? { purpose: "VERIFY", attemptsLeft: 5 } : { userId: "u1", organizationSlug: "figbloom", awaitingAccess: false }));
    render(<TwoStepForm />);
    await userEvent.type(await screen.findByLabelText("Authenticator code"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Verify and continue" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("POST", "/api/auth/two-step/verify", { code: "123456", rememberDevice: true }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/o/figbloom"), { timeout: 3000 });
  });

  it("switches to a backup code (no remember box)", async () => {
    call.mockResolvedValue({ purpose: "VERIFY", attemptsLeft: 5 });
    render(<TwoStepForm />);
    await userEvent.click(await screen.findByRole("button", { name: "Use a backup code" }));
    expect(screen.getByLabelText("Backup code")).toBeInTheDocument();
    expect(screen.queryByText(/Remember this device/)).not.toBeInTheDocument();
  });

  it("sends a person who has no pending step back to sign-in", async () => {
    call.mockRejectedValue(apiError(401));
    render(<TwoStepForm />);
    expect(await screen.findByText("Sign in again")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to sign-in" })).toHaveAttribute("href", "/login");
  });

  it("an account without an organisation lands on the home route", () => {
    expect(landingFor({ organizationSlug: "account" })).toBe("/");
    expect(landingFor({ organizationSlug: "figbloom", awaitingAccess: true })).toBe("/");
    expect(landingFor({ organizationSlug: "figbloom" })).toBe("/o/figbloom");
  });
});

describe("Two-step enrolment (FIG-1167)", () => {
  it("at sign-in: shows the key from the API, confirms with a code and shows the backup codes once", async () => {
    call.mockImplementation(async (method: string, path: string) => {
      if (path === "/api/auth/two-step/challenge") return { purpose: "ENROL" };
      if (path === "/api/auth/two-step/enrol/start") return { secret: "JBSWY3DPEHPK3PXP", otpauthUri: "otpauth://totp/Figbloom:x?secret=JBSWY3DPEHPK3PXP" };
      if (path === "/api/auth/two-step/enrol/confirm") return { backupCodes: ["AAAA-1111", "BBBB-2222"], organizationSlug: "figbloom", awaitingAccess: false };
      throw new Error(`${method} ${path}`);
    });
    render(<SetupForm />);
    expect(await screen.findByText(/JBSWY3DPEHPK3PXP/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Code from your app"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Turn on two-step sign-in" }));
    expect(await screen.findByText("AAAA-1111")).toBeInTheDocument();
    const done = screen.getByRole("button", { name: "Done" });
    expect(done).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox", { name: /I saved these codes/ }));
    await userEvent.click(done);
    expect(assign).toHaveBeenCalledWith("/o/figbloom");
  });

  it("from Settings: uses the session routes", async () => {
    call.mockImplementation(async (_m: string, path: string) => {
      if (path === "/api/auth/two-step/challenge") throw apiError(401);
      if (path === "/api/me/two-step/enrol/start") return { secret: "KEYKEYKEY", otpauthUri: "otpauth://x" };
      return { backupCodes: ["CCCC-3333"] };
    });
    render(<SetupForm />);
    expect(await screen.findByText(/KEYKEYKEY/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Code from your app"), "654321");
    await userEvent.click(screen.getByRole("button", { name: "Turn on two-step sign-in" }));
    expect(await screen.findByText("CCCC-3333")).toBeInTheDocument();
    expect(call).toHaveBeenCalledWith("POST", "/api/me/two-step/enrol/confirm", { code: "654321" });
  });

  it("refuses a wrong code with the API's message", async () => {
    call.mockImplementation(async (_m: string, path: string) => {
      if (path === "/api/auth/two-step/challenge") throw apiError(401);
      if (path.endsWith("/enrol/start")) return { secret: "K", otpauthUri: "otpauth://x" };
      throw apiError(400, "That code is not right.", { code: "VALIDATION_FAILED" });
    });
    render(<SetupForm />);
    await userEvent.type(await screen.findByLabelText("Code from your app"), "111111");
    await userEvent.click(screen.getByRole("button", { name: "Turn on two-step sign-in" }));
    expect(await screen.findByText("That code is not right.")).toBeInTheDocument();
  });
});
