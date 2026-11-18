import type { Page } from "@playwright/test";
import { gotoAndSettle } from "../helpers";
import { orgPath } from "./catalogue";

/**
 * The looks the accessibility sweep and the visual baselines walk (Q1.02, Q1.03): light, dark, three of the ten themes (a mid blue, the darkest
 * and the neutral grey), compact density, Largest text, high contrast and the 375 px phone width. Device-only looks are set through the same
 * localStorage key the app reads (`figbloom-device-prefs`); account looks (theme, density) by clicking the real Appearance controls.
 */

export interface Look {
  name: string;
  device?: Record<string, unknown>;
  theme?: string;
  density?: "Compact";
  viewport?: { width: number; height: number };
}

export const LOOKS: Look[] = [
  { name: "light" },
  { name: "dark", device: { scheme: "dark" } },
  { name: "theme-ocean", theme: "Ocean" },
  { name: "theme-midnight", theme: "Midnight" },
  { name: "theme-charcoal", theme: "Charcoal and amber" },
  { name: "compact", density: "Compact" },
  { name: "largest-text", device: { textSize: "EXTRA_LARGE" } },
  { name: "high-contrast", device: { higherContrast: true, bold: true } },
  { name: "phone-375", viewport: { width: 375, height: 812 } },
];

export async function applyDevice(page: Page, device: Record<string, unknown> | undefined): Promise<void> {
  await page.addInitScript((d) => {
    try {
      localStorage.setItem("figbloom-device-prefs", JSON.stringify(d ?? {}));
    } catch {
      /* storage blocked: the default look is used */
    }
  }, device ?? null);
}

/** Applies the account-level parts of a look through the real Appearance tab; returns a function that puts the account back to the default. */
export async function applyAccountLook(page: Page, look: Look): Promise<() => Promise<void>> {
  if (!look.theme && !look.density) return async () => {};
  await gotoAndSettle(page, orgPath("/preferences?tab=appearance"));
  if (look.theme) await page.getByRole("radio", { name: new RegExp(look.theme) }).click();
  if (look.density) await page.getByRole("radio", { name: look.density }).click();
  await page.waitForTimeout(400);
  return async () => {
    await gotoAndSettle(page, orgPath("/preferences?tab=appearance"));
    await page.getByRole("button", { name: "Reset to default" }).click();
    await page.getByRole("dialog", { name: "Reset appearance to default?" }).getByRole("button", { name: "Reset" }).click();
    await page.getByText("Appearance reset to default.").waitFor();
  };
}
