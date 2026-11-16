import Link from "next/link";
import { AuthLayout } from "@/app/_shared/AuthLayout";

export default function NotFound() {
  return (
    <AuthLayout title="Page not found" lead="The page you are looking for does not exist, or you may not have access to it. Check the address, or go back to FigBloom CRM.">
      <div className="auth-actions">
        <Link className="auth-btn" href="/">
          Back to FigBloom CRM
        </Link>
      </div>
    </AuthLayout>
  );
}
