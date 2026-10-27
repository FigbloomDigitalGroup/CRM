import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards for the front end's two standing rules:
 *  - F1.06: no screen calls `fetch` directly; everything goes through the typed client. The lint rule enforces it going forward; this test keeps
 *    the list of older files that still call it (in `.eslintrc.json`) honest, so it can only shrink.
 *  - Hard rule 1 / F1.01 / F1.07: the five frozen sign-in pages do not change and do not read the new design tokens.
 */

const norm = (p: string) => p.split("\\").join("/");

function walk(dir: string, skip: (p: string) => boolean = () => false): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = norm(join(dir, name));
    if (skip(p)) return [];
    return statSync(p).isDirectory() ? walk(p, skip) : /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

const eslint = JSON.parse(readFileSync(".eslintrc.json", "utf8"));
const override = (eslint.overrides ?? []).find((o: { rules?: Record<string, unknown> }) => o.rules && "no-restricted-globals" in o.rules);
const unbracket = (g: string) => g.split("[[]").join("[").split("[]]").join("]");

describe("no direct fetch in screens (F1.06)", () => {
  const exempt: string[] = (override?.excludedFiles ?? []).map(unbracket);
  const callers = [...walk("src/app", (p) => p.startsWith("src/app/api")), ...walk("src/ui")].filter((f) => /(^|[^.\w])fetch\(/.test(readFileSync(f, "utf8")));

  it("the lint rule is configured as an error for src/ui and src/app", () => {
    expect(override).toBeTruthy();
    expect(override.rules["no-restricted-globals"][0]).toBe("error");
    expect(override.files).toEqual(expect.arrayContaining(["src/ui/**/*.tsx", "src/app/**/*.tsx"]));
    expect(exempt).toContain("src/ui/data/client.ts");
  });

  it("only the transport and the older, not yet migrated files call fetch", () => {
    const unlisted = callers.filter((f) => !exempt.includes(f));
    expect(unlisted, "These files call fetch directly. Use useApiQuery / useApiMutation from @/ui instead.").toEqual([]);
  });

  it("every exemption still needs it: when a file stops calling fetch it must come off the list (the list only shrinks)", () => {
    const stale = exempt.filter((f) => f.endsWith(".ts") || f.endsWith(".tsx")).filter((f) => !f.endsWith("/**") && !callers.includes(f));
    expect(stale, "Remove these from excludedFiles in .eslintrc.json.").toEqual([]);
  });
});

describe("the frozen sign-in pages (hard rule 1)", () => {
  // sha256 of each file's text with line endings normalised, recorded when the design was approved (27 Oct 2026). A change to any of them fails here;
  // it needs Given's and Michael's say-so, and a deliberate update of this table in the same change.
  const FROZEN: Record<string, string> = {
    "src/app/login/page.tsx": "7964e15a5749f455f7e604c34c26eef58ca96c65b81bed56d3517b5404f336e7",
    "src/app/login/LoginForm.tsx": "eb2eb49399ba386dea9a85e12f9583ea6c82a37abfe89871f27dd70638138a98",
    "src/app/signup/page.tsx": "1a6edf08e8d7fb3471d448542c8d633e0cea03ec74bb7477557e33c14f5ecec8",
    "src/app/signup/SignupForm.tsx": "896ba29b08c148d45c924a87cc89bf56c90226d61eed0472865282661895c786",
    "src/app/forgot-password/page.tsx": "3532069a14ea82187c6375fa8189615b49ec533697e279bb593d3f006f879052",
    "src/app/forgot-password/ForgotPasswordForm.tsx": "3093847a152fe652bafff1193b891a63d1a2d881ddf737aa7e301e3d566537cb",
    "src/app/reset-password/page.tsx": "825e5727fccf8593bb7861098d704daf452483457b7e58667f043b86682192a9",
    "src/app/reset-password/ResetPasswordForm.tsx": "b8ad227e2ee8204cc15d3582fdfe404cb61702d66390d916d620f433cbcfead1",
    "src/app/accept-invite/page.tsx": "15d40b46c0ac871fef48338320ce2d055f5085c377e0efe8a3dcbacee36554aa",
    "src/app/accept-invite/AcceptInviteForm.tsx": "61d365e430c9e58e492eb4ecd1bcf4540ef82d6b47be7010a1a48493e7d61703",
    "src/app/_shared/AuthHero.tsx": "d4f3a599483f0fd99c826757451f1d66c45d690e80b81afe5222b38685344740",
    "src/app/_shared/PasswordInput.tsx": "15a394403ca5108cec3c53aae5466ed3296fa5f9b738b9facc653ddb77e865bd",
  };

  it("none of their files has changed", () => {
    const changed = Object.entries(FROZEN)
      .filter(([file, hash]) => createHash("sha256").update(readFileSync(file, "utf8").split("\r\n").join("\n")).digest("hex") !== hash)
      .map(([file]) => file);
    expect(changed).toEqual([]);
  });

  it("none of them imports the design system or its stylesheet, and only the organisation layout loads that stylesheet", () => {
    const frozenDirs = ["src/app/login", "src/app/signup", "src/app/forgot-password", "src/app/reset-password", "src/app/accept-invite"];
    for (const file of [...frozenDirs.flatMap((d) => walk(d)), "src/app/_shared/AuthHero.tsx", "src/app/_shared/PasswordInput.tsx"]) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/@\/ui|ui\.css|\/ui\//);
    }
    const loaders = walk("src").filter((f) => /import\s+["'][^"']*ui\.css["']/.test(readFileSync(f, "utf8")));
    expect(loaders).toEqual(["src/app/o/[orgSlug]/layout.tsx"]);
  });

  it("the design system stylesheet styles only its own classes, never a bare element, so nothing outside the app can change", () => {
    // The base stylesheet plus every screen stylesheet it imports: all of them are held to the same rule.
    const files = (readdirSync("src/ui", { recursive: true }) as string[]).map(norm).filter((f) => f.endsWith(".css"));
    expect(files).toContain("ui.css");
    const css = files
      .map((f) => readFileSync(`src/ui/${f}`, "utf8"))
      .join("\n")
      .replace(/@import[^;]*;/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const bad: string[] = [];
    // @keyframes bodies (percentages, from, to) and @media preludes are not selectors; :is()/:where() lists are not separate selectors.
    const stripped = css
      .replace(/@keyframes[^{]*{(?:[^{}]*{[^{}]*})*[^{}]*}/g, "")
      .replace(/@media[^{]*/g, "")
      .replace(/:(?:is|where|not)([^)]*)/g, "");
    for (const m of stripped.matchAll(/([^{}]+){/g)) {
      for (const sel of m[1]!.split(",")) {
        const s = sel.trim();
        // The first compound selector must carry one of our classes, so the rule can only ever match our own markup.
        const first = s.split(/[s>+~]/)[0]!;
        if (s && !first.includes(".fb-")) bad.push(s);
      }
    }
    expect(bad).toEqual([]);
  });
});
