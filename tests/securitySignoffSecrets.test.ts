import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * P1.06 (FIG-1128): the repository holds no real key, token or private key, and no real `.env` is tracked. Reports file names only, never a
 * matched value. The one allowed hit is Amazon's published documentation example key, used by the signed-URL tests.
 */
const HIGH_CONFIDENCE = [
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /sk_live_[0-9a-zA-Z]{10,}/,
  /xox[baprs]-[0-9A-Za-z-]{10,}/,
  /gh[pousr]_[0-9A-Za-z]{30,}/,
  /lin_api_[0-9A-Za-z]{20,}/,
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/,
];
const ALLOWED_VALUES = new Set(["AKIAIOSFODNN7EXAMPLE"]);

function trackedFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out.split("\0").filter(Boolean);
}

describe("secrets scan (P1.06)", () => {
  it("no tracked text file contains a high-confidence secret", () => {
    const offenders: string[] = [];
    for (const file of trackedFiles()) {
      if (/\.(png|jpe?g|gif|ico|woff2?|ttf|pdf|zip|xlsx|docx)$/i.test(file) || file === "package-lock.json") continue;
      let text: string;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      for (const pattern of HIGH_CONFIDENCE) {
        const global = new RegExp(pattern.source, "g");
        for (const match of text.matchAll(global)) {
          if (!ALLOWED_VALUES.has(match[0])) offenders.push(`${file} (${pattern.source.slice(0, 12)})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("only the example environment files are tracked", () => {
    const envFiles = trackedFiles().filter((f) => /(^|\/)\.env(\.|$)/.test(f));
    expect(envFiles.sort()).toEqual([".env.example", ".env.staging.example"]);
  });
});
