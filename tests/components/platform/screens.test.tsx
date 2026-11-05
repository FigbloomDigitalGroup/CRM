import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { platformCall } from "../../../src/ui/screens/platform/api";
import { PlatformAdmins, PlatformSecurity } from "../../../src/ui/screens/platform/AdminsSecurity";
import { DataRequests } from "../../../src/ui/screens/platform/DataRequests";
import { SystemHealth } from "../../../src/ui/screens/platform/HealthAudit";
import { PlatformHome } from "../../../src/ui/screens/platform/Home";
import { PlatformMobile } from "../../../src/ui/screens/platform/Mobile";
import { OrgDetail } from "../../../src/ui/screens/platform/OrgDetail";
import { Organisations } from "../../../src/ui/screens/platform/Organisations";
import { ProvisionWizard } from "../../../src/ui/screens/platform/Provision";
import { VerifyPage } from "../../../src/ui/screens/platform/Verify";
import { ApiError, fixtures, makeCall, renderConsole } from "./fakePlatform";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/platform",
  useSearchParams: () => new URLSearchParams(),
}));

describe("the console only calls platform routes", () => {
  it("refuses a tenant route", () => {
    expect(() => platformCall("GET", "/api/orgs/figbloom/leads")).toThrow(/only call \/api\/platform/);
  });
});

describe("Platform home (PL1)", () => {
  it("reads /api/platform/home, says what needs attention and that no customer records are shown", async () => {
    const { call, calls } = makeCall();
    renderConsole(<PlatformHome />, call);
    expect(await screen.findByText("4 things need attention")).toBeTruthy();
    expect(screen.getByText(/No customer records are shown here/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Email delivery · Degraded/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /1 open incident/ })).toBeTruthy();
    expect(screen.getByText("Organisations").closest("a")!.textContent).toContain("3");
    expect(calls.some(([m, p]) => m === "GET" && p === "/api/platform/home")).toBe(true);
    expect(calls.every(([, p]) => p.startsWith("/api/platform/"))).toBe(true);
  });

  it("has loading and error states with Retry, and an explained no-access", async () => {
    const user = userEvent.setup();
    let fail: unknown = new ApiError(500, { message: "boom" });
    const { call } = makeCall((m, p) => (p === "/api/platform/home" && fail ? (fail as Error) : undefined));
    renderConsole(<PlatformHome />, call);
    expect(screen.getByRole("status", { name: /Loading platform metrics/ })).toBeTruthy();
    expect((await screen.findByRole("alert")).textContent).toMatch(/Platform metrics didn’t load/);
    fail = null;
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("4 things need attention")).toBeTruthy();
  });

  it("explains a refusal instead of hiding the screen", async () => {
    const { call } = makeCall((m, p) => (p === "/api/platform/home" ? new ApiError(403, { message: "no" }) : undefined));
    renderConsole(<PlatformHome />, call);
    expect((await screen.findByRole("alert")).textContent).toMatch(/Your platform role doesn’t include this/);
  });
});

describe("Organisations (PL2)", () => {
  it("lists counts only from the API, filters by name and says when nothing matches", async () => {
    const user = userEvent.setup();
    renderConsole(<Organisations />, makeCall().call);
    expect(await screen.findByRole("link", { name: "FigBloom Digital Group" })).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(4);
    await user.type(screen.getByLabelText("Search name or slug"), "west");
    expect(screen.getAllByRole("row")).toHaveLength(2);
    await user.clear(screen.getByLabelText("Search name or slug"));
    await user.type(screen.getByLabelText("Search name or slug"), "zzz");
    expect(screen.getByText(/No organisation matches “zzz”/)).toBeTruthy();
  });
});

