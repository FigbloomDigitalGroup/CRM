/**
 * UC-F2 (audit S-3): where an invitee goes to prove their mailbox. A NEW route, outside the frozen accept-invite page
 * (hard rule 1): the frozen page's source and behaviour are unchanged, and an account whose mailbox nobody has proved is
 * sent here instead (by the invite email, or by the coded refusal the accept API gives).
 */
export const INVITE_VERIFY_PATH = "/invite/verify";

interface AccountProof {
  passwordHash: string | null;
  emailVerifiedAt: Date | null;
}

/** True when the account already has a password that nobody has proved (it came from public signup). */
export function hasUnprovedPassword(user: AccountProof): boolean {
  return Boolean(user.passwordHash) && !user.emailVerifiedAt;
}

/**
 * The link to put in an invite email: the verify route for an unproved account, the ordinary link the caller built for everyone else.
 * For an unproved account the last path segment of the caller's link (the one before `?token=`) is swapped for the verify route, so the
 * origin and the token stay exactly as the caller built them.
 */
export function inviteUrlFor(user: AccountProof, acceptUrl: string): string {
  return hasUnprovedPassword(user) ? acceptUrl.replace(/\/[^/?#]*\?/, `${INVITE_VERIFY_PATH}?`) : acceptUrl;
}

/** Absolute URL of the verify route for a token, using the configured app address (relative when none is configured). */
export function inviteVerifyUrl(token: string): string {
  const base = (process.env.APP_BASE_URL ?? "").trim().replace(/\/+$/, "");
  return `${base}${INVITE_VERIFY_PATH}?token=${encodeURIComponent(token)}`;
}
