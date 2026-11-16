import { AuthLayout, AuthLinks, AuthNotice } from "@/app/_shared/AuthLayout";
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
    <AuthLayout title="Accept your invite" lead={info ? undefined : "You need a valid invite link to join."}>
      {error && (
        <>
          <AuthNotice kind="error" title="We could not open this invite">
            {error}
          </AuthNotice>
          <AuthLinks>
            <span>Ask the person who invited you to send a new invite.</span>
            <a href="/login">Back to sign in</a>
          </AuthLinks>
        </>
      )}
      {info && token && (
        <>
          <AuthNotice kind="info">Invite for {info.email}.</AuthNotice>
          <AcceptInviteForm token={token} requiresPassword={info.requiresPassword} />
        </>
      )}
    </AuthLayout>
  );
}
