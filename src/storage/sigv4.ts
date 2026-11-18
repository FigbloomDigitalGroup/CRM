import { createHash, createHmac } from "node:crypto";

/**
 * AWS Signature Version 4, just enough for S3-compatible object stores
 * (presigned URLs and header-signed server calls). Written against the AWS
 * documentation and checked against AWS's own published example in
 * tests/storage.test.ts, so no SDK dependency is needed.
 */

const sha256Hex = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();

/** RFC 3986 percent-encoding as SigV4 wants it (unreserved characters only). */
export function uriEncode(value: string, encodeSlash = true): string {
  let out = "";
  for (const byte of Buffer.from(value, "utf8")) {
    const ch = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-._~]/.test(ch)) out += ch;
    else if (ch === "/" && !encodeSlash) out += "/";
    else out += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

export interface Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service?: string;
}

/** `20130524T000000Z` and `20130524`. */
export function amzDates(now: Date): { amzDate: string; dateStamp: string } {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

function signingKey(credentials: Credentials, dateStamp: string): Buffer {
  const kDate = hmac("AWS4" + credentials.secretAccessKey, dateStamp);
  const kRegion = hmac(kDate, credentials.region);
  const kService = hmac(kRegion, credentials.service ?? "s3");
  return hmac(kService, "aws4_request");
}

function canonicalQuery(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

export interface PresignInput {
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  /** Absolute URL of the object, without a query string. */
  url: string;
  credentials: Credentials;
  expiresInSeconds: number;
  now?: Date;
  /** Headers the client must send, signed into the URL (lower-case names). `host` is added automatically. */
  signedHeaders?: Record<string, string>;
  /** Extra query parameters to sign, such as `response-content-disposition`. */
  query?: Record<string, string>;
}

/** A presigned URL: the signature travels in the query string. */
export function presignUrl(input: PresignInput): string {
  const { credentials } = input;
  const url = new URL(input.url);
  const { amzDate, dateStamp } = amzDates(input.now ?? new Date());
  const scope = `${dateStamp}/${credentials.region}/${credentials.service ?? "s3"}/aws4_request`;

  const headers: Record<string, string> = { host: url.host };
  for (const [k, v] of Object.entries(input.signedHeaders ?? {})) headers[k.toLowerCase()] = v.trim();
  const headerNames = Object.keys(headers).sort();

  const query: Record<string, string> = {
    ...(input.query ?? {}),
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${credentials.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(input.expiresInSeconds),
    "X-Amz-SignedHeaders": headerNames.join(";"),
  };

  const canonicalRequest = [
    input.method,
    uriEncode(decodeURIComponent(url.pathname), false),
    canonicalQuery(query),
    headerNames.map((h) => `${h}:${headers[h]}\n`).join(""),
    headerNames.join(";"),
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const signature = createHmac("sha256", signingKey(credentials, dateStamp)).update(stringToSign).digest("hex");

  return `${url.origin}${url.pathname}?${canonicalQuery(query)}&X-Amz-Signature=${signature}`;
}

export interface HeaderSignInput {
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  url: string;
  credentials: Credentials;
  body?: Buffer;
  headers?: Record<string, string>;
  now?: Date;
}

/** Headers for a server-side request signed with the `Authorization` header. */
export function signRequestHeaders(input: HeaderSignInput): Record<string, string> {
  const { credentials } = input;
  const url = new URL(input.url);
  const { amzDate, dateStamp } = amzDates(input.now ?? new Date());
  const scope = `${dateStamp}/${credentials.region}/${credentials.service ?? "s3"}/aws4_request`;
  const payloadHash = sha256Hex(input.body ?? "");

  const headers: Record<string, string> = {
    ...Object.fromEntries(Object.entries(input.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v.trim()])),
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  const headerNames = Object.keys(headers).sort();
  const query: Record<string, string> = {};
  url.searchParams.forEach((v, k) => (query[k] = v));

  const canonicalRequest = [
    input.method,
    uriEncode(decodeURIComponent(url.pathname), false),
    canonicalQuery(query),
    headerNames.map((h) => `${h}:${headers[h]}\n`).join(""),
    headerNames.join(";"),
    payloadHash,
  ].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const signature = createHmac("sha256", signingKey(credentials, dateStamp)).update(stringToSign).digest("hex");

  const { host: _host, ...rest } = headers;
  void _host;
  return {
    ...rest,
    authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${headerNames.join(";")}, Signature=${signature}`,
  };
}
