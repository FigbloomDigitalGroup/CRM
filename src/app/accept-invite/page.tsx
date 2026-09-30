import Image from "next/image";
import { getInviteInfo } from "@/services/authService";
import { AcceptInviteForm } from "./AcceptInviteForm";

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  let info: { email: string; requiresPassword: boolean } | null = null;
  let error: string | null = null;
  if (!token) {
    error = "Missing invite token. Use the link from your invite email.";
  } else {
    try {
      info = await getInviteInfo(token);
    } catch (err) {
      error = err instanceof Error ? err.message : "Invalid or expired invite link.";
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <Image src="/figbloom-logo.jpg" alt="" width={40} height={40} priority />
          <div className="auth-brand-name">
            Figbloom<span className="accent"> CRM</span>
          </div>
        </div>
        <h1 style={{ fontSize: 19 }}>Accept your invite</h1>
        {error && <p className="error">{error}</p>}
        {info && token && (
          <>
            <p className="warning">Invite for {info.email}.</p>
            <AcceptInviteForm token={token} requiresPassword={info.requiresPassword} />
          </>
        )}
      </div>
    </div>
  );
}
