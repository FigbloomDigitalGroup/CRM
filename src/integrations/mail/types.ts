import type { OAuthProviderKey } from "../oauth/types";

/**
 * The mail seam (FIG-807): read and send through a connected Google or Microsoft mailbox. Services use only this interface, so
 * tests inject a fake and no real network call is made from a test. The real clients are in `./providers.ts`.
 */
export interface ProviderMail {
  /** The provider's own id for the message. */
  id: string;
  /** The RFC Message-ID header, the same on every copy of the message (sender's, receiver's, a BCC), when the provider gives it. */
  internetMessageId: string | null;
  from: { email: string; name?: string | null };
  to: string[];
  cc: string[];
  subject: string;
  bodyText: string;
  receivedAt: Date;
  /** True when it is in the account's Sent folder (the account owner wrote it). */
  sent: boolean;
}

export interface OutgoingMail {
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  /** Set for a reply: the provider message being answered, so it threads. */
  inReplyTo?: { externalId: string; internetMessageId: string | null };
  attachments: { name: string; mimeType: string; content: Buffer }[];
}

export interface MailProviderClient {
  /** Messages in or out of the mailbox since a moment, oldest first, at most `limit`. */
  listMessages(accessToken: string, options: { since: Date; limit: number }): Promise<ProviderMail[]>;
  /** Sends through the mailbox, so it lands in the person's Sent folder. */
  sendMessage(accessToken: string, mail: OutgoingMail): Promise<{ externalId: string; internetMessageId: string | null }>;
}

let factory: ((provider: OAuthProviderKey) => MailProviderClient) | null = null;

/** Tests replace the mail client; pass null to restore the real one. */
export function setMailProviderFactory(next: ((provider: OAuthProviderKey) => MailProviderClient) | null): void {
  factory = next;
}

export async function getMailProvider(provider: OAuthProviderKey): Promise<MailProviderClient> {
  if (factory) return factory(provider);
  const { createMailProvider } = await import("./providers");
  return createMailProvider(provider);
}
