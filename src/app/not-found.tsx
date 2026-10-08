import { BrandMark } from "@/app/_shared/BrandMark";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <BrandMark className="brand-mark" />
          <div className="auth-brand-name">
            Figbloom<span className="accent"> CRM</span>
          </div>
        </div>
        <h1 style={{ fontSize: 19 }}>Page not found</h1>
        <p className="warning" style={{ marginTop: 8 }}>
          The page you&apos;re looking for doesn&apos;t exist, or you may not have
          access to it.
        </p>
        <p className="warning">
          <Link href="/">Back to FigBloom CRM</Link>
        </p>
      </div>
    </div>
  );
}
