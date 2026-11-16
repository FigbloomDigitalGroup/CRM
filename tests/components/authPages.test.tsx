import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * FIG-1592: the side pages of the sign-in area (forgot password, reset password, accept invite, two-step, not found, error) share one frame and one
 * set of states. Visual polish only: these tests check that every state is drawn, announced and has a way out, that errors are tied to the field,
 * and that axe finds nothing. What the pages DO is pinned by `tests/frozenAuthSource.test.ts`. (jsdom has no layout, so colour contrast is checked
 * by hand from the tokens; the region rule is off because each page is rendered on its own.)
 */

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/services/authService", () => ({
  getInviteInfo: vi.fn(async (token: string) => {
    if (token === "good") return { email: "new.person@example.com", requiresPassword: true };
    throw new Error("This invite has expired.");
  }),
}));
const callUncontracted = vi.fn();
vi.mock("@/ui/data/client", () => ({ callUncontracted: (...a: unknown[]) => callUncontracted(...a) }));

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockReset();
  refresh.mockReset();
  callUncontracted.mockReset();
});

async function violations(root: Element): Promise<string[]> {
  const result = await axe.run(root as HTMLElement, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  return result.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.html).join(" | ")}`);
}

function stubFetch(status: number, body: unknown) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("forgot password", () => {
  it("asks for the email, and has a way back", async () => {
    const { default: Page } = await import("../../src/app/forgot-password/page");
    const { container } = render(<Page />);
    expect(screen.getByRole("heading", { level: 1, name: "Reset your password" })).toBeTruthy();
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to sign in" }).getAttribute("href")).toBe("/login");
    expect(await violations(container)).toEqual([]);
  });

  it("after sending: says so, says where to look, and keeps the way back", async () => {
    stubFetch(200, {});
    const { default: Page } = await import("../../src/app/forgot-password/page");
    const { container } = render(<Page />);
    await userEvent.type(screen.getByLabelText("Email"), "a@b.co");
    await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    const note = await screen.findByRole("status");
    expect(note.textContent).toMatch(/Check your email/);
    expect(note.textContent).toMatch(/spam/);
    expect(screen.getByRole("link", { name: "Back to sign in" })).toBeTruthy();
    expect(await violations(container)).toEqual([]);
  });
});

describe("reset password", () => {
  it("without a code: an explained error with the two ways out", async () => {
    const { default: Page } = await import("../../src/app/reset-password/page");
    const { container } = render(await Page({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("alert").textContent).toMatch(/Missing reset token/);
    expect(screen.getByRole("link", { name: "Send me a new link" }).getAttribute("href")).toBe("/forgot-password");
    expect(screen.getByRole("link", { name: "Back to sign in" })).toBeTruthy();
    expect(await violations(container)).toEqual([]);
  });

  it("shows the password rule as you type", async () => {
    const { default: Page } = await import("../../src/app/reset-password/page");
    const { container } = render(await Page({ searchParams: Promise.resolve({ token: "t" }) }));
    const rules = screen.getByRole("list", { name: "Password rules" });
    expect(rules.textContent).toMatch(/At least 10 characters/);
    const field = container.querySelector("input[autocomplete='new-password']") as HTMLInputElement;
    await userEvent.type(field, "short");
    expect(rules.textContent).toMatch(/5 more to go/);
    await userEvent.type(field, "enough-now");
    expect(rules.textContent).toMatch(/done/);
    expect(await violations(container)).toEqual([]);
  });

  it("a link that is expired or used: the server's words, tied to the field, with a new-link route", async () => {
    stubFetch(400, { error: "This reset link has expired or was already used." });
    const { default: Page } = await import("../../src/app/reset-password/page");
    const { container } = render(await Page({ searchParams: Promise.resolve({ token: "t" }) }));
    const field = container.querySelector("input[autocomplete='new-password']") as HTMLInputElement;
    await userEvent.type(field, "a-long-enough-password");
    await userEvent.click(screen.getByRole("button", { name: "Set new password" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/expired or was already used/);
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.getAttribute("aria-describedby")).toContain(alert.id);
    expect(screen.getByRole("link", { name: "Send me a new link" })).toBeTruthy();
    expect(await violations(container)).toEqual([]);
  });

  it("success: says so, goes to sign-in after the same delay, and links there now", async () => {
    stubFetch(200, {});
    const { default: Page } = await import("../../src/app/reset-password/page");
    const { container } = render(await Page({ searchParams: Promise.resolve({ token: "t" }) }));
    await userEvent.type(container.querySelector("input[autocomplete='new-password']") as HTMLInputElement, "a-long-enough-password");
    await userEvent.click(screen.getByRole("button", { name: "Set new password" }));
    expect((await screen.findByRole("status")).textContent).toMatch(/Password updated/);
    expect(screen.getByRole("link", { name: "Sign in now" }).getAttribute("href")).toBe("/login");
    expect(await violations(container)).toEqual([]);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"), { timeout: 3000 });
  });
});

describe("accept invite", () => {
  it("a good invite: who it is for, the password field with its rule", async () => {
    const { default: Page } = await import("../../src/app/accept-invite/page");
    const { container } = render(await Page({ searchParams: Promise.resolve({ token: "good" }) }));
    expect(screen.getByRole("status").textContent).toMatch(/new\.person@example\.com/);
    expect(screen.getByRole("list", { name: "Password rules" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accept invite" })).toBeTruthy();
    expect(await violations(container)).toEqual([]);
  });

  it("a bad or missing invite: explained, with what to do next", async () => {
    const { default: Page } = await import("../../src/app/accept-invite/page");
    const { container } = render(await Page({ searchParams: Promise.resolve({ token: "bad" }) }));
    expect(screen.getByRole("alert").textContent).toMatch(/This invite has expired\./);
    expect(screen.getByText(/Ask the person who invited you/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to sign in" })).toBeTruthy();
    expect(await violations(container)).toEqual([]);
  });

  it("a refused submit: the error is tied to the password field", async () => {
    stubFetch(400, { error: "Password must be at least 10 characters." });
    const { default: Page } = await import("../../src/app/accept-invite/page");
    const { container } = render(await Page({ searchParams: Promise.resolve({ token: "good" }) }));
    const field = container.querySelector("input[autocomplete='new-password']") as HTMLInputElement;
    await userEvent.type(field, "x-long-enough-1");
    await userEvent.click(screen.getByRole("button", { name: "Accept invite" }));
    const alert = await screen.findByRole("alert");
    expect(field.getAttribute("aria-describedby")).toContain(alert.id);
    expect(await violations(container)).toEqual([]);
  });
});

describe("two-step sign-in", () => {
  it("expired: explained, with the way back", async () => {
    callUncontracted.mockRejectedValue({ status: 401 });
    const { TwoStepForm } = await import("../../src/app/two-step/TwoStepForm");
    const { container } = render(<TwoStepForm />);
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in again" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to sign-in" })).toBeTruthy();
    expect(await violations(container)).toEqual([]);
  });

  it("failed to load: says what to try", async () => {
    callUncontracted.mockRejectedValue({ status: 500 });
    const { TwoStepForm } = await import("../../src/app/two-step/TwoStepForm");
    render(<TwoStepForm />);
    expect(await screen.findByRole("heading", { level: 1, name: "Something went wrong" })).toBeTruthy();
    expect(screen.getByText(/Check your connection/)).toBeTruthy();
  });

  it("ready, then a wrong code: the error is announced and tied to the field; the backup-code switch works", async () => {
    callUncontracted.mockImplementation(async (_m: string, path: string) => {
      if (path.endsWith("/challenge")) return { purpose: "VERIFY", attemptsLeft: 5 };
      throw { status: 401 };
    });
    const { TwoStepForm } = await import("../../src/app/two-step/TwoStepForm");
    const { container } = render(<TwoStepForm />);
    const field = (await screen.findByLabelText("Authenticator code")) as HTMLInputElement;
    await userEvent.type(field, "123456");
    await userEvent.click(screen.getByRole("button", { name: "Verify and continue" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/4 attempts left/);
    expect(field.getAttribute("aria-describedby")).toBe(alert.id);
    expect(await violations(container)).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Use a backup code" }));
    expect(screen.getByLabelText("Backup code")).toBeTruthy();
  });
});

describe("two-step set-up", () => {
  it("could not start: an explained error and the way back", async () => {
    callUncontracted.mockRejectedValue({ status: 401 });
    const { SetupForm } = await import("../../src/app/two-step/setup/SetupForm");
    const { container } = render(<SetupForm />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/Sign in again/);
    expect(screen.getByRole("link", { name: "Back to sign-in" })).toBeTruthy();
    expect(await violations(container)).toEqual([]);
  });

  it("scan step then backup codes: labelled field, the codes in a list, Done waits for the tick", async () => {
    callUncontracted.mockImplementation(async (_m: string, path: string) => {
      if (path.endsWith("/challenge")) return { purpose: "ENROL" };
      if (path.endsWith("/enrol/start")) return { secret: "JBSWY3DPEHPK3PXP", otpauthUri: "otpauth://totp/x" };
      return { backupCodes: ["AAAA-1111", "BBBB-2222"], organizationSlug: "acme" };
    });
    const { SetupForm } = await import("../../src/app/two-step/setup/SetupForm");
    const { container } = render(<SetupForm />);
    const field = await screen.findByLabelText("Code from your app");
    expect(screen.getByText("JBSWY3DPEHPK3PXP")).toBeTruthy();
    expect(await violations(container)).toEqual([]);
    await userEvent.type(field, "123456");
    await userEvent.click(screen.getByRole("button", { name: "Turn on two-step sign-in" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Keep your backup codes" })).toBeTruthy();
    expect(screen.getAllByRole("listitem").length).toBe(2);
    expect((screen.getByRole("button", { name: "Done" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByLabelText("I saved these codes"));
    expect((screen.getByRole("button", { name: "Done" }) as HTMLButtonElement).disabled).toBe(false);
    expect(await violations(container)).toEqual([]);
  });
});

describe("not found and error", () => {
  it("not found: one clear way home", async () => {
    const { default: NotFound } = await import("../../src/app/not-found");
    const { container } = render(<NotFound />);
    expect(screen.getByRole("heading", { level: 1, name: "Page not found" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to FigBloom CRM" }).getAttribute("href")).toBe("/");
    expect(await violations(container)).toEqual([]);
  });

  it("error: try again calls reset, and the reference is shown for support", async () => {
    const reset = vi.fn();
    const { default: ErrorPage } = await import("../../src/app/error");
    const { container } = render(<ErrorPage error={Object.assign(new Error("boom"), { digest: "abc123" })} reset={reset} />);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(screen.getByText("abc123")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to FigBloom CRM" })).toBeTruthy();
    expect(await violations(container)).toEqual([]);
  });
});
