import { describe, expect, it } from "vitest";
import { devAccountsAllowed, previewChipsAllowed } from "../src/auth/devAccounts";

/** The preview build's dev chips (`npm run preview`, Given's approval 31 Oct 2026): off unless every local-only switch is set. */
describe("preview dev chips", () => {
  const all = { PREVIEW_DEV_CHIPS: "true", ALLOW_DEV_ACCOUNTS: "true", E2E_ALLOW_DEV_ACCOUNTS: "true" };

  it("are on only when all three switches are set", () => {
    expect(previewChipsAllowed(all)).toBe(true);
    for (const key of Object.keys(all)) expect(previewChipsAllowed({ ...all, [key]: undefined })).toBe(false);
    expect(previewChipsAllowed({})).toBe(false);
    expect(previewChipsAllowed({ ...all, PREVIEW_DEV_CHIPS: "1" })).toBe(false);
  });

  it("never open the no-password dev routes in a production build", () => {
    expect(devAccountsAllowed({ ...all, NODE_ENV: "production" })).toBe(false);
  });
});
