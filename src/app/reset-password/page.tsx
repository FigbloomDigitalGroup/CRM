import { BrandMark } from "@/app/_shared/BrandMark";
import { ResetPasswordForm } from "./ResetPasswordForm";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <BrandMark className="brand-mark" />
          <div className="auth-brand-name">
            Figbloom<span className="accent"> CRM</span>
          </div>
        </div>
        <h1 style={{ fontSize: 19 }}>Set a new password</h1>
        {token ? (
          <ResetPasswordForm token={token} />
        ) : (
          <p className="error">
            Missing reset token. Use the link from your password reset email.
          </p>
        )}
      </div>
    </div>
  );
}
