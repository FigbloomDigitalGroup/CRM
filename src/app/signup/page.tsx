import Image from "next/image";
import { SignupForm } from "./SignupForm";

export default function SignupPage() {
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <Image src="/figbloom-logo.jpg" alt="" width={40} height={40} priority />
          <div className="auth-brand-name">
            Figbloom<span className="accent"> CRM</span>
          </div>
        </div>
        <h1 style={{ fontSize: 19 }}>Sign up</h1>
        <SignupForm />
        <p className="warning">
          Creating an account doesn&apos;t grant access to an organization on
          its own -- an admin still needs to add you to one before you can
          see any CRM data.
        </p>
        <p className="warning">
          Already have an account? <a href="/login">Log in</a>
        </p>
      </div>
    </div>
  );
}
