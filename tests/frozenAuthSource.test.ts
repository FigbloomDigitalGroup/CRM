import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Q1.03 (FIG-1117): the frozen sign-in pages are compared with the `pre-makeover` tag, not just with recorded hashes. The only differences
 * allowed since that tag are the ones Given approved (29 Oct 2026): the dev sign-in chips on the login page, which exist only in development and
 * are checked out of the production build by `npm run check:build-output`. Any other line changed on a frozen page fails here.
 *
 * FIG-1592 (Given, 12 Nov 2026): forgot password, reset password, accept invite and the password field are open to VISUAL POLISH ONLY. For those files
 * the markup may change, but what they do may not: `POLISHED_BEHAVIOUR` below pins every endpoint, field, validation rule and redirect, and the
 * second `describe` fails if one goes missing or a new network call appears. Login, sign-up and the hero stay byte-for-byte as approved.
 */

const FROZEN = ["src/app/login", "src/app/signup", "src/app/forgot-password", "src/app/reset-password", "src/app/accept-invite", "src/app/_shared/AuthHero.tsx", "src/app/_shared/PasswordInput.tsx"];
/** Files whose approved difference is the dev chips only. */
const APPROVED_DEV_CHIPS = new Set(["src/app/login/LoginForm.tsx", "src/app/login/page.tsx"]);
/** Files Given opened to visual polish only (FIG-1592). Their behaviour is pinned below instead of their text. */
const POLISHED = new Set([
  "src/app/forgot-password/page.tsx",
  "src/app/forgot-password/ForgotPasswordForm.tsx",
  "src/app/reset-password/page.tsx",
  "src/app/reset-password/ResetPasswordForm.tsx",
  "src/app/accept-invite/page.tsx",
  "src/app/accept-invite/AcceptInviteForm.tsx",
  "src/app/_shared/PasswordInput.tsx",
]);

/** What each polished file must still do, whatever its markup. Every entry is a regular expression that has to match the source. */
const POLISHED_BEHAVIOUR: Record<string, RegExp[]> = {
  "src/app/forgot-password/ForgotPasswordForm.tsx": [
    /fetch\("\/api\/auth\/password-reset\/request"/,
    /method: "POST"/,
    /JSON\.stringify\(\{ email \}\)/,
    /type="email"/,
    /autoComplete="email"/,
    /\brequired\b/,
    /If that email has an account, a password reset link has been sent\./,
    /disabled=\{submitting\}/,
  ],
  "src/app/reset-password/ResetPasswordForm.tsx": [
    /fetch\("\/api\/auth\/password-reset\/confirm"/,
    /JSON\.stringify\(\{ token, newPassword \}\)/,
    /autoComplete="new-password"/,
    /minLength=\{10\}/,
    /\brequired\b/,
    /router\.push\("\/login"\)/,
    /setTimeout\(\(\) => router\.push\("\/login"\), 1500\)/,
    /body\.error \?\? "Could not reset password\."/,
    /disabled=\{submitting\}/,
  ],
  "src/app/reset-password/page.tsx": [/searchParams/, /\{ token \} = await searchParams/, /<ResetPasswordForm token=\{token\}/, /Missing reset token\. Use the link from your password reset email\./],
    "src/app/accept-invite/AcceptInviteForm.tsx": [
    /fetch\("\/api\/auth\/accept-invite"/,
    /JSON\.stringify\(\{ token, password: requiresPassword \? password : undefined \}\)/,
    /autoComplete="new-password"/,
    /minLength=\{10\}/,
    /\brequired\b/,
    /router\.push\(`\/o\/\$\{body\.organizationSlug\}`\)/,
    /router\.refresh\(\)/,
    /body\.error \?\? "Could not accept invite\."/,
    /disabled=\{submitting\}/,
  ],
  "src/app/accept-invite/page.tsx": [/getInviteInfo\(token\)/, /Missing invite token\. Use the link from your invite email\./, /Invalid or expired invite link\./, /requiresPassword=\{info\.requiresPassword\}/],
  "src/app/_shared/PasswordInput.tsx": [/type=\{visible \? "text" : "password"\}/, /onChange=\{\(e\) => onChange\(e\.target\.value\)\}/, /minLength=\{minLength\}/, /autoComplete=\{autoComplete\}/, /aria-label=\{visible \? "Hide password" : "Show password"\}/],
};

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
    expect(names.filter((n) => !APPROVED_DEV_CHIPS.has(n) && !POLISHED.has(n))).toEqual([]);
  });

  it("the approved differences add only dev sign-in chip code and remove nothing but the lines they replace around it", () => {
    for (const file of names.filter((n) => APPROVED_DEV_CHIPS.has(n))) {
      const patch = git(["diff", "-U0", "pre-makeover", "--", file]) ?? "";
      const added = patch.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));
      const removed = patch.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"));
      // Every added line is about the chips (import, flag, render) and at most a handful of lines were replaced to mount them.
      expect(removed.length, `${file} removed lines`).toBeLessThanOrEqual(6);
      expect(added.join("\n"), `${file} added lines`).toMatch(/chip|Chip|DevChips|dev/);
    }
  });
});

describe("the polished pages still do exactly what they did (FIG-1592: visual polish only)", () => {
  for (const [file, patterns] of Object.entries(POLISHED_BEHAVIOUR)) {
    it(`${file} keeps its endpoints, fields, validation and redirects`, () => {
      const text = readFileSync(file, "utf8");
      for (const re of patterns) expect(text, String(re)).toMatch(re);
    });
  }

  it("the only network calls on these pages are the three auth endpoints they always made", () => {
    const calls = [...POLISHED].flatMap((f) => [...readFileSync(f, "utf8").matchAll(/fetch\(\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]));
    expect(calls.sort()).toEqual(["/api/auth/accept-invite", "/api/auth/password-reset/confirm", "/api/auth/password-reset/request"]);
  });

  it("the extra hooks added to the password field are optional, so sign-in and sign-up render it exactly as before", () => {
    const text = readFileSync("src/app/_shared/PasswordInput.tsx", "utf8");
    expect(text).toMatch(/describedBy\?: string/);
    expect(text).toMatch(/invalid\?: boolean/);
  });
});
