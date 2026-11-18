"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

/** Ends the platform session (and the dev Super Admin's, where that exists) and returns to the platform sign-in. Styled by whoever places it (the console's account menu passes its own class). */
export function PlatformSignOut({ className, children }: { className?: string; children?: ReactNode }) {
  const router = useRouter();
  async function signOut() {
    await fetch("/api/platform/auth/sign-out", { method: "POST" }).catch(() => undefined);
    // Only the dev Super Admin has this session; the route does not exist outside development.
    await fetch("/api/dev-session", { method: "DELETE" }).catch(() => undefined);
    router.push("/platform/sign-in");
    router.refresh();
  }
  return (
    <button type="button" className={className} onClick={signOut}>
      {children ?? "Sign out"}
    </button>
  );
}