describe("Provision wizard (PL3)", () => {
  it("checks the slug with the API, then provisions with the first admin and opens the organisation", async () => {
    const user = userEvent.setup();
    push.mockClear();
    const { call, calls } = makeCall((m, p) => {
      if (p.startsWith("/api/platform/organizations/slug-check")) return { available: !p.includes("sandbox"), message: p.includes("sandbox") ? "\"sandbox\" is already used by another organisation." : null, suggestion: "sandbox-2" };
      if (p === "/api/platform/organizations/defaults-preview") return { timezone: "Africa/Nairobi", defaultCurrency: "KES", catalogues: { leadSources: ["Website", "Referral"], leadStatuses: [], pipelineStages: [], customerLifecycleStates: [], lostReasons: [], services: [] }, note: "The first Management user is invited by email." };
      if (m === "POST" && p === "/api/platform/organizations") return { organizationId: "onew", slug: "kilimani", name: "Kilimani Property Group", status: "ACTIVE" };
      return undefined;
    });
    renderConsole(<ProvisionWizard />, call);
    await screen.findByLabelText("Organisation name");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("alert").textContent).toBe("Give the organisation a name.");
    await user.type(screen.getByLabelText("Organisation name"), "Sandbox");
    expect(await screen.findByText("Taken. Try another.")).toBeTruthy();
    await user.clear(screen.getByLabelText("Organisation name"));
    await user.type(screen.getByLabelText("Organisation name"), "Kilimani Property Group");
    expect(screen.getByText("Available")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByLabelText("First admin’s name");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("alert").textContent).toBe("Enter the first admin’s name.");
    await user.type(screen.getByLabelText("First admin’s name"), "Boss Person");
    await user.type(screen.getByLabelText(/First admin’s email/), "boss@kilimani.co.ke");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Referral")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Create organisation" }));
    expect(await screen.findByRole("heading", { name: "Kilimani Property Group is ready" })).toBeTruthy();
    const post = calls.find(([m, p]) => m === "POST" && p === "/api/platform/organizations")!;
    expect(post[2]).toEqual({ name: "Kilimani Property Group", slug: "kilimani-property-group", ownerName: "Boss Person", ownerEmail: "boss@kilimani.co.ke" });
    await user.click(screen.getByRole("button", { name: "Open organisation" }));
    expect(push).toHaveBeenCalledWith("/platform/organisations/onew");
  });

  it("shows why the API refused", async () => {
    const user = userEvent.setup();
    const { call } = makeCall((m, p) => {
      if (p.startsWith("/api/platform/organizations/slug-check")) return { available: true, message: null, suggestion: null };
      return m === "POST" && p === "/api/platform/organizations" ? new ApiError(422, { message: "A valid email is required." }) : undefined;
    });
    renderConsole(<ProvisionWizard />, call);
    await user.type(await screen.findByLabelText("Organisation name"), "Acme Ltd");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.type(await screen.findByLabelText("First admin’s name"), "Ann");
    await user.type(screen.getByLabelText(/First admin’s email/), "a@b.co");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(screen.getByRole("button", { name: "Create organisation" }));
    await waitFor(() => expect(screen.getAllByRole("alert").some((a) => a.textContent === "A valid email is required.")).toBe(true));
  });
});

const detail = (status: string) => ({
  ...fixtures.orgs[1]!, status, timezone: "Africa/Nairobi", defaultCurrency: "KES", owner: { name: "Dev Management", email: "management@figbloom.co.ke", invitePending: false },
  lifecycle: [], dataRequests: [], recentAudit: [],
});

