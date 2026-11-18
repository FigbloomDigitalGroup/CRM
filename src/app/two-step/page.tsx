import { TwoStepForm } from "./TwoStepForm";

/**
 * A5 (FIG-1167): the code step after the frozen sign-in. A new route; the sign-in pages themselves are unchanged (hard rule 1). It works from the
 * pending cookie the password step sets (`docs/TWO_STEP_SIGN_IN.md`), so it needs no other protection.
 */
export default function TwoStepPage() {
  return <TwoStepForm />;
}
