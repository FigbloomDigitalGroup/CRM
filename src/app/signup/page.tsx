import { AuthHero } from "@/app/_shared/AuthHero";
import { SignupForm } from "./SignupForm";

export default function SignupPage() {
  return (
    <div className="lg-page">
      <AuthHero />
      <main className="lg-right">
        <SignupForm />
        <div className="lg-rf">
          Protected by role-based access &middot; Figbloom Digital Group
        </div>
      </main>
    </div>
  );
}
