import { readConfirmEmailToken } from "@/auth/figbloom/emailConfirm";
import { figbloomSettings, figbloomSignInEnabled } from "@/auth/figbloom/settings";
import { confirmFigbloomEmail } from "@/services/figbloomSignInService";
import { FigbloomNotice } from "../FigbloomNotice";

export const dynamic = "force-dynamic";

/**
 * The "Confirm your email" link from the Figbloom sign-up welcome email (ERP/CRM_COGNITO_CONTRACT.md section 2):
 * the platform marks the Figbloom account's email verified, so its "Forgot password" can reach the person.
 */
export default async function ConfirmFigbloomEmail({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const proof = figbloomSignInEnabled() && token ? readConfirmEmailToken(token, figbloomSettings().clientSecret) : null;
  let confirmed = false;
  if (proof) {
    try {
      confirmed = await confirmFigbloomEmail(proof);
    } catch (err) {
      console.error("[figbloom-sign-in] confirm email failed:", err instanceof Error ? err.message : err);
    }
  }
  return confirmed ? (
    <FigbloomNotice title="Email confirmed" action={{ href: "/login", label: "Go to Figbloom CRM" }}>
      Thank you. If you ever forget your password, Figbloom sign-in can now send you a reset code.
    </FigbloomNotice>
  ) : (
    <FigbloomNotice title="This link didn't work" action={{ href: "/login", label: "Go to Figbloom CRM" }}>
      The link has expired or was already changed. You can still sign in; ask us for a new link if you need to reset your
      password.
    </FigbloomNotice>
  );
}
