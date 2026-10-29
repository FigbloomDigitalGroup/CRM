import { notFound } from "next/navigation";
import { demoScreensEnabled } from "@/ui/demo/enabled";
import { TwoStepForm } from "./TwoStepForm";

/**
 * A5 (FIG-1167): the code step after the frozen sign-in. A new route; the sign-in pages themselves are unchanged (hard rule 1). On demo
 * data until B6.02 provides the real challenge, so outside development it is a 404 unless DEMO_SCREENS=true.
 */
export default function TwoStepPage() {
  if (!demoScreensEnabled()) notFound();
  return <TwoStepForm />;
}
