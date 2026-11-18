import { describe, expect, it, vi } from "vitest";
import { APP_ROLE_URL_MISSING_MESSAGE, assertAppDatabaseUrlConfigured, enforceAppDatabaseUrl } from "../src/db/appRoleGuard";

const STAGING = { NODE_ENV: "production", FIGBLOOM_ENVIRONMENT: "staging" };
const PROD = { NODE_ENV: "production", FIGBLOOM_ENVIRONMENT: "production" };

describe("application database role guard", () => {
  it("refuses a staging or production deployment without APP_DATABASE_URL, and treats a blank value as missing", () => {
    expect(() => assertAppDatabaseUrlConfigured(STAGING)).toThrow(/APP_DATABASE_URL is not set/);
    expect(() => assertAppDatabaseUrlConfigured(PROD)).toThrow(APP_ROLE_URL_MISSING_MESSAGE);
    expect(() => assertAppDatabaseUrlConfigured({ ...PROD, APP_DATABASE_URL: "  " })).toThrow(APP_ROLE_URL_MISSING_MESSAGE);
  });

  it("passes when the application role URL is set", () => {
    expect(() => assertAppDatabaseUrlConfigured({ ...PROD, APP_DATABASE_URL: "postgresql://figbloom_app@db/x" })).not.toThrow();
  });

  it("does nothing outside a deployment (development, test, local production-mode runs)", () => {
    expect(() => assertAppDatabaseUrlConfigured({ NODE_ENV: "production" })).not.toThrow();
    expect(() => assertAppDatabaseUrlConfigured({ NODE_ENV: "development", FIGBLOOM_ENVIRONMENT: "production" })).not.toThrow();
    expect(() => assertAppDatabaseUrlConfigured({})).not.toThrow();
  });

  it("exits the process with a non-zero code so an orchestrator sees a crash", () => {
    const exit = vi.fn();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    enforceAppDatabaseUrl({ env: PROD, exit });
    expect(exit).toHaveBeenCalledWith(1);
    expect(log.mock.calls[0]?.[0]).toMatch(/Refusing to start/);
    exit.mockClear();
    enforceAppDatabaseUrl({ env: { ...PROD, APP_DATABASE_URL: "postgresql://figbloom_app@db/x" }, exit });
    expect(exit).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
