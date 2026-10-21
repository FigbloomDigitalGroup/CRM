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
      <body style={{ fontFamily: "system-ui, sans-serif", padding: 40 }}>
        <h1 style={{ fontSize: 20 }}>Something went wrong</h1>
        <p>An unexpected error occurred. Please reload the page.</p>
      </body>
    </html>
  );
}
