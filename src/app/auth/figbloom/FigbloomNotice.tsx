import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/app/_shared/BrandMark";

/** The small card the Figbloom sign-in pages use: the same look as CRM's "Page not found". */
export function FigbloomNotice({ title, children, action }: { title: string; children: ReactNode; action: { href: string; label: string } }) {
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <BrandMark className="brand-mark" />
          <div className="auth-brand-name">
            Figbloom<span className="accent"> CRM</span>
          </div>
        </div>
        <h1 style={{ fontSize: 19 }}>{title}</h1>
        <p className="warning" style={{ marginTop: 8 }}>
          {children}
        </p>
        <p className="warning">
          {/* a full page load: /login is answered by the middleware, which sends the browser to Figbloom's sign-in page */}
          <Link href={action.href} prefetch={false}>
            {action.label}
          </Link>
        </p>
      </div>
    </div>
  );
}
