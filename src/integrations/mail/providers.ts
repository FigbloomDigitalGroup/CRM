import { randomUUID } from "node:crypto";
import { OAuthTransientError, type OAuthProviderKey } from "../oauth/types";
import { safeMimeType, sanitiseFileName } from "../../storage/policy";
import type { MailProviderClient, OutgoingMail, ProviderMail } from "./types";

/**
 * The real Gmail and Microsoft Graph mail clients (FIG-807). Each takes a `fetch`, so a test can put a fake provider server in
 * front of it. Only the scopes of `SCOPES[..].EMAIL` are needed: read, and send.
 */
type Fetch = typeof fetch;

async function json(fetchImpl: Fetch, url: string, token: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) } });
  } catch {
    throw new OAuthTransientError();
  }
  // Never put the body or the url (it can carry ids) in the message.
  if (!res.ok) throw new OAuthTransientError(`The mail provider answered ${res.status}.`);
  const text = await res.text();
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

const addrOf = (raw: string): string => (/<([^<>]+)>/.exec(raw)?.[1] ?? raw).trim().toLowerCase();
const nameOf = (raw: string): string | null => raw.replace(/<[^<>]*>/, "").replace(/^["'\s]+|["'\s]+$/g, "") || null;
const listOf = (raw: string | undefined): string[] => (raw ? raw.split(",").map(addrOf).filter((a) => a.includes("@")) : []);

// ----------------------------- Gmail -----------------------------

type GmailPart = { mimeType?: string; body?: { data?: string }; parts?: GmailPart[] };

function gmailText(part: GmailPart | undefined): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) return Buffer.from(part.body.data, "base64url").toString("utf8");
  for (const child of part.parts ?? []) {
    const text = gmailText(child);
    if (text) return text;
  }
  return "";
}

function mimeFor(mail: OutgoingMail, messageId: string): string {
  const boundary = `fb-${randomUUID()}`;
  // eslint-disable-next-line no-control-regex
  const line = (v: string) => v.replace(/[\r\n\u0000-\u001f\u007f]+/g, " ").trim();
  const head = [
    `To: ${mail.to.map(line).join(", ")}`,
    ...(mail.cc.length ? [`Cc: ${mail.cc.map(line).join(", ")}`] : []),
    `Subject: =?UTF-8?B?${Buffer.from(mail.subject).toString("base64")}?=`,
    `Message-ID: ${messageId}`,
    ...(mail.inReplyTo?.internetMessageId ? [`In-Reply-To: ${mail.inReplyTo.internetMessageId}`, `References: ${mail.inReplyTo.internetMessageId}`] : []),
    "MIME-Version: 1.0",
  ];
  const text = [`Content-Type: text/plain; charset="UTF-8"`, "Content-Transfer-Encoding: base64", "", Buffer.from(mail.body).toString("base64")];
  if (mail.attachments.length === 0) return [...head, ...text].join("\r\n");
  const parts = [`--${boundary}`, ...text];
  for (const a of mail.attachments) {
    const name = sanitiseFileName(a.name);
    // ASCII fallback plus the RFC 2231/5987 form for the real name, so non-ASCII names survive without raw bytes in the header.
    const ascii = name.replace(/[^ -~]/g, "_");
    const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
    parts.push(`--${boundary}`, `Content-Type: ${safeMimeType(a.mimeType)}; name="${ascii}"; name*=UTF-8''${encoded}`, "Content-Transfer-Encoding: base64", `Content-Disposition: attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`, "", a.content.toString("base64"));
  }
  parts.push(`--${boundary}--`);
  return [...head, `Content-Type: multipart/mixed; boundary="${boundary}"`, "", ...parts].join("\r\n");
}

