/**
 * The AWS server's own role credentials, for the S3 driver when no fixed key is configured (Figbloom's AWS production:
 * the account's guard rails forbid IAM users, so there are no long-lived keys). Read from the EC2 instance metadata
 * service, IMDSv2 only (a session token first), and kept until an hour before they expire, so a presigned link made
 * now still works for as long as it says. AWS rotates these credentials itself.
 *
 * In a Docker container the metadata service must answer one network hop further (the server's metadata hop limit
 * is 2 for this reason).
 */

const IMDS = "http://169.254.169.254";
const TIMEOUT_MS = 2_000;
const REFRESH_BEFORE_MS = 60 * 60 * 1000;

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export type CredentialsProvider = () => Promise<AwsCredentials>;

async function send(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`instance metadata answered ${res.status}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/** A provider that reads (and caches) the server role's credentials. */
export function instanceRoleCredentials(fetchImpl: typeof fetch = fetch, now: () => number = Date.now): CredentialsProvider {
  let cached: { credentials: AwsCredentials; expiresAt: number } | null = null;
  let pending: Promise<AwsCredentials> | null = null;

  async function load(): Promise<AwsCredentials> {
    try {
      const token = await (
        await send(fetchImpl, `${IMDS}/latest/api/token`, {
          method: "PUT",
          headers: { "X-aws-ec2-metadata-token-ttl-seconds": "300" },
        })
      ).text();
      const headers = { "X-aws-ec2-metadata-token": token };
      const role = (await (await send(fetchImpl, `${IMDS}/latest/meta-data/iam/security-credentials/`, { headers })).text())
        .split("\n")[0]
        .trim();
      if (!role) throw new Error("the server has no role");
      const data = (await (
        await send(fetchImpl, `${IMDS}/latest/meta-data/iam/security-credentials/${encodeURIComponent(role)}`, { headers })
      ).json()) as { AccessKeyId?: string; SecretAccessKey?: string; Token?: string; Expiration?: string };
      if (!data.AccessKeyId || !data.SecretAccessKey || !data.Token || !data.Expiration) {
        throw new Error("incomplete credentials");
      }
      const credentials = { accessKeyId: data.AccessKeyId, secretAccessKey: data.SecretAccessKey, sessionToken: data.Token };
      cached = { credentials, expiresAt: Date.parse(data.Expiration) };
      return credentials;
    } catch (err) {
      // never a credential in the message
      throw new Error(`The server's AWS credentials could not be read (${err instanceof Error ? err.message : "unknown"}).`);
    }
  }

  return async () => {
    if (cached && now() < cached.expiresAt - REFRESH_BEFORE_MS) return cached.credentials;
    pending ??= load().finally(() => {
      pending = null;
    });
    return pending;
  };
}
