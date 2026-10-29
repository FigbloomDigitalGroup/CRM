import { notFound } from "next/navigation";
import { demoScreensEnabled } from "@/ui/demo/enabled";
import { SetupForm } from "./SetupForm";

/** Two-step enrolment (FIG-1167), a new route on demo data until B6.02. */
export default function TwoStepSetupPage() {
  if (!demoScreensEnabled()) notFound();
  return <SetupForm />;
}
