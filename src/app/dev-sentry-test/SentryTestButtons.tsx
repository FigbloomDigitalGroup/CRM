"use client";

import { useState } from "react";

export function SentryTestButtons() {
  const [shouldThrow, setShouldThrow] = useState(false);
  const [serverResult, setServerResult] = useState<string | null>(null);

  // Thrown during render (not inside the click handler itself) so React's
  // error boundary (src/app/error.tsx) actually catches it -- boundaries
  // don't catch errors thrown directly inside event handlers.
  if (shouldThrow) {
    throw new Error("FIG-753 test: deliberate client-side render error");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 420 }}>
      <button onClick={() => setShouldThrow(true)}>Throw client-side error</button>
      <button
        onClick={async () => {
          const res = await fetch("/api/dev-sentry-test");
          setServerResult(`Response: ${res.status} ${await res.text()}`);
        }}
      >
        Trigger server-side error
      </button>
      {serverResult && <p>{serverResult}</p>}
    </div>
  );
}
