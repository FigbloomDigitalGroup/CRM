import { FigbloomNotice } from "../FigbloomNotice";

export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  sign_in_expired: "That sign-in took too long or was already used. Please sign in again.",
  state_mismatch: "That sign-in didn't start here, or it timed out. Please sign in again.",
  sign_in_unreachable: "Figbloom sign-in could not be reached just now. Please try again in a moment.",
  account_inactive: "This CRM account is not active. Ask your organisation's Management users.",
  account_deactivated: "Your access to CRM has been turned off by your organisation.",
  no_email: "Your Figbloom account has no email address, so CRM can't find you.",
  sign_in_failed: "Signing in didn't complete. Please try again.",
};

/** Where a Figbloom sign-in that failed lands (never /login, which would loop back to the sign-in page). */
export default async function FigbloomSignInError({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;
  return (
    <FigbloomNotice title="We couldn't sign you in" action={{ href: "/login", label: "Sign in again" }}>
      {MESSAGES[code ?? ""] ?? MESSAGES.sign_in_failed}
    </FigbloomNotice>
  );
}
