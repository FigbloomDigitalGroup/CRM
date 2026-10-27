import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../../src/api-client";
import { ApiProvider, SESSION_ENDING_EVENT, ToastProvider, useDraft, loadDraft, saveDraft, clearDraft } from "../../../src/ui";
import { connectivity } from "../../../src/ui/data/connectivity";
import { ConnectionBanners } from "../../../src/ui/shell/AppShell";
import { SessionGuard, formatCountdown } from "../../../src/ui/shell/SessionGuard";
import { Sidebar, SIDEBAR_DEVICE_KEY } from "../../../src/ui/shell/Sidebar";
import { IdentityBlock, QuickCreate, ThemeSwitch } from "../../../src/ui/shell/TopBar";
import { ThemeProvider, useAppearance } from "../../../src/ui/theme/ThemeProvider";
import { defaultLook, DEVICE_STORAGE_KEY, type LookInput } from "../../../src/ui/theme/resolve";
import type { NavSection } from "../../../src/ui/shell/navModel";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/o/figbloom/leads/abc",
  useRouter: () => ({ push, refresh }),
}));

function client(call: (...args: unknown[]) => unknown): ApiClient {
  return { call, operations: {} } as unknown as ApiClient;
}
function providers(call: (...args: unknown[]) => unknown, children: React.ReactNode) {
  return (
    <ApiProvider client={client(call)}>
      <ToastProvider>{children}</ToastProvider>
    </ApiProvider>
  );
}

const SECTIONS: NavSection[] = [
  { key: "overview", label: "Overview", items: [{ key: "dashboard", label: "Dashboard", path: "", icon: "dashboard", tint: "w", exact: true }] },
  { key: "workspace", label: "Sales workspace", items: [{ key: "leads", label: "Leads", path: "/leads", icon: "leads", tint: "g" }, { key: "tasks", label: "Tasks", path: "/tasks", icon: "tasks", tint: "g", badge: 4 }] },
  { key: "insights", label: "Insights and settings", bottom: true, items: [{ key: "settings", label: "Settings", path: "/settings", icon: "settings", tint: "o" }] },
];

beforeEach(() => {
  localStorage.clear();
  push.mockClear();
  refresh.mockClear();
});

