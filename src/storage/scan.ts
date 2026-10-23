import { createConnection } from "node:net";

/**
 * The malware-scan hook (FIG-1023, B1.07). The file service runs the active
 * hook on every upload before the file can be served; an infected verdict
 * quarantines the file.
 *
 * Two implementations ship: a built-in detector for the industry-standard EICAR
 * test string (so the quarantine path is exercisable everywhere, with no
 * antivirus installed) and a ClamAV client that speaks clamd's INSTREAM
 * protocol, switched on by `CLAMD_HOST`. Any provider can implement `ScanHook`.
 */
export type ScanVerdict =
  | { status: "clean" }
  | { status: "infected"; signature: string }
  | { status: "error"; message: string };

export interface ScanHook {
  readonly name: string;
  scan(data: Buffer, meta: { fileName: string; mimeType: string }): Promise<ScanVerdict>;
}

/** The standard antivirus test file: harmless, and every scanner flags it. */
const EICAR = Buffer.from(
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
  "ascii",
);

export const eicarScanner: ScanHook = {
  name: "builtin-eicar",
  async scan(data) {
    return data.includes(EICAR)
      ? { status: "infected", signature: "Eicar-Test-Signature" }
      : { status: "clean" };
  },
};

export interface ClamavOptions {
  host: string;
  port?: number;
  timeoutMs?: number;
}

/** clamd INSTREAM: `zINSTREAM\0`, then length-prefixed chunks, then a zero-length chunk; the reply is `stream: OK` or `stream: <name> FOUND`. */
export function clamavScanner(options: ClamavOptions): ScanHook {
  const port = options.port ?? 3310;
  const timeoutMs = options.timeoutMs ?? 20_000;
  return {
    name: "clamav",
    scan(data) {
      return new Promise<ScanVerdict>((resolve) => {
        const socket = createConnection({ host: options.host, port });
        let reply = "";
        const done = (verdict: ScanVerdict) => {
          socket.destroy();
          resolve(verdict);
        };
        socket.setTimeout(timeoutMs, () => done({ status: "error", message: "clamd timed out" }));
        socket.on("error", (err) => done({ status: "error", message: `clamd: ${err.message}` }));
        socket.on("data", (chunk) => (reply += chunk.toString("utf8")));
        socket.on("end", () => {
          const text = reply.replace(/\0/g, "").trim();
          const found = /^stream:\s+(.+)\s+FOUND$/.exec(text);
          if (found) return done({ status: "infected", signature: found[1]! });
          if (/^stream:\s+OK$/.test(text)) return done({ status: "clean" });
          done({ status: "error", message: `clamd replied: ${text || "nothing"}` });
        });
        socket.on("connect", () => {
          socket.write("zINSTREAM\0");
          const CHUNK = 64 * 1024;
          for (let i = 0; i < data.length; i += CHUNK) {
            const part = data.subarray(i, i + CHUNK);
            const size = Buffer.alloc(4);
            size.writeUInt32BE(part.length);
            socket.write(size);
            socket.write(part);
          }
          socket.write(Buffer.alloc(4));
        });
      });
    },
  };
}

let override: ScanHook | null = null;

/** The active hook: a test override, else ClamAV when `CLAMD_HOST` is set, else the built-in EICAR detector. */
export function getScanHook(env: NodeJS.ProcessEnv = process.env): ScanHook {
  if (override) return override;
  if (env.CLAMD_HOST) {
    return clamavScanner({ host: env.CLAMD_HOST, port: env.CLAMD_PORT ? Number(env.CLAMD_PORT) : undefined });
  }
  return eicarScanner;
}

/** Test hook: replaces (or with `null` clears) the active scan hook. */
export function setScanHookForTests(hook: ScanHook | null) {
  override = hook;
}
