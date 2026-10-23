import {
  StorageObjectTooLargeError,
  type DownloadSigningOptions,
  type SignedRequest,
  type StorageDriver,
  type UploadSigningOptions,
} from "./types";
import { presignUrl, signRequestHeaders, uriEncode, type Credentials } from "./sigv4";

export interface S3DriverOptions {
  /** Endpoint origin, for example `https://s3.eu-west-1.amazonaws.com` or a MinIO/R2 URL. */
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Path-style (`endpoint/bucket/key`) is the default; virtual-hosted style puts the bucket in the host. */
  forcePathStyle?: boolean;
  now?: () => Date;
  fetchImpl?: typeof fetch;
}

/** Production driver for any S3-compatible object store. */
export class S3Driver implements StorageDriver {
  readonly name = "s3" as const;
  private readonly credentials: Credentials;
  private readonly now: () => Date;
  private readonly doFetch: typeof fetch;

  constructor(private readonly options: S3DriverOptions) {
    this.credentials = {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
      region: options.region,
      service: "s3",
    };
    this.now = options.now ?? (() => new Date());
    this.doFetch = options.fetchImpl ?? fetch;
  }

  private objectUrl(key: string): string {
    const endpoint = new URL(this.options.endpoint);
    const encodedKey = uriEncode(key, false);
    if (this.options.forcePathStyle ?? true) {
      return `${endpoint.origin}/${this.options.bucket}/${encodedKey}`;
    }
    return `${endpoint.protocol}//${this.options.bucket}.${endpoint.host}/${encodedKey}`;
  }

  async putObject(key: string, body: Buffer, options: { contentType: string }): Promise<void> {
    const url = this.objectUrl(key);
    const headers = signRequestHeaders({
      method: "PUT",
      url,
      credentials: this.credentials,
      body,
      headers: { "content-type": options.contentType },
      now: this.now(),
    });
    const res = await this.doFetch(url, { method: "PUT", headers, body: new Uint8Array(body) });
    if (!res.ok) throw new Error(`S3 PUT failed with ${res.status}.`);
  }

  async getObject(key: string, maxBytes: number): Promise<Buffer> {
    const url = this.objectUrl(key);
    const headers = signRequestHeaders({ method: "GET", url, credentials: this.credentials, now: this.now() });
    const res = await this.doFetch(url, { method: "GET", headers });
    if (!res.ok) throw new Error(`S3 GET failed with ${res.status}.`);
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > maxBytes) throw new StorageObjectTooLargeError(maxBytes);
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > maxBytes) throw new StorageObjectTooLargeError(maxBytes);
    return data;
  }

  async headObject(key: string): Promise<{ size: number } | null> {
    const url = this.objectUrl(key);
    const headers = signRequestHeaders({ method: "HEAD", url, credentials: this.credentials, now: this.now() });
    const res = await this.doFetch(url, { method: "HEAD", headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`S3 HEAD failed with ${res.status}.`);
    return { size: Number(res.headers.get("content-length") ?? "0") };
  }

  async deleteObject(key: string): Promise<void> {
    const url = this.objectUrl(key);
    const headers = signRequestHeaders({ method: "DELETE", url, credentials: this.credentials, now: this.now() });
    const res = await this.doFetch(url, { method: "DELETE", headers });
    if (!res.ok && res.status !== 404) throw new Error(`S3 DELETE failed with ${res.status}.`);
  }

  async signUpload(key: string, options: UploadSigningOptions): Promise<SignedRequest> {
    const now = this.now();
    const url = presignUrl({
      method: "PUT",
      url: this.objectUrl(key),
      credentials: this.credentials,
      expiresInSeconds: options.expiresInSeconds,
      now,
      signedHeaders: { "content-type": options.contentType },
    });
    return {
      url,
      method: "PUT",
      headers: { "Content-Type": options.contentType },
      expiresAt: new Date(now.getTime() + options.expiresInSeconds * 1000),
    };
  }

  async signDownload(key: string, options: DownloadSigningOptions): Promise<SignedRequest> {
    const now = this.now();
    const safeName = options.fileName.replace(/["\\\r\n]/g, "_");
    const url = presignUrl({
      method: "GET",
      url: this.objectUrl(key),
      credentials: this.credentials,
      expiresInSeconds: options.expiresInSeconds,
      now,
      query: {
        "response-content-disposition": `${options.disposition}; filename*=UTF-8''${encodeURIComponent(safeName)}`,
        "response-content-type": options.contentType,
      },
    });
    return {
      url,
      method: "GET",
      headers: {},
      expiresAt: new Date(now.getTime() + options.expiresInSeconds * 1000),
    };
  }
}
