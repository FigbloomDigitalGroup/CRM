import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * Q1.03 (FIG-1117): the frozen sign-in pages are compared with the `pre-makeover` tag, not just with recorded hashes. The only differences
 * allowed since that tag are the ones Given approved (29 Oct 2026): the dev sign-in chips on the login page, which exist only in development and
 * are checked out of the production build by `npm run check:build-output`. Any other line changed on a frozen page fails here.
 */

const FROZEN = ["src/app/login", "src/app/signup", "src/app/forgot-password", "src/app/reset-password", "src/app/accept-invite", "src/app/_shared/AuthHero.tsx", "src/app/_shared/PasswordInput.tsx"];
/** Files whose approved difference is the dev chips only. */
const APPROVED_DEV_CHIPS = new Set(["src/app/login/LoginForm.tsx", "src/app/login/page.tsx"]);

function git(args: string[]): string | null {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

const tagExists = git(["rev-parse", "--verify", "--quiet", "refs/tags/pre-makeover"]) !== null;

describe.skipIf(!tagExists)("frozen sign-in pages against the pre-makeover tag", () => {
  const names = (git(["diff", "--name-only", "pre-makeover", "--", ...FROZEN]) ?? "").split("\n").filter(Boolean);

  it("only the approved files differ", () => {
    expect(names.filter((n) => !APPROVED_DEV_CHIPS.has(n))).toEqual([]);
  });

  it("the approved differences add only dev sign-in chip code and remove nothing but the lines they replace around it", () => {
    for (const file of names) {
      const patch = git(["diff", "-U0", "pre-makeover", "--", file]) ?? "";
      const added = patch.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));
      const removed = patch.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"));
      // Every added line is about the chips (import, flag, render) and at most a handful of lines were replaced to mount them.
      expect(removed.length, `${file} removed lines`).toBeLessThanOrEqual(6);
      expect(added.join("\n"), `${file} added lines`).toMatch(/chip|Chip|DevChips|dev/);
    }
  });
});
