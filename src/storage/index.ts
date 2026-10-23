import { join } from "node:path";
import { LocalDriver } from "./localDriver";
import { S3Driver } from "./s3Driver";
import type { StorageDriver } from "./types";

/**
 * Chooses the storage driver from the environment, once per process.
 *
 *   STORAGE_DRIVER            `local` or `s3`. Unset means `local` outside
 *                             production; in production it must be set.
 *   STORAGE_LOCAL_DIR         Local driver directory (default `.data/files`).
 *   STORAGE_SIGNING_SECRET    Signs local links. Required in production;
 *                             outside production it falls back to
 *                             DEV_SESSION_SECRET so development needs no setup.
 *   S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY,
 *   S3_FORCE_PATH_STYLE       S3-compatible driver. Keys come from a secret
 *                             manager, never from a committed file.
 */
let cached: StorageDriver | null = null;

export function resolveStorageDriver(env: NodeJS.ProcessEnv = process.env): StorageDriver {
  const production = env.NODE_ENV === "production";
  const chosen = env.STORAGE_DRIVER ?? (production ? undefined : "local");

  if (chosen === "s3") {
    const need = (name: string) => {
      const value = env[name];
      if (!value) throw new Error(`${name} is required when STORAGE_DRIVER=s3.`);
      return value;
    };
    return new S3Driver({
      endpoint: need("S3_ENDPOINT"),
      region: need("S3_REGION"),
      bucket: need("S3_BUCKET"),
      accessKeyId: need("S3_ACCESS_KEY_ID"),
      secretAccessKey: need("S3_SECRET_ACCESS_KEY"),
      forcePathStyle: env.S3_FORCE_PATH_STYLE !== "false",
    });
  }
  if (chosen === "local") {
    const secret = env.STORAGE_SIGNING_SECRET ?? (production ? undefined : env.DEV_SESSION_SECRET);
    if (!secret) throw new Error("STORAGE_SIGNING_SECRET is required for the local storage driver.");
    return new LocalDriver({
      rootDir: env.STORAGE_LOCAL_DIR ?? join(process.cwd(), ".data", "files"),
      signingSecret: secret,
      baseUrl: env.APP_BASE_URL ?? "http://localhost:3000",
    });
  }
  throw new Error(
    production
      ? "STORAGE_DRIVER must be set to `s3` (or `local`) in production."
      : `Unknown STORAGE_DRIVER "${chosen}".`,
  );
}

export function getStorageDriver(): StorageDriver {
  cached ??= resolveStorageDriver();
  return cached;
}

/** Test hook: replaces (or with `null` clears) the process-wide driver. */
export function setStorageDriverForTests(driver: StorageDriver | null) {
  cached = driver;
}

/** The secret the blob route verifies local links with. */
export function localSigningSecret(env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.STORAGE_SIGNING_SECRET ?? (env.NODE_ENV === "production" ? undefined : env.DEV_SESSION_SECRET);
  if (!secret) throw new Error("STORAGE_SIGNING_SECRET is required for the local storage driver.");
  return secret;
}
