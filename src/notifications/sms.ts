/**
 * SMS/WhatsApp transport (FIG-597 AC: "SMS/WhatsApp optional"). No real
 * provider account exists for this project -- the same documented-gap
 * pattern as Sentry (FIG-595) and Cloudflare Turnstile before a real secret
 * is configured (FIG-594): this is genuinely wired end-to-end (a
 * `NotificationDelivery` row with `channel: SMS` is created and retried
 * exactly like an email one), but with nothing configured, every send logs
 * instead of actually reaching a phone. Swap `createRealTransport` for a
 * real provider SDK (Twilio, Vonage, WhatsApp Business API, ...) once an
 * account exists -- `deliverSmsOrLog`'s fallback behavior and the
 * `SmsTransport` test seam don't need to change.
 */
export interface SmsTransport {
  sendSms(message: { to: string; body: string }): Promise<unknown>;
}

export function isSmsConfigured(): boolean {
  return Boolean(process.env.SMS_PROVIDER_API_KEY);
}

function createRealTransport(): SmsTransport {
  throw new Error(
    "SMS_PROVIDER_API_KEY is set but no real SMS transport is wired up yet -- " +
      "this is a deliberate gap, see src/notifications/sms.ts's header comment.",
  );
}

export async function deliverSmsOrLog(
  logLabel: string,
  message: { to: string; body: string },
  transportOverride?: SmsTransport,
): Promise<void> {
  if (!transportOverride && !isSmsConfigured()) {
    console.log(
      `[${logLabel}] No SMS provider configured -- would send to ${message.to}:\n${message.body}`,
    );
    return;
  }

  const transport = transportOverride ?? createRealTransport();
  await transport.sendSms(message);
}
