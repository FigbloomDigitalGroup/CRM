import { AuthLayout, AuthLinks, AuthNotice } from "@/app/_shared/AuthLayout";
import { ResetPasswordForm } from "./ResetPasswordForm";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <AuthLayout title="Set a new password" lead={token ? "Choose a password you do not use anywhere else." : undefined}>
      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <>
          <AuthNotice kind="error" title="This link is missing its reset code">
            Missing reset token. Use the link from your password reset email.
          </AuthNotice>
          <AuthLinks>
            <a href="/forgot-password">Send me a new link</a>
            <a href="/login">Back to sign in</a>
          </AuthLinks>
        </>
      )}
    </AuthLayout>
  );
}
