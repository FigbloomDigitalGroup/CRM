import { describe, expect, it, vi } from "vitest";
import { ANTIVIRUS_MISSING_MESSAGE, ANTIVIRUS_OPT_OUT_WARNING, assertAntivirusConfigured, enforceAntivirusInProduction } from "../src/storage/antivirusGuard";

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

  it("lets production boot without CLAMD_HOST only with the explicit ANTIVIRUS_MODE=builtin-only opt-out, and warns loudly", () => {
    expect(() => assertAntivirusConfigured({ ...PROD, ANTIVIRUS_MODE: "builtin-only" })).not.toThrow();
    expect(() => assertAntivirusConfigured({ ...PROD, ANTIVIRUS_MODE: " Builtin-Only " })).not.toThrow();
    // Anything else keeps the default.
    expect(() => assertAntivirusConfigured({ ...PROD, ANTIVIRUS_MODE: "off" })).toThrow(ANTIVIRUS_MISSING_MESSAGE);
    expect(() => assertAntivirusConfigured({ ...PROD, ANTIVIRUS_MODE: "" })).toThrow(ANTIVIRUS_MISSING_MESSAGE);
    expect(() => assertAntivirusConfigured({ ...PROD, ANTIVIRUS_MODE: "true" })).toThrow(ANTIVIRUS_MISSING_MESSAGE);

    const exit = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    enforceAntivirusInProduction({ env: { ...PROD, ANTIVIRUS_MODE: "builtin-only" }, exit });
    expect(exit).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(ANTIVIRUS_OPT_OUT_WARNING);

    // No warning when a ClamAV host exists, or outside production.
    warn.mockClear();
    enforceAntivirusInProduction({ env: { ...PROD, CLAMD_HOST: "clamav.internal", ANTIVIRUS_MODE: "builtin-only" }, exit });
    enforceAntivirusInProduction({ env: { NODE_ENV: "development", ANTIVIRUS_MODE: "builtin-only" }, exit });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
