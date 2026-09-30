/**
 * Optional CAPTCHA verification for the public lead-capture endpoint
 * (FIG-594), via Cloudflare Turnstile -- a straightforward server-side
 * verify call (no SDK needed), and only runs when an organization has
 * configured `WebsiteApiKey.captchaSecret`. No captcha secret configured
 * means no captcha check at all, matching "optional" in the ticket.
 */
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyCaptchaToken(
  secret: string,
  token: string,
  remoteIp?: string | null,
): Promise<boolean> {
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);

  try {
    const res = await fetch(VERIFY_URL, { method: "POST", body });
    if (!res.ok) return false;
    const json = (await res.json()) as { success?: boolean };
    return json.success === true;
  } catch {
    // A network failure talking to the verification provider should fail
    // closed (reject the submission), not silently let every request
    // through as if captcha were unconfigured.
    return false;
  }
}
