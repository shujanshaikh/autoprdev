import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const infrastructure = new URL("../../../../infra/e2b/autopr/", import.meta.url);

async function listen(server: ReturnType<typeof createServer>) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No local test port");
  return address.port;
}

describe("E2B preview gateway", () => {
  let directory: string;
  let gateway: ChildProcess;
  let gatewayUrl: string;
  let targetPort: number;
  let secret: string;
  const upstream = createServer((request, response) => response.end(`upstream:${request.url}`));

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "autopr-e2b-preview-"));
    targetPort = await listen(upstream);
    const reservation = createServer();
    const gatewayPort = await listen(reservation);
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    gatewayUrl = `http://127.0.0.1:${gatewayPort}`;
    const secretFile = join(directory, "preview-secret");
    gateway = spawn(process.execPath, [fileURLToPath(new URL("preview-gateway.mjs", infrastructure))], {
      env: { ...process.env, AUTOPR_PREVIEW_GATEWAY_PORT: String(gatewayPort), AUTOPR_PREVIEW_SECRET_FILE: secretFile },
      stdio: "ignore",
    });
    await vi.waitFor(async () => expect((await fetch(gatewayUrl)).status).toBe(401));
    secret = (await readFile(secretFile, "utf8")).trim();
  });

  afterAll(async () => {
    if (gateway && gateway.exitCode === null && gateway.signalCode === null) {
      gateway.kill();
      await once(gateway, "exit");
    }
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });

  function signedPath(expiresAt = Math.floor(Date.now() / 1_000) + 60) {
    const signature = createHmac("sha256", secret).update(`${expiresAt}:${targetPort}`).digest("base64url");
    return `/v1/${expiresAt}/${targetPort}/${signature}`;
  }

  it("forwards signed paths and query parameters", async () => {
    const response = await fetch(`${gatewayUrl}${signedPath()}/health?probe=yes`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("upstream:/health?probe=yes");
  });

  it("rejects expired and altered signatures", async () => {
    expect((await fetch(`${gatewayUrl}${signedPath(1)}/`)).status).toBe(401);
    expect((await fetch(`${gatewayUrl}${signedPath().slice(0, -1)}!/`)).status).toBe(401);
  });

  it("rejects malformed URLs without crashing the gateway", async () => {
    expect((await fetch(`${gatewayUrl}//[`)).status).toBe(401);
    expect((await fetch(`${gatewayUrl}${signedPath()}/`)).status).toBe(200);
  });
});

it("starts template desktop services without snapshotting a preview signing secret", async () => {
  const directory = await mkdtemp(join(tmpdir(), "autopr-e2b-template-"));
  try {
    const source = await readFile(new URL("autopr-desktop", infrastructure), "utf8");
    const dispatch = 'case "${1:-}" in';
    const script = source
      .replace("STATE_DIR=/tmp/autopr-e2b-desktop", `STATE_DIR='${directory}'`)
      .replace(dispatch, `start_one() { printf '%s\\n' "$1"; }\n${dispatch}`);
    const output = execFileSync("bash", ["-c", script, "autopr-desktop", "start-core"], {
      env: { ...process.env, XDG_RUNTIME_DIR: join(directory, "runtime") },
      encoding: "utf8",
    });
    expect(output.trim().split("\n")).toEqual(["xvfb", "xfce4", "x11vnc", "novnc"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
