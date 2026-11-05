import { describe, expect, it, vi } from "vitest";
import { ANTIVIRUS_MISSING_MESSAGE, assertAntivirusConfigured, enforceAntivirusInProduction } from "../src/storage/antivirusGuard";

const PROD = { NODE_ENV: "production", FIGBLOOM_ENVIRONMENT: "production" };

describe("production antivirus guard (FIG-1257)", () => {
  it("refuses a production deployment without CLAMD_HOST, and treats a blank value as missing", () => {
    expect(() => assertAntivirusConfigured(PROD)).toThrow(/CLAMD_HOST is not set/);
    expect(() => assertAntivirusConfigured({ ...PROD, CLAMD_HOST: "   " })).toThrow(ANTIVIRUS_MISSING_MESSAGE);
  });

  it("passes when the ClamAV host is set", () => {
    expect(() => assertAntivirusConfigured({ ...PROD, CLAMD_HOST: "clamav.internal" })).not.toThrow();
  });

  it("does nothing outside a production deployment (staging, development, local production-mode runs)", () => {
    expect(() => assertAntivirusConfigured({ NODE_ENV: "production", FIGBLOOM_ENVIRONMENT: "staging" })).not.toThrow();
    expect(() => assertAntivirusConfigured({ NODE_ENV: "production" })).not.toThrow();
    expect(() => assertAntivirusConfigured({ NODE_ENV: "development", FIGBLOOM_ENVIRONMENT: "production" })).not.toThrow();
    expect(() => assertAntivirusConfigured({})).not.toThrow();
  });

  it("exits the process with a non-zero code so an orchestrator sees a crash", () => {
    const exit = vi.fn();
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    enforceAntivirusInProduction({ env: PROD, exit });
    expect(exit).toHaveBeenCalledWith(1);
    expect(log.mock.calls[0]?.[0]).toMatch(/Refusing to start in production/);

    exit.mockClear();
    enforceAntivirusInProduction({ env: { ...PROD, CLAMD_HOST: "clamav.internal" }, exit });
    expect(exit).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
