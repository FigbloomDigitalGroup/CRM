import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEV_ONLY_MARKERS, findMarkers } from "../scripts/check-build-output";

/** F1.07: the production-build check finds dev-only code wherever it hides, and passes a clean build. */

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function fakeBuild(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "fb-build-"));
  dirs.push(root);
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, text);
  }
  return root;
}

describe("production build check", () => {
  it("passes a build with none of the dev-only markers", () => {
    const root = fakeBuild({ "BUILD_ID": "x", "static/chunks/app.js": "console.log('hello')", "server/app/login.html": "<h1>Sign in</h1>" });
    expect(findMarkers(root)).toEqual([]);
  });

  it("finds each marker in server and client output, and in rendered pages", () => {
    const root = fakeBuild({
      "static/chunks/a.js": 'x("data-figbloom-dev-chips")',
      "server/app/page.js": "function renderDevChips(){}",
      "server/app/login.html": "<button>Dev sign-in</button>",
      "server/chunks/b.js": "const DevChipsPanel = 1",
    });
    const found = findMarkers(root);
    expect(new Set(found.map((f) => f.marker))).toEqual(new Set(DEV_ONLY_MARKERS));
    expect(found).toHaveLength(4);
  });

  it("ignores the build cache, which is never shipped", () => {
    const root = fakeBuild({ "cache/webpack/old.js": "renderDevChips" });
    expect(findMarkers(root)).toEqual([]);
  });
});
