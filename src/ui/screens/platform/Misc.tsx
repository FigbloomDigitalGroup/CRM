"use client";

import Link from "next/link";
import { PageHead } from "./kit";
import { usePlatformTheme } from "./PlatformRoot";

/** PL15 Not found: what a missing console page shows. (An organisation user who opens a platform address gets the app's ordinary 404, with no hint the console exists.) */
export function PlatformNotFound() {
  return (
    <div className="fb-pl-nf" data-screen-label="PL15 Not found">
      <div className="fb-pl-mono fb-pl-muted" style={{ fontSize: 13 }}>404</div>
      <h1 style={{ margin: "8px 0 6px", fontSize: 26 }}>Page not found</h1>
      <p className="fb-pl-muted2" style={{ margin: 0 }}>The page you’re looking for doesn’t exist.</p>
      <Link href="/platform" className="fb-pl-btn" style={{ marginTop: 16 }}>Go to Platform home</Link>
    </div>
  );
}

/** Platform preferences: the admin's own appearance, kept on this device. Platform admins have no organisation, so there is no organisation look to inherit. */
export function PlatformPreferences() {
  const { theme, toggle } = usePlatformTheme();
  return (
    <>
      <PageHead title="Preferences" sub="Your own settings as a platform admin. They apply on this device." />
      
      <section className="fb-pl-card" style={{ maxWidth: 780 }} aria-label="Appearance">
        <h2 style={{ marginBottom: 12 }}>Appearance</h2>
        <div className="fb-pl-seg" role="group" aria-label="Colour scheme">
          <button type="button" aria-pressed={theme === "light"} onClick={() => theme !== "light" && toggle()}>Light</button>
          <button type="button" aria-pressed={theme === "dark"} onClick={() => theme !== "dark" && toggle()}>Dark</button>
        </div>
        <p className="fb-pl-muted2 fb-pl-small" style={{ marginBottom: 0 }}>The console keeps its own purple look so it can never be mistaken for an organisation’s app.</p>
      </section>
    </>
  );
}
