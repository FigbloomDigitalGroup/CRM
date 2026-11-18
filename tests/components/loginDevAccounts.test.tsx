import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The frozen sign-in page lists the dev accounts for local use. The dev Super Admin is a platform identity with no password sign-in, so its chip goes
 * through the dev route and lands on the platform page; every other chip still goes through the real password check.
 */

const findMany = vi.fn();
const findPlatform = vi.fn();
vi.mock("@/db/adminClient", () => ({ adminDb: { user: { findMany: (...a: unknown[]) => findMany(...a) }, platformIdentity: { findMany: (...a: unknown[]) => findPlatform(...a) } } }));
const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const TENANT = [{ email: "dev.sales@figbloom.local", name: "Dev Sales", memberships: [{ role: { name: "Sales" } }] }];
const PLATFORM = [{ email: "dev.superadmin@platform.figbloom.local", name: "Dev Super Admin" }];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
  findMany.mockReset();
  findPlatform.mockReset();
  push.mockReset();
  refresh.mockReset();
});

async function renderLogin() {
  const { default: LoginPage } = await import("../../src/app/login/page");
  render(await LoginPage());
}

describe("the dev accounts on the sign-in page", () => {
  it("lists the Super Admin beside the tenant accounts in development with dev accounts allowed", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_DEV_ACCOUNTS", "true");
    findMany.mockResolvedValue(TENANT);
    findPlatform.mockResolvedValue(PLATFORM);
    await renderLogin();
    expect(screen.getByRole("button", { name: "Dev Sales" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dev Super Admin" })).toBeInTheDocument();
    expect(findPlatform).toHaveBeenCalledWith(expect.objectContaining({ where: { isDev: true } }));
  });

  it("keeps the dev route out of the sign-in form's own code: the server names it, and only for the Super Admin", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/app/login/LoginForm.tsx", "utf8")).not.toContain("dev-session");
  });

  it("does not list the Super Admin, or even ask for it, unless dev accounts are explicitly allowed", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_DEV_ACCOUNTS", "false");
    findMany.mockResolvedValue(TENANT);
    await renderLogin();
    expect(screen.getByRole("button", { name: "Dev Sales" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dev Super Admin" })).toBeNull();
    expect(findPlatform).not.toHaveBeenCalled();
  });

  it("lists no dev accounts at all in production, without asking the database", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await renderLogin();
    expect(screen.queryByText(/Dev accounts/)).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
    expect(findPlatform).not.toHaveBeenCalled();
  });

  it("signs the Super Admin in through the dev route and lands on the platform page; a tenant chip still uses the password check", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_DEV_ACCOUNTS", "true");
    findMany.mockResolvedValue(TENANT);
    findPlatform.mockResolvedValue(PLATFORM);
    const fetchMock = vi.fn(async (url: string) =>
      new Response(JSON.stringify(url === "/api/dev-session" ? { landing: "/platform" } : { organizationSlug: "figbloom" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await renderLogin();

    await userEvent.click(screen.getByRole("button", { name: "Dev Super Admin" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/dev-session", expect.objectContaining({ method: "POST", body: JSON.stringify({ email: "dev.superadmin@platform.figbloom.local" }) }));
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/platform"));

    await userEvent.click(screen.getByRole("button", { name: "Dev Sales" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/login", expect.objectContaining({ method: "POST" }));
    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/o/figbloom"));
  });
});
