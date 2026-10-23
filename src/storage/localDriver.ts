import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { signLocalToken } from "./localToken";
import {
  StorageObjectTooLargeError,
  type DownloadSigningOptions,
  type SignedRequest,
  type StorageDriver,
  type UploadSigningOptions,
} from "./types";

const KEY_SHAPE = /^orgs\/[0-9a-f-]{36}\/[a-z]+\/[0-9a-f-]{36}$/i;

export interface LocalDriverOptions {
  /** Directory the objects live under. */
  rootDir: string;
  /** Secret that signs links; never committed, see `src/storage/index.ts`. */
  signingSecret: string;
  /** Public origin of the app, where the blob route lives. */
  baseUrl: string;
  now?: () => Date;
}

/** Development and test driver: objects are files under `rootDir`, links point at `/api/storage/blob`. */
export class LocalDriver implements StorageDriver {
  readonly name = "local" as const;
  private readonly root: string;
  private readonly now: () => Date;

  constructor(private readonly options: LocalDriverOptions) {
    this.root = resolve(options.rootDir);
    this.now = options.now ?? (() => new Date());
  }

  private pathFor(key: string): string {
    // The key shape forbids dots and separators beyond the three fixed ones,
    // so no key can climb out of the root; the prefix check is belt and braces.
    if (!KEY_SHAPE.test(key)) throw new Error("Malformed storage key.");
    const full = resolve(join(this.root, ...key.split("/")));
    if (!full.startsWith(this.root + sep)) throw new Error("Storage key escapes the storage root.");
    return full;
  }

  // The content type is recorded in the file row, not on disk; the parameter keeps the driver interface uniform.
  async putObject(key: string, body: Buffer, _options?: { contentType: string }): Promise<void> {
    void _options;
    const target = this.pathFor(key);
    await mkdir(dirname(target), { recursive: true });
    const temp = `${target}.${randomUUID()}.tmp`;
    await writeFile(temp, body);
    await rename(temp, target);
  }

  async getObject(key: string, maxBytes: number): Promise<Buffer> {
    const target = this.pathFor(key);
    const info = await stat(target);
    if (info.size > maxBytes) throw new StorageObjectTooLargeError(maxBytes);
    return readFile(target);
  }

  async headObject(key: string): Promise<{ size: number } | null> {
    try {
      const info = await stat(this.pathFor(key));
      return { size: info.size };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  private link(token: string): string {
    return `${this.options.baseUrl.replace(/\/$/, "")}/api/storage/blob?token=${encodeURIComponent(token)}`;
  }

  async signUpload(key: string, options: UploadSigningOptions): Promise<SignedRequest> {
    this.pathFor(key);
    const expiresAt = new Date(this.now().getTime() + options.expiresInSeconds * 1000);
    const token = signLocalToken(
      { m: "PUT", k: key, e: Math.floor(expiresAt.getTime() / 1000), ct: options.contentType, mb: options.maxBytes },
      this.options.signingSecret,
    );
    return { url: this.link(token), method: "PUT", headers: { "Content-Type": options.contentType }, expiresAt };
  }

  async signDownload(key: string, options: DownloadSigningOptions): Promise<SignedRequest> {
    this.pathFor(key);
    const expiresAt = new Date(this.now().getTime() + options.expiresInSeconds * 1000);
    const token = signLocalToken(
      {
        m: "GET",
        k: key,
        e: Math.floor(expiresAt.getTime() / 1000),
        fn: options.fileName,
        ct: options.contentType,
        d: options.disposition,
      },
      this.options.signingSecret,
    );
    return { url: this.link(token), method: "GET", headers: {}, expiresAt };
  }
}