function gmailClient(fetchImpl: Fetch): MailProviderClient {
  const base = "https://gmail.googleapis.com/gmail/v1/users/me";
  return {
    async listMessages(token, { since, limit }) {
      const list = await json(fetchImpl, `${base}/messages?maxResults=${limit}&q=${encodeURIComponent(`after:${Math.floor(since.getTime() / 1000)} -in:chats -in:drafts`)}`, token);
      const ids = ((list.messages as { id: string }[] | undefined) ?? []).map((m) => m.id);
      const out: ProviderMail[] = [];
      for (const id of ids) {
        const m = (await json(fetchImpl, `${base}/messages/${encodeURIComponent(id)}?format=full`, token)) as {
          id: string;
          labelIds?: string[];
          internalDate?: string;
          payload?: GmailPart & { headers?: { name: string; value: string }[] };
        };
        const header = (name: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value;
        const from = header("from") ?? "";
        out.push({
          id: m.id,
          internetMessageId: header("message-id") ?? null,
          from: { email: addrOf(from), name: nameOf(from) },
          to: listOf(header("to")),
          cc: listOf(header("cc")),
          subject: header("subject") ?? "",
          bodyText: gmailText(m.payload),
          receivedAt: new Date(Number(m.internalDate ?? Date.now())),
          sent: (m.labelIds ?? []).includes("SENT"),
        });
      }
      return out.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
    },
    async sendMessage(token, mail) {
      const messageId = `<${randomUUID()}@figbloom.mail>`;
      const raw = Buffer.from(mimeFor(mail, messageId)).toString("base64url");
      const sent = await json(fetchImpl, `${base}/messages/send`, token, { method: "POST", body: JSON.stringify({ raw, ...(mail.inReplyTo ? { threadId: undefined } : {}) }) });
      return { externalId: String(sent.id), internetMessageId: messageId };
    },
  };
}

// ----------------------------- Microsoft Graph -----------------------------

type GraphMessage = {
  id: string;
  internetMessageId?: string;
  subject?: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  toRecipients?: { emailAddress?: { address?: string } }[];
  ccRecipients?: { emailAddress?: { address?: string } }[];
  body?: { content?: string };
  receivedDateTime?: string;
  sentDateTime?: string;
};

function graphClient(fetchImpl: Fetch): MailProviderClient {
  const base = "https://graph.microsoft.com/v1.0/me";
  const prefer = { prefer: 'outlook.body-content-type="text"' };
  const recipients = (list: string[]) => list.map((address) => ({ emailAddress: { address } }));
  return {
    async listMessages(token, { since, limit }) {
      const out: ProviderMail[] = [];
      for (const folder of ["inbox", "sentitems"] as const) {
        const filter = encodeURIComponent(`${folder === "inbox" ? "receivedDateTime" : "sentDateTime"} ge ${since.toISOString()}`);
        const page = await json(fetchImpl, `${base}/mailFolders/${folder}/messages?$top=${limit}&$filter=${filter}`, token, { headers: prefer });
        for (const m of (page.value as GraphMessage[] | undefined) ?? []) {
          out.push({
            id: m.id,
            internetMessageId: m.internetMessageId ?? null,
            from: { email: (m.from?.emailAddress?.address ?? "").toLowerCase(), name: m.from?.emailAddress?.name ?? null },
            to: (m.toRecipients ?? []).map((r) => (r.emailAddress?.address ?? "").toLowerCase()).filter(Boolean),
            cc: (m.ccRecipients ?? []).map((r) => (r.emailAddress?.address ?? "").toLowerCase()).filter(Boolean),
            subject: m.subject ?? "",
            bodyText: m.body?.content ?? "",
            receivedAt: new Date(m.receivedDateTime ?? m.sentDateTime ?? Date.now()),
            sent: folder === "sentitems",
          });
        }
      }
      return out.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime()).slice(0, limit);
    },
    async sendMessage(token, mail) {
      // sendMail answers 202 with no id, so the id is our own; sync recognises our sent copy by subject, recipients and time.
      await json(fetchImpl, `${base}/sendMail`, token, {
        method: "POST",
        body: JSON.stringify({
          message: {
            subject: mail.subject,
            body: { contentType: "Text", content: mail.body },
            toRecipients: recipients(mail.to),
            ccRecipients: recipients(mail.cc),
            attachments: mail.attachments.map((a) => ({ "@odata.type": "#microsoft.graph.fileAttachment", name: a.name, contentType: a.mimeType, contentBytes: a.content.toString("base64") })),
          },
          saveToSentItems: true,
        }),
      });
      return { externalId: `graph-${randomUUID()}`, internetMessageId: null };
    },
  };
}

export function createMailProvider(provider: OAuthProviderKey, fetchImpl: Fetch = fetch): MailProviderClient {
  return provider === "GOOGLE" ? gmailClient(fetchImpl) : graphClient(fetchImpl);
}
