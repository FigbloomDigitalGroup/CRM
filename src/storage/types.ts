/**
 * The storage seam (FIG-1023, B1.07). Everything that stores or serves bytes
 * goes through a `StorageDriver`; nothing else in the application touches the
 * disk or an object store. Two drivers exist: local disk for development and
 * tests, and an S3-compatible one for production.
 *
 * A driver knows nothing about organisations, owners or permissions. The file
 * service owns every authorisation decision; the driver only moves bytes for a
 * key the service has already checked belongs to the right organisation.
 */

/** A request the client (or a download link) performs against the storage backend. */
export interface SignedRequest {
  url: string;
  method: "PUT" | "GET";
  /** Headers the client must send for the signature to hold (for example `Content-Type`). */
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface UploadSigningOptions {
  contentType: string;
  expiresInSeconds: number;
  /** The most bytes the backend should accept. Enforced while streaming by the local driver; the file service re-checks after upload for every driver. */
  maxBytes: number;
}

export interface DownloadSigningOptions {
  expiresInSeconds: number;
  /** Name offered to the browser on download. */
  fileName: string;
  contentType: string;
  /** `inline` only for images the app itself displays (avatar, logo). */
  disposition: "inline" | "attachment";
}

export interface StorageDriver {
  readonly name: "local" | "s3";
  putObject(key: string, body: Buffer, options: { contentType: string }): Promise<void>;
  /** Reads an object whole, refusing anything over `maxBytes`. */
  getObject(key: string, maxBytes: number): Promise<Buffer>;
  /** Size in bytes, or `null` when the object does not exist. */
  headObject(key: string): Promise<{ size: number } | null>;
  /** Deleting a missing object is not an error. */
  deleteObject(key: string): Promise<void>;
  signUpload(key: string, options: UploadSigningOptions): Promise<SignedRequest>;
  signDownload(key: string, options: DownloadSigningOptions): Promise<SignedRequest>;
}

export class StorageObjectTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Object is larger than ${maxBytes} bytes.`);
    this.name = "StorageObjectTooLargeError";
  }
}
