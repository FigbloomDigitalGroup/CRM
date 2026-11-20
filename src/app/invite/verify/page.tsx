import { AuthLayout, AuthLinks, AuthNotice } from "@/app/_shared/AuthLayout";
import { getInviteVerification } from "@/services/authService";
import { VerifyInviteForm } from "./VerifyInviteForm";

/**
 * UC-F2 (audit S-3): the step where an invitee proves they own the mailbox, by choosing a fresh password from the invite link. A NEW route; the
 * frozen accept-invite page is untouched (hard rule 1). It is for an account that already has a password nobody proved (public signup): the
 * invite email links here for such an account, and the accept API sends anyone who tries the old page here. Everyone else still uses /accept-invite.
 */
export default async function VerifyInvitePage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token: raw } = await searchParams;
  const token = typeof raw === "string" ? raw : "";

  let info: { email: string; needsPassword: boolean } | null = null;
  let error: string | null = null;
  if (!token) {
    error = "Missing invite token. Use the link from your invite email.";
  } else {
    try {
      info = await getInviteVerification(token);
    } catch (err) {
      error = err instanceof Error ? err.message : "Invalid or expired invite link.";
    }
  }

  return (
    <AuthLayout title="Confirm it is you" lead={info ? undefined : "You need a valid invite link to join."}>
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
      {info && token && !info.needsPassword && (
        <>
          <AuthNotice kind="info">This invite for {info.email} does not need this step. Open the invite link from your email to accept it.</AuthNotice>
          <AuthLinks>
            <a href="/login">Back to sign in</a>
          </AuthLinks>
        </>
      )}
      {info && token && info.needsPassword && (
        <>
          <AuthNotice kind="info">Invite for {info.email}. An account with this address already exists, so choose a new password to confirm the address is yours.</AuthNotice>
          <VerifyInviteForm token={token} />
        </>
      )}
    </AuthLayout>
  );
}
