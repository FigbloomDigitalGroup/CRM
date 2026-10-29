import type { ReactNode } from "react";

/**
 * "Demo data" marker (docs/RESTRUCTURE_LOG.md, demo data convention). Every M10 screen that reads from a `demo/` module renders this, so nobody
 * mistakes a demo record for a real one. When a screen is wired to the real API, its `demo/` module goes and so does this badge.
 */
export function DemoBadge({ children }: { children?: ReactNode }) {
  return (
    <span className="fb-demo-badge" role="note" title="This screen shows sample records until it is connected to the real API.">
      {children ?? "Demo data"}
    </span>
  );
}

export function DemoNotice({ what }: { what: string }) {
  return (
    <div className="fb-demo-notice" role="note">
      <DemoBadge /> <span>{what} shows sample records. Nothing here is saved to a real organisation.</span>
    </div>
  );
}