describe("Organisation detail and the suspend dialog (PL4, PL5)", () => {
  it("reads one organisation, and the suspend button stays disabled until a reason and the exact name are given", async () => {
    const user = userEvent.setup();
    const { call, calls } = makeCall((m, p) => (m === "GET" && p === "/api/platform/organizations/o2" ? detail("ACTIVE") : undefined));
    renderConsole(<OrgDetail id="o2" />, call);
    expect(await screen.findByText("Numbers only. No names, values or business data.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Actions/ }));
    await user.click(screen.getByRole("menuitem", { name: "Suspend" }));
    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Suspend organisation" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.type(within(dialog).getByLabelText(/Reason/), "Abuse report");
    await user.type(within(dialog).getByLabelText(/to confirm/), "Figbloom Sandbox");
    expect(confirm.disabled).toBe(false);
    await user.click(confirm);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls.find(([m, p]) => m === "POST" && p === "/api/platform/organizations/o2/status")![2]).toEqual({ action: "suspend", reason: "Abuse report" });
  });

  it("asks Verify it’s you when the API wants a fresh check, then repeats the change", async () => {
    const user = userEvent.setup();
    let posts = 0;
    const { call, calls } = makeCall((m, p) => {
      if (m === "GET" && p === "/api/platform/organizations/o2") return detail("ACTIVE");
      if (p === "/api/platform/organizations/o2/status") return ++posts === 1 ? new ApiError(403, { message: "Verify it’s you: enter a code first." }) : {};
      if (p === "/api/platform/security/verify") return { verifiedAt: "x", validForMinutes: 15 };
      return undefined;
    });
    renderConsole(<OrgDetail id="o2" />, call);
    await user.click(await screen.findByRole("button", { name: /Actions/ }));
    await user.click(screen.getByRole("menuitem", { name: "Suspend" }));
    await user.type(screen.getByLabelText(/Reason/), "Abuse report");
    await user.type(screen.getByLabelText(/to confirm/), "Figbloom Sandbox");
    await user.click(screen.getByRole("button", { name: "Suspend organisation" }));
    expect(await screen.findByRole("dialog", { name: "Verify it’s you" })).toBeTruthy();
    await user.type(screen.getByLabelText("Authenticator code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify" }));
    await waitFor(() => expect(posts).toBe(2));
    expect(calls.some(([, p]) => p === "/api/platform/security/verify")).toBe(true);
  });

  it("disables offboarding twice and closes the dialog with Escape", async () => {
    const user = userEvent.setup();
    const { call } = makeCall((m, p) => (m === "GET" && p === "/api/platform/organizations/o3" ? { ...detail("OFFBOARDING"), id: "o3", name: "Pilot Westlands Clinics" } : undefined));
    renderConsole(<OrgDetail id="o3" />, call);
    await user.click(await screen.findByRole("button", { name: /Actions/ }));
    expect(screen.getByRole("menuitem", { name: /Start offboarding/ }).getAttribute("aria-disabled")).toBe("true");
    await user.click(screen.getByRole("menuitem", { name: "Reactivate" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the not-found page for an unknown organisation", async () => {
    const { call } = makeCall((m, p) => (p.startsWith("/api/platform/organizations/zz") ? new ApiError(404, { message: "nope" }) : undefined));
    renderConsole(<OrgDetail id="zz" />, call);
    expect(await screen.findByText("Page not found")).toBeTruthy();
  });
});

describe("Data requests: the approval rule (PL6)", () => {
  it("reads the requests, and a deletion shows who approved and what is still needed", async () => {
    const user = userEvent.setup();
    const { call, calls } = makeCall();
    renderConsole(<DataRequests />, call);
    expect(await screen.findByText(/Waiting for 1 more, from a different admin/)).toBeTruthy();
    expect((screen.getByLabelText(/Delete organisation data/) as HTMLInputElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "Approve as second admin" }));
    await waitFor(() => expect(calls.find(([m, p]) => m === "POST" && p === "/api/platform/data-requests/dr1/decision")?.[2]).toEqual({ decision: "APPROVE" }));
  });

  it("does not offer approval to an admin who already approved, and rejection needs a reason", async () => {
    const user = userEvent.setup();
    const { call, calls } = makeCall((m, p) => {
      if (p === "/api/platform/me") return { ...fixtures.me, id: "pg" };
      return undefined;
    });
    renderConsole(<DataRequests />, call);
    expect(await screen.findByText(/You already approved this/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Approve as second admin" })).toBeNull();
    await user.click(screen.getAllByRole("button", { name: /Data export/ })[0]!);
    await user.click(screen.getByRole("button", { name: "Reject" }));
    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Reject request" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.type(within(dialog).getByLabelText(/Reason/), "Not from the owner");
    await user.click(confirm);
    await waitFor(() => expect(calls.find(([, p]) => p === "/api/platform/data-requests/dr2/decision")?.[2]).toEqual({ decision: "REJECT", comment: "Not from the owner" }));
  });

  it("says when nothing was requested", async () => {
    const { call } = makeCall((m, p) => (p.startsWith("/api/platform/data-requests") ? { items: [], page: 1, pageSize: 100, total: 0, pageCount: 1 } : undefined));
    renderConsole(<DataRequests />, call);
    expect(await screen.findByText(/Nothing waiting/)).toBeTruthy();
  });
});

describe("System health (PL9)", () => {
  it("shows what the checks found and the open incidents, and resolves one", async () => {
    const user = userEvent.setup();
    const { call, calls } = makeCall();
    renderConsole(<SystemHealth />, call);
    expect(await screen.findByText("No email provider is configured.")).toBeTruthy();
    expect(screen.getByText("Mail provider slow")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(calls.some(([m, p]) => m === "POST" && p === "/api/platform/health/incidents/in1/resolve")).toBe(true));
  });
});

describe("Platform admins and security (PL10, PL11, PL14)", () => {
  it("lists the roster from the API and invites an admin by email", async () => {
    const user = userEvent.setup();
    const { call, calls } = makeCall();
    renderConsole(<PlatformAdmins />, call);
    expect(await screen.findByText("Given")).toBeTruthy();
    expect(screen.getByText("new@platform.test")).toBeTruthy();
    await user.type(screen.getByLabelText("New admin’s email"), "sam.new@platform.test");
    await user.click(screen.getByRole("button", { name: "Invite admin" }));
    await waitFor(() => expect(calls.find(([m, p]) => m === "POST" && p === "/api/platform/admins")?.[2]).toEqual({ email: "sam.new@platform.test", name: "Sam New" }));
  });

  it("removes an admin through the API, and blocks removing the second-last one", async () => {
    const user = userEvent.setup();
    const { call, calls } = makeCall();
    renderConsole(<PlatformAdmins />, call);
    await screen.findByText("Given");
    const removes = () => screen.getAllByRole("button", { name: "Remove" });
    await user.click(removes()[2]!);
    await waitFor(() => expect(calls.some(([m, p]) => m === "DELETE" && p === "/api/platform/admins/pm")).toBe(true));
  });

  it("blocks the removal when only two active admins remain", async () => {
    const user = userEvent.setup();
    const two = { ...fixtures.admins, items: fixtures.admins.items.slice(0, 2), activeCount: 2 };
    const { call, calls } = makeCall((m, p) => (m === "GET" && p === "/api/platform/admins" ? two : undefined));
    renderConsole(<PlatformAdmins />, call);
    expect(await screen.findByText(/Only two active admins left/)).toBeTruthy();
    await user.click(screen.getAllByRole("button", { name: "Remove" })[1]!);
    expect(screen.getByText("Blocked: at least two platform admins are required.")).toBeTruthy();
    expect(calls.some(([m]) => m === "DELETE")).toBe(false);
  });

  it("refuses a wrong code in the verification dialog, five times, then shows the lock", async () => {
    const user = userEvent.setup();
    const { call } = makeCall((m, p) => {
      if (m === "DELETE" && p === "/api/platform/admins/pm") return new ApiError(403, { message: "Verify it’s you: enter a code first." });
      if (p === "/api/platform/security/verify") return new ApiError(401, { message: "That code didn’t work." });
      return undefined;
    });
    renderConsole(<PlatformAdmins />, call);
    await screen.findByText("Given");
    await user.click(screen.getAllByRole("button", { name: "Remove" })[2]!);
    await screen.findByRole("dialog", { name: "Verify it’s you" });
    for (let i = 0; i < 5; i++) {
      await user.clear(screen.getByLabelText("Authenticator code"));
      await user.type(screen.getByLabelText("Authenticator code"), "123456");
      await user.click(screen.getByRole("button", { name: "Verify" }));
      if (i === 0) expect((await screen.findByRole("alert")).textContent).toBe("That code didn’t work. 4 attempts left.");
      if (i < 4) await screen.findByLabelText("Authenticator code");
    }
    await waitFor(() => expect(screen.getByRole("dialog").textContent).toMatch(/locked for 30 minutes/));
  });

  it("security: verification is locked on, and the real settings are read and saved", async () => {
    const user = userEvent.setup();
    const { call, calls } = makeCall();
    renderConsole(<PlatformSecurity />, call);
    const box = (await screen.findByLabelText("Verification required at every sign-in")) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(true);
    const idle = screen.getByLabelText("Idle sign-out (hours)") as HTMLInputElement;
    expect(idle.value).toBe("4");
    await user.clear(idle);
    await user.type(idle, "6");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(calls.find(([m, p]) => m === "PATCH" && p === "/api/platform/security/settings")?.[2]).toEqual({ idleHours: 6 }));
  });
});

describe("Verify it’s you page (PL14)", () => {
  it("takes a backup code instead, and shows the lock after too many wrong codes", async () => {
    const user = userEvent.setup();
    render(<VerifyPage next="/login" />);
    await user.click(screen.getByRole("button", { name: "Use a backup code" }));
    expect(screen.getByLabelText("Backup code")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Use my authenticator code" }));
    for (let i = 0; i < 5; i++) {
      await user.type(screen.getByLabelText("Authenticator code"), "000000");
      await user.click(screen.getByRole("button", { name: "Verify" }));
      if (i < 4) await user.clear(screen.getByLabelText("Authenticator code"));
    }
    expect(await screen.findByText(/Platform sign-in is locked for 30 minutes/)).toBeTruthy();
  });
});

describe("Platform mobile (PLM)", () => {
  it("shows the approvals from the API and approves one", async () => {
    const user = userEvent.setup();
    const { call, calls } = makeCall();
    renderConsole(<PlatformMobile tab="approvals" />, call);
    await user.click(await screen.findByRole("button", { name: "Approve export" }));
    await waitFor(() => expect(calls.some(([m, p]) => m === "POST" && p === "/api/platform/data-requests/dr2/decision")).toBe(true));
  });

  it("shows health from the API", async () => {
    renderConsole(<PlatformMobile tab="health" />, makeCall().call);
    expect(await screen.findByText("No email provider is configured.")).toBeTruthy();
  });

  it("has the three tabs and no tenant links", async () => {
    renderConsole(<PlatformMobile tab="home" />, makeCall().call);
    await screen.findByText("4 things need attention");
    const nav = screen.getByRole("navigation", { name: "Platform mobile" });
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["Home", "Health", "Approvals"]);
    expect(document.body.innerHTML).not.toMatch(/\/o\//);
  });
});
