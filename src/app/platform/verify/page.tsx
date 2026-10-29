import { notFound } from "next/navigation";
import { VerifyPage } from "@/ui/screens/platform";
import { demoScreensEnabled } from "@/ui/demo/enabled";

/**
 * PL14 Verify it's you: the step after a platform password. A new route; the frozen sign-in pages are not touched. Demo only until the real platform
 * sign-in (B6.03) exists; the dev chip skips it.
 */
export default function Page() {
  if (!demoScreensEnabled()) notFound();
  return <VerifyPage next="/login" />;
}
