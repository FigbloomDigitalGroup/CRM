import { AuthLayout } from "@/app/_shared/AuthLayout";
import { ForgotPasswordForm } from "./ForgotPasswordForm";

export default function ForgotPasswordPage() {
  return (
    <AuthLayout title="Reset your password" lead="Enter the email you sign in with. We will send you a link to choose a new password.">
      <ForgotPasswordForm />
    </AuthLayout>
  );
}
