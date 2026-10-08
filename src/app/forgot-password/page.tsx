import { BrandMark } from "@/app/_shared/BrandMark";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export default function ForgotPasswordPage() {
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <BrandMark className="brand-mark" />
          <div className="auth-brand-name">
            Figbloom<span className="accent"> CRM</span>
          </div>
        </div>
        <h1 style={{ fontSize: 19 }}>Reset your password</h1>
        <ForgotPasswordForm />
      </div>
    </div>
  );
}