describe("Sidebar", () => {
  it("draws the sections it is given, marks the current page and shows badges", () => {
    render(<Sidebar orgSlug="figbloom" sections={SECTIONS} initialCollapsed={false} />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Leads" })).toHaveAttribute("href", "/o/figbloom/leads");
    expect(within(nav).getByRole("link", { name: "Leads" })).toHaveAttribute("aria-current", "page"); // /leads/abc
    expect(within(nav).getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
    expect(within(nav).getByRole("link", { name: /Tasks/ })).toHaveTextContent("4");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/o/figbloom/settings"); // the bottom group
  });

  it("filters by the box and says when nothing matches", async () => {
    const user = userEvent.setup();
    render(<Sidebar orgSlug="figbloom" sections={SECTIONS} initialCollapsed={false} />);
    await user.type(screen.getByRole("searchbox", { name: "Filter navigation" }), "task");
    expect(screen.queryByRole("link", { name: "Leads" })).toBeNull();
    expect(screen.getByRole("link", { name: /Tasks/ })).toBeInTheDocument();
    await user.clear(screen.getByRole("searchbox", { name: "Filter navigation" }));
    await user.type(screen.getByRole("searchbox", { name: "Filter navigation" }), "zzz");
    expect(screen.getByText("No matching pages.")).toBeInTheDocument();
  });

  it("collapse starts from the account value, is mirrored on this device and saved to the account", async () => {
    const user = userEvent.setup();
    const saved = vi.fn();
    render(<Sidebar orgSlug="figbloom" sections={SECTIONS} initialCollapsed onCollapsedChange={saved} />);
    const aside = screen.getByRole("complementary", { name: "Sidebar" });
    expect(aside).toHaveAttribute("data-collapsed", "true");
    await user.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(aside).toHaveAttribute("data-collapsed", "false");
    expect(saved).toHaveBeenCalledWith(false);
    expect(localStorage.getItem(SIDEBAR_DEVICE_KEY)).toBe("0");
  });

  it("this device's own choice wins on this device", () => {
    localStorage.setItem(SIDEBAR_DEVICE_KEY, "1");
    render(<Sidebar orgSlug="figbloom" sections={SECTIONS} initialCollapsed={false} />);
    expect(screen.getByRole("complementary", { name: "Sidebar" })).toHaveAttribute("data-collapsed", "true");
  });
});

describe("QuickCreate", () => {
  const items = [{ key: "lead" as const, label: "New lead", path: "/leads" }, { key: "task" as const, label: "New task", path: "/tasks" }];

  it("offers only what it is given, and nothing at all when the role may create nothing", async () => {
    const user = userEvent.setup();
    const { container, rerender } = render(<QuickCreate orgSlug="figbloom" items={items} />);
    await user.click(screen.getByRole("button", { name: "New" }));
    expect(screen.getByRole("menuitem", { name: "New lead" })).toHaveAttribute("href", "/o/figbloom/leads");
    expect(screen.getByRole("menuitem", { name: "New task" })).toBeInTheDocument();
    rerender(<QuickCreate orgSlug="figbloom" items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("inside an archived or read-only record it is disabled with the reason, not hidden", () => {
    render(<QuickCreate orgSlug="figbloom" items={items} disabledReason="This lead is archived. Restore it to add to it." />);
    const button = screen.getByRole("button", { name: /New/ });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("title", "This lead is archived. Restore it to add to it.");
  });
});

describe("ThemeProvider and the light/dark switch", () => {
  function Probe() {
    const a = useAppearance();
    return (
      <div>
        <span data-testid="scheme">{a.scheme}</span>
        <button onClick={() => a.setLook({ ...a.look, colours: { ...a.look.colours, accent: "#8A5A1F" } })}>retheme</button>
        <button onClick={() => a.setDevice({ textSize: "EXTRA_LARGE", bold: true })}>big</button>
        <button onClick={() => a.setDensity("COMPACT")}>compact</button>
        <ThemeSwitch />
      </div>
    );
  }
  const app = () => document.querySelector(".fb-app") as HTMLElement;

  it("renders both schemes' tokens, applies the device's switch live and remembers it on this device", async () => {
    const user = userEvent.setup();
    render(<ThemeProvider initialLook={defaultLook()} initialDensity="COMFORTABLE"><Probe /></ThemeProvider>);
    expect(document.getElementById("fb-look")!.textContent).toContain('.fb-app[data-fb-scheme="dark"]');
    expect(app()).toHaveAttribute("data-fb-scheme", "light");
    await user.click(screen.getByRole("button", { name: "Switch to dark" }));
    expect(screen.getByTestId("scheme")).toHaveTextContent("dark");
    expect(app()).toHaveAttribute("data-fb-scheme", "dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark"); // the older stylesheet's dark rules key on this
    expect(JSON.parse(localStorage.getItem(DEVICE_STORAGE_KEY)!)).toMatchObject({ scheme: "dark" });
  });

  it("changing the look, density or device modes updates the whole app without a reload", async () => {
    const user = userEvent.setup();
    render(<ThemeProvider initialLook={defaultLook()} initialDensity="COMFORTABLE"><Probe /></ThemeProvider>);
    await user.click(screen.getByRole("button", { name: "retheme" }));
    expect(document.getElementById("fb-look")!.textContent).toContain("--primary-btn:#8A5A1F");
    await user.click(screen.getByRole("button", { name: "big" }));
    expect(app()).toHaveAttribute("data-fb-text", "EXTRA_LARGE");
    expect(app()).toHaveAttribute("data-fb-bold", "1");
    await user.click(screen.getByRole("button", { name: "compact" }));
    expect(app()).toHaveAttribute("data-fb-density", "compact");
  });

  it("while the organisation locks the look the switch is disabled with the reason, and does nothing", async () => {
    const user = userEvent.setup();
    const locked: LookInput = { ...defaultLook(), locked: true };
    render(<ThemeProvider initialLook={locked} initialDensity="COMFORTABLE"><Probe /></ThemeProvider>);
    const sw = screen.getByRole("button", { name: /Your organisation has set the colours/ });
    expect(sw).toHaveAttribute("aria-disabled", "true");
    await user.click(sw);
    expect(app()).toHaveAttribute("data-fb-scheme", "light");
  });

  it("restores a device's saved settings after load and leaves the document clean when it goes", () => {
    localStorage.setItem(DEVICE_STORAGE_KEY, JSON.stringify({ scheme: "dark", textSize: "LARGE", reduceMotion: true }));
    const { unmount } = render(<ThemeProvider initialLook={defaultLook()} initialDensity={null}><Probe /></ThemeProvider>);
    expect(app()).toHaveAttribute("data-fb-scheme", "dark");
    expect(app()).toHaveAttribute("data-fb-text", "LARGE");
    expect(app()).toHaveAttribute("data-fb-motion", "1");
    unmount();
    expect(document.documentElement).not.toHaveAttribute("data-theme");
  });
});

describe("IdentityBlock", () => {
  const identity = {
    name: "Dev Sales",
    roleName: "Sales",
    organisation: "Figbloom",
    avatarUrl: null,
    signedInLocal: "Tuesday, 27 October, 10:04",
    device: "Chrome on Windows",
    place: "Nairobi",
    timeZone: "Africa/Nairobi",
    organisationTimeZone: "Europe/London",
    supportNotice: "Figbloom Support is viewing this organisation (read-only) until 11:30.",
    preferencesHref: "/o/figbloom/settings",
  };

  it("shows who you are, where, since when and the time zone, and the support notice when there is one", async () => {
    const user = userEvent.setup();
    render(providers(vi.fn(), <IdentityBlock identity={identity} />));
    const trigger = screen.getByRole("button", { name: "Account: Dev Sales" });
    expect(trigger).toHaveTextContent("Dev Sales");
    expect(trigger).toHaveTextContent("Sales · Figbloom");
    await user.click(trigger);
    const pop = screen.getByRole("dialog", { name: "Account: Dev Sales" });
    expect(pop).toHaveTextContent("Tuesday, 27 October, 10:04");
    expect(pop).toHaveTextContent("Africa/Nairobi (organisation: Europe/London)");
    expect(pop).toHaveTextContent("Chrome on Windows · Nairobi");
    expect(pop).toHaveTextContent("Figbloom Support is viewing this organisation");
    expect(within(pop).getByRole("link", { name: "Profile and preferences" })).toHaveAttribute("href", "/o/figbloom/settings");
  });

  it("signs out through the typed client and returns to the sign-in page", async () => {
    const user = userEvent.setup();
    const call = vi.fn().mockResolvedValue({});
    render(providers(call, <IdentityBlock identity={identity} />));
    await user.click(screen.getByRole("button", { name: "Account: Dev Sales" }));
    await user.click(screen.getByRole("button", { name: /Sign out$/ }));
    expect(call).toHaveBeenCalledWith("logout", { params: {} });
    expect(push).toHaveBeenCalledWith("/login");
  });

  it("signs out the other devices and says so", async () => {
    const user = userEvent.setup();
    const call = vi.fn().mockResolvedValue({});
    render(providers(call, <IdentityBlock identity={{ ...identity, supportNotice: null }} />));
    await user.click(screen.getByRole("button", { name: "Account: Dev Sales" }));
    await user.click(screen.getByRole("button", { name: "Sign out other devices" }));
    expect(call).toHaveBeenCalledWith("signOutOtherSessions", { params: {} });
    expect(await screen.findByText("Signed out of your other devices.")).toBeInTheDocument();
  });
});

describe("SessionGuard", () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date("2026-10-27T10:00:00Z") }));
  afterEach(() => vi.useRealTimers());

  const at = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();

  it("formats the countdown", () => {
    expect(formatCountdown(300)).toBe("5:00");
    expect(formatCountdown(61)).toBe("1:01");
    expect(formatCountdown(-4)).toBe("0:00");
  });

  it("stays quiet until the warning time, then counts down; Stay signed in extends the session", async () => {
    const call = vi.fn().mockResolvedValue({ session: { expiresAt: at(8 * 3600), warnAt: at(8 * 3600 - 300), canExtend: true } });
    const navigate = vi.fn();
    render(providers(call, <SessionGuard initial={{ expiresAt: at(600), warnAt: at(300), canExtend: true }} navigate={navigate} />));
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => void vi.advanceTimersByTime(299_000));
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => void vi.advanceTimersByTime(2_000));
    const dialog = screen.getByRole("dialog", { name: "Still there?" });
    expect(dialog.textContent).toMatch(/ends in\s*4:5\d/);
    await act(async () => void fireEvent.click(within(dialog).getByRole("button", { name: "Stay signed in" })));
    expect(call).toHaveBeenCalledWith("extendSession", { params: {} });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("when nobody answers the session ends: drafts are told to save, then the person is sent to sign in", () => {
    const navigate = vi.fn();
    const ending = vi.fn();
    window.addEventListener(SESSION_ENDING_EVENT, ending);
    render(providers(vi.fn(), <SessionGuard initial={{ expiresAt: at(310), warnAt: at(10), canExtend: true }} navigate={navigate} />));
    act(() => void vi.advanceTimersByTime(311_000));
    expect(ending).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/login?reason=expired");
    act(() => void vi.advanceTimersByTime(30_000));
    expect(navigate).toHaveBeenCalledTimes(1); // once
    window.removeEventListener(SESSION_ENDING_EVENT, ending);
  });

  it("at the absolute limit there is no Stay button and it says so", () => {
    render(providers(vi.fn(), <SessionGuard initial={{ expiresAt: at(200), warnAt: at(-100), canExtend: false }} navigate={vi.fn()} />));
    act(() => void vi.advanceTimersByTime(1100));
    expect(screen.queryByRole("button", { name: "Stay signed in" })).toBeNull();
    expect(screen.getByRole("dialog")).toHaveTextContent("longest a session can last");
  });

  it("a 401 from any request ends it at once", () => {
    const navigate = vi.fn();
    render(providers(vi.fn(), <SessionGuard initial={{ expiresAt: at(3600), warnAt: at(3300), canExtend: true }} navigate={navigate} />));
    act(() => void window.dispatchEvent(new CustomEvent("figbloom:signed-out")));
    expect(navigate).toHaveBeenCalledWith("/login?reason=expired");
  });
});

describe("drafts", () => {
  it("a dirty form writes its draft when the session is ending, and gets it back next time", () => {
    function Form({ text, dirty }: { text: string; dirty: boolean }) {
      useDraft("lead-new:u1", { text }, dirty);
      return null;
    }
    const { rerender } = render(<Form text="half-typed note" dirty />);
    expect(loadDraft("lead-new:u1")).toBeNull();
    window.dispatchEvent(new CustomEvent(SESSION_ENDING_EVENT));
    expect(loadDraft("lead-new:u1")).toEqual({ text: "half-typed note" });

    clearDraft("lead-new:u1");
    rerender(<Form text="saved" dirty={false} />);
    window.dispatchEvent(new CustomEvent(SESSION_ENDING_EVENT));
    expect(loadDraft("lead-new:u1")).toBeNull(); // a clean form leaves nothing behind
  });

  it("restore returns what was kept, discard removes it, and a stale draft is dropped", () => {
    let api!: ReturnType<typeof useDraft<{ a: number }>>;
    function Form() {
      api = useDraft("k:u1", { a: 1 }, false);
      useEffect(() => undefined, []);
      return null;
    }
    render(<Form />);
    saveDraft("k:u1", { a: 7 });
    expect(api.restore()).toEqual({ a: 7 });
    api.discard();
    expect(api.restore()).toBeNull();
    localStorage.setItem("figbloom-draft:old", JSON.stringify({ at: Date.now() - 8 * 24 * 3600 * 1000, value: { a: 1 } }));
    expect(loadDraft("old")).toBeNull();
  });
});

describe("connection banners", () => {
  afterEach(() => {
    act(() => {
      connectivity.setOnline(true);
      connectivity.setQueued(0);
      connectivity.setLinkSlow(false);
    });
  });

  it("show the offline banner with the queue, and the slow bar when requests are slow", () => {
    render(<ConnectionBanners />);
    expect(screen.queryByRole("status")).toBeNull();
    act(() => connectivity.setLinkSlow(true));
    expect(screen.getByRole("status", { name: "Slow connection" })).toBeInTheDocument();
    act(() => {
      connectivity.setOnline(false);
      connectivity.setQueued(2);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Offline. Saves are queued.");
    expect(screen.getByRole("status")).toHaveTextContent("2 changes waiting to be sent.");
  });
});
