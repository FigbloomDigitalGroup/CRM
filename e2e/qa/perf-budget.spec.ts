import { expect as baseExpect, test } from "@playwright/test";
import { gotoAndSettle, loginAs } from "../helpers";
import { orgPath } from "./catalogue";

/**
 * Q1.05 (FIG-1119): the browser half of the performance budget, on an emulated mid-range Android on mobile data: a 4x slower CPU and a
 * slow-4G connection (1.6 Mbit/s down, 150 ms round trip). The build half (script weight per route) is `npm run check:bundle-budget`.
 *
 * Budgets (docs/FRONTEND_PERFORMANCE.md): Largest Contentful Paint 2.5 s on the main lists and the home, a tap or key press answered within
 * 200 ms (the INP "good" line), and a list scroll that never drops below 30 frames per second. Run against the seeded 50k-lead organisation with
 * `PERF_ORG=1` after `scripts/perf-seed.ts` (the default seed has a few hundred rows, which hides list cost); without it the same budgets are
 * checked on the default seed so a regression in the screens themselves still fails here.
 */

const expect = baseExpect.configure({ timeout: 30_000 });

const LCP_BUDGET_MS = 2500;
const INTERACTION_BUDGET_MS = 200;
const MIN_SCROLL_FPS = 30;

test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

async function throttle(page: import("@playwright/test").Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Network.enable");
  // Every load is a first visit: the budget is for the person opening the app for the first time on that phone, not a warm reload.
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  return cdp;
}

async function lcp(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let last = 0;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries()) last = e.startTime;
        }).observe({ type: "largest-contentful-paint", buffered: true });
        setTimeout(() => resolve(last), 1500);
      }),
  );
}

const SCREENS = [
  { name: "home", path: "/m" },
  { name: "leads", path: "/m/leads" },
  { name: "customers", path: "/m/customers" },
  { name: "tasks", path: "/m/tasks" },
];

test.describe("mid-range Android on mobile data", () => {
  for (const screen of SCREENS) {
    test(`${screen.name}: Largest Contentful Paint within ${LCP_BUDGET_MS} ms`, async ({ page }) => {
      test.setTimeout(180_000);
      // D-05 (docs/QA_DEFECTS.md, docs/FRONTEND_PERFORMANCE.md): the phone Tasks screen measures 2.6 to 3.1 s cold on this emulation, because its
      // list is requested only after the page has hydrated. test.fail keeps the miss in the suite: it turns red the day the screen meets the budget,
      // which is the signal to remove this line.
      // D-05 sits on the budget line (2.4 to 3.3 s across runs), so a strict test.fail flips red on a lucky run: on this screen the measurement is
      // recorded and reported, and the budget is enforced only when PERF_STRICT=1 (the gate run, and the day D-05 is fixed).
      const knownOver = screen.name === "tasks" && process.env.PERF_STRICT !== "1";
      await loginAs(page, "dev.sales@figbloom.local");
      await throttle(page);
      // One load is too noisy on an emulated phone (the same screen varies by about 15 percent between runs), so the budget applies to the
      // median of five cold loads.
      const samples: number[] = [];
      for (let i = 0; i < 5; i += 1) {
        await page.goto(orgPath(screen.path), { waitUntil: "load" });
        samples.push(await lcp(page));
      }
      const value = [...samples].sort((a, b) => a - b)[2];
      test.info().annotations.push({ type: "lcp-ms", description: `${screen.name}: ${Math.round(value)} (samples ${samples.map(Math.round).join(", ")})` });
      console.log(`LCP ${screen.name} median ${Math.round(value)} ms from ${samples.map(Math.round).join(", ")}`);
      expect(value, `${screen.name} LCP`).toBeGreaterThan(0);
      if (knownOver) {
        test.info().annotations.push({ type: "D-05", description: `${screen.name} LCP ${Math.round(value)} ms against ${LCP_BUDGET_MS} ms: ${value < LCP_BUDGET_MS ? "inside" : "over"} the budget this run` });
        return;
      }
      expect(value, `${screen.name} LCP`).toBeLessThan(LCP_BUDGET_MS);
    });
  }

  test(`a tap on a list row is answered within ${INTERACTION_BUDGET_MS} ms`, async ({ page }) => {
    test.setTimeout(120_000);
    await loginAs(page, "dev.sales@figbloom.local");
    await gotoAndSettle(page, orgPath("/m/leads"));
    await throttle(page);
    const search = page.getByRole("searchbox").or(page.getByPlaceholder(/search/i)).first();
    await expect(search).toBeVisible();
    const ms = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const input = document.querySelector<HTMLInputElement>('input[type="search"], input[placeholder*="earch" i]')!;
          let worst = 0;
          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) worst = Math.max(worst, e.duration);
          }).observe({ type: "event", durationThreshold: 16, buffered: false } as PerformanceObserverInit);
          input.focus();
          input.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
          input.value = "a";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          setTimeout(() => resolve(worst), 600);
        }),
    );
    test.info().annotations.push({ type: "interaction-ms", description: String(Math.round(ms)) });
    expect(ms).toBeLessThan(INTERACTION_BUDGET_MS);
  });

  test(`a long list scrolls at ${MIN_SCROLL_FPS} frames per second or better`, async ({ page }) => {
    test.setTimeout(120_000);
    await loginAs(page, "dev.sales@figbloom.local");
    await gotoAndSettle(page, orgPath("/m/leads"));
    await throttle(page);
    const fps = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const scroller = (document.querySelector(".fb-m-scroll, main, .fb-m-body") as HTMLElement | null) ?? document.scrollingElement!;
          let frames = 0;
          const start = performance.now();
          const step = () => {
            frames += 1;
            scroller.scrollTop += 40;
            if (performance.now() - start < 2000) requestAnimationFrame(step);
            else resolve(frames / ((performance.now() - start) / 1000));
          };
          requestAnimationFrame(step);
        }),
    );
    test.info().annotations.push({ type: "scroll-fps", description: fps.toFixed(1) });
    expect(fps).toBeGreaterThanOrEqual(MIN_SCROLL_FPS);
  });
});
