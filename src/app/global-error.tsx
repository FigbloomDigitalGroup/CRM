"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * FIG-753: the one boundary Next.js checks when the root layout itself
 * throws (a plain `error.tsx` can't catch that -- it's nested inside the
 * layout it would need to replace). Must render its own `<html>`/`<body>`
 * since it takes over the whole document in that case. Deliberately
 * minimal/inline-styled, not using the app's own CSS -- if the root layout
 * failed, there's no guarantee globals.css loaded either.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", background: "#1c4e6e", color: "#17181a" }}>
        <main
          aria-labelledby="ge-title"
          style={{ boxSizing: "border-box", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
        >
          <div style={{ width: "100%", maxWidth: 440, background: "#ffffff", borderRadius: 16, padding: "32px 28px", boxShadow: "0 20px 60px rgba(0,0,0,0.35)" }}>
            <p style={{ margin: "0 0 16px", fontWeight: 800, fontSize: 18 }}>
              Figbloom<span style={{ color: "#a85d00" }}> CRM</span>
            </p>
            <h1 id="ge-title" style={{ fontSize: 22, lineHeight: 1.25, margin: "0 0 8px" }}>
              Something went wrong
            </h1>
            <p style={{ margin: "0 0 20px", fontSize: 14, lineHeight: 1.55, color: "#4a4d47" }}>
              An unexpected error occurred. Please reload the page. If it keeps happening, tell your administrator.
            </p>
            <a
              href="/"
              style={{ display: "inline-flex", alignItems: "center", minHeight: 44, padding: "0 18px", borderRadius: 8, background: "#1d5f8f", color: "#ffffff", fontWeight: 600, fontSize: 14, textDecoration: "none" }}
            >
              Reload FigBloom CRM
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
