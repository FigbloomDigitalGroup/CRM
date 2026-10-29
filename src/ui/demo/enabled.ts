/**
 * Demo-data screens (M10) are reachable outside production, or in production only when `DEMO_SCREENS=true` is set on purpose (for example a
 * presentation environment). Until a screen is wired to the real API (M13/M14) no tenant can reach it by accident: the page calls
 * `notFound()` when this is false. Remove the check from a screen when it is wired.
 */
export function demoScreensEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV !== "production" || env.DEMO_SCREENS === "true";
}

/** The same rule for client components, which only see `NEXT_PUBLIC_` variables: demo screens render outside production, or when `NEXT_PUBLIC_DEMO_SCREENS=true`. */
export function demoScreensEnabledClient(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_DEMO_SCREENS === "true";
}
