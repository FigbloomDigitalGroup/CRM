import { createConnection } from "node:net";
import { describe, expect, it } from "vitest";
import { clamavScanner, eicarScanner, getScanHook } from "../src/storage/scan";

/**
 * FIG-1257 (P1.13): uploads are scanned by a real ClamAV daemon when CLAMD_HOST
 * is set. Start one with `docker compose -f docker-compose.storage.yml up -d --wait clamav`
 * (the first start downloads signatures and takes a few minutes). The daemon
 * tests skip cleanly when it does not answer PING. Override with CLAMD_TEST_HOST / CLAMD_TEST_PORT.
 */
const HOST = process.env.CLAMD_TEST_HOST ?? "127.0.0.1";
const PORT = Number(process.env.CLAMD_TEST_PORT ?? 53310);
const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
const meta = { fileName: "t.txt", mimeType: "text/plain" };

function ping(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: HOST, port: PORT });
    let reply = "";
    const finish = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(2000, () => finish(false));
    socket.on("error", () => finish(false));
    socket.on("data", (c) => (reply += c.toString()));
    socket.on("end", () => finish(reply.includes("PONG")));
    socket.on("connect", () => socket.write("zPING\0"));
  });
}

const up = await ping();

describe.skipIf(!up)("real ClamAV daemon", () => {
  const hook = () => getScanHook({ CLAMD_HOST: HOST, CLAMD_PORT: String(PORT) } as unknown as NodeJS.ProcessEnv);

  it("is the active hook when CLAMD_HOST is set", () => {
    expect(hook().name).toBe("clamav");
  });

  it("flags the EICAR test file, which the quarantine path then acts on", async () => {
    const verdict = await hook().scan(Buffer.from(EICAR), { fileName: "eicar.txt", mimeType: "text/plain" });
    expect(verdict.status).toBe("infected");
    if (verdict.status === "infected") expect(verdict.signature).toMatch(/eicar/i);
  });

  it("flags the standard EICAR file (with its trailing newline) and passes an ordinary or large file", async () => {
    // ClamAV matches EICAR as a whole file, so it is not found when buried in other bytes.
    expect((await hook().scan(Buffer.from(`${EICAR}\n`), meta)).status).toBe("infected");
    expect(await hook().scan(Buffer.from("name,email\nA,a@example.test\n"), meta)).toEqual({ status: "clean" });
    expect(await hook().scan(Buffer.alloc(200_000, 97), meta)).toEqual({ status: "clean" });
  });
});

describe("scan behaviour by configuration", () => {
  it("without CLAMD_HOST only the built-in EICAR detector runs (a documented gap: production must set CLAMD_HOST)", async () => {
    const hook = getScanHook({} as NodeJS.ProcessEnv);
    expect(hook.name).toBe("builtin-eicar");
    expect(hook).toBe(eicarScanner);
    expect((await hook.scan(Buffer.from(EICAR), meta)).status).toBe("infected");
    // Anything else, however malicious, is called clean: this is why a real daemon is a go-live condition.
    expect((await hook.scan(Buffer.from("MZ pretend malware"), meta)).status).toBe("clean");
  });

  it("with CLAMD_HOST set but the daemon unreachable, the verdict is an error, never clean (uploads fail closed with 503)", async () => {
    const verdict = await clamavScanner({ host: "127.0.0.1", port: 1, timeoutMs: 500 }).scan(Buffer.from("hello"), meta);
    expect(verdict.status).toBe("error");
  });
});
