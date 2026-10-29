import "./sign.css";

/** The public signing page's own frame: no organisation, no shell, no sign-in (the link itself is the credential). */
export const viewport = { width: "device-width", initialScale: 1 } as const;
export const metadata = { title: "Sign your quote", robots: { index: false, follow: false } };

export default function SignLayout({ children }: { children: React.ReactNode }) {
  return <div className="sgn">{children}</div>;
}
