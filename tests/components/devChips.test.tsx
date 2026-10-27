import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * F1.07: the dev sign-in chips exist only in development, with dev accounts allowed and the seeded organisation present, and one tap signs in.
 * (That nothing of them is in a production build's output is checked by `npm run check:build-output`, which CI runs after the build.)
 */

const findMany = vi.fn();
const findPlatform = vi.fn();
vi.mock("@/db/adminClient", () => ({ adminDb: { user: { findMany: (...a: unknown[]) => findMany(...a) }, platformIdentity: { findMany: (...a: unknown[]) => findPlatform(...a) } } }));
const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const SEEDED = [
  { email: "dev.sales@figbloom.local", name: "Dev Sales", memberships: [{ role: { key: "SALES", name: "Sales", requiredFeature: null } }] },
  { email: "dev.management@figbloom.local", name: "Dev Management", memberships: [{ role: { key: "MANAGEMENT", name: "Management", requiredFeature: null } }] },
  { email: "dev.support@figbloom.local", name: "Dev Support", memberships: [{ role: { key: "CUSTOMER_SUPPORT", name: "Customer Support", requiredFeature: "customer_support.role" } }] },
  { email: "someone@real-company.com", name: "A real person", memberships: [] },
];
const PLATFORM = [{ email: "dev.superadmin@platform.figbloom.local", name: "Dev Super Admin" }];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  findMany.mockReset();
  findPlatform.mockReset();
  push.mockReset();
});

async function loadDevChips() {
  const { DevChips } = await import("../../src/app/_dev/DevChips");
  return DevChips();
}

describe("dev sign-in chips", () => {
  it("render nothing in production, without even asking the database", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_DEV_ACCOUNTS", "true");
    expect(await loadDevChips()).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });

  it("render nothing unless dev accounts are explicitly allowed, even in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_DEV_ACCOUNTS", "");
    expect(await loadDevChips()).toBeNull();
    vi.stubEnv("ALLOW_DEV_ACCOUNTS", "yes");
    expect(await loadDevChips()).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });

  it("render nothing when the seeded organisation is not there", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_DEV_ACCOUNTS", "true");
    findMany.mockResolvedValue([]);
    findPlatform.mockResolvedValue([]);
    expect(await loadDevChips()).toBeNull();
  });

  it("offer every seeded account in the design's order, never a real address, with flags and the Super Admin named", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_DEV_ACCOUNTS", "true");
    findMany.mockResolvedValue(SEEDED);
    findPlatform.mockResolvedValue(PLATFORM);
    const element = await loadDevChips();
    expect(element).not.toBeNull();
    const { container } = render(element as React.ReactElement);
    await userEvent.setup().click(screen.getByRole("button", { name: "Dev sign-in" }));
    const chips = screen.getAllByRole("button").filter((b) => b.title.includes("@"));
    expect(chips.map((c) => c.title)).toEqual([
      "dev.management@figbloom.local",
      "dev.sales@figbloom.local",
      "dev.support@figbloom.local",
      "dev.superadmin@platform.figbloom.local",
    ]);
    expect(container).toHaveTextContent("Customer Support (behind flag customer_support.role)");
    expect(container).toHaveTextContent("Platform Super Admin (V1.1, dev only)");
    expect(container).not.toHaveTextContent("real-company");
  });

  it("sign in with one tap and go where the server says", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_DEV_ACCOUNTS", "true");
    findMany.mockResolvedValue(SEEDED);
    findPlatform.mockResolvedValue(PLATFORM);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ landing: "/platform" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render((await loadDevChips()) as React.ReactElement);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Dev sign-in" }));
    await user.click(screen.getByTitle("dev.superadmin@platform.figbloom.local"));
    expect(fetchMock).toHaveBeenCalledWith("/api/dev-session", expect.objectContaining({ method: "POST", body: JSON.stringify({ email: "dev.superadmin@platform.figbloom.local" }) }));
    expect(push).toHaveBeenCalledWith("/platform");
    expect(container).toBeTruthy();
    vi.unstubAllGlobals();
  });

  it("show the server's reason when a sign-in is refused", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_DEV_ACCOUNTS", "true");
    findMany.mockResolvedValue(SEEDED);
    findPlatform.mockResolvedValue([]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "No such user." }), { status: 404 })));
    render((await loadDevChips()) as React.ReactElement);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Dev sign-in" }));
    await user.click(screen.getByTitle("dev.sales@figbloom.local"));
    expect(await screen.findByRole("alert")).toHaveTextContent("No such user.");
    expect(push).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
