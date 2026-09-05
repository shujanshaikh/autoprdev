#!/usr/bin/env node

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { closeSync, linkSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, request as createUpstreamRequest } from "node:http";
import { connect as connectSocket } from "node:net";
import { dirname } from "node:path";

const gatewayPort = Number.parseInt(process.env.AUTOPR_PREVIEW_GATEWAY_PORT ?? "6090", 10);
const secretFile = process.env.AUTOPR_PREVIEW_SECRET_FILE ?? "/home/autopr/.autopr/preview-secret";
const routePattern = /^\/v1\/(\d+)\/(\d+)\/([A-Za-z0-9_-]{43})(\/.*)?$/;

function previewSecret() {
  mkdirSync(dirname(secretFile), { recursive: true, mode: 0o700 });
  try {
    return readFileSync(secretFile, "utf8").trim();
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const temporaryFile = `${secretFile}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  const descriptor = openSync(temporaryFile, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${randomBytes(32).toString("hex")}\n`);
  } finally {
    closeSync(descriptor);
  }

  try {
    // Hard-linking a completed candidate publishes the first secret atomically
    // without allowing a concurrent starter to replace it.
    linkSync(temporaryFile, secretFile);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  } finally {
    unlinkSync(temporaryFile);
  }
  return readFileSync(secretFile, "utf8").trim();
}

const secret = previewSecret();
if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error("Invalid E2B preview gateway secret.");

function authorize(requestUrl) {
  let url;
  try {
    url = new URL(requestUrl ?? "/", "http://preview.local");
  } catch {
    return undefined;
  }
  const match = routePattern.exec(url.pathname);
  if (!match) return undefined;

  const expiresAt = Number.parseInt(match[1], 10);
  const targetPort = Number.parseInt(match[2], 10);
  if (
    !Number.isSafeInteger(expiresAt)
    || expiresAt < Math.floor(Date.now() / 1_000)
    || !Number.isInteger(targetPort)
    || targetPort < 1
    || targetPort > 65_535
    || targetPort === gatewayPort
  ) {
    return undefined;
  }

  const supplied = Buffer.from(match[3], "base64url");
  const expected = createHmac("sha256", secret)
    .update(`${expiresAt}:${targetPort}`)
    .digest();
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return undefined;

  return {
    port: targetPort,
    path: `${match[4] ?? "/"}${url.search}`,
  };
}

function reject(response) {
  response.writeHead(401, {
    "Cache-Control": "no-store",
    "Content-Type": "text/plain; charset=utf-8",
  });
  response.end("Preview URL is invalid or expired.\n");
}

const server = createServer((incoming, outgoing) => {
  const target = authorize(incoming.url);
  if (!target) {
    reject(outgoing);
    return;
  }

  const headers = { ...incoming.headers, host: `127.0.0.1:${target.port}` };
  const upstream = createUpstreamRequest({
    host: "127.0.0.1",
    port: target.port,
    method: incoming.method,
    path: target.path,
    headers,
  }, (response) => {
    outgoing.writeHead(response.statusCode ?? 502, response.headers);
    response.pipe(outgoing);
  });
  upstream.on("error", () => {
    if (!outgoing.headersSent) outgoing.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    outgoing.end("Preview service is unavailable.\n");
  });
  incoming.on("aborted", () => upstream.destroy());
  outgoing.on("close", () => upstream.destroy());
  incoming.pipe(upstream);
});

server.on("upgrade", (request, client, head) => {
  const target = authorize(request.url);
  if (!target) {
    client.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    return;
  }

  const upstream = connectSocket(target.port, "127.0.0.1");
  client.on("error", () => upstream.destroy());
  client.on("close", () => upstream.destroy());
  upstream.on("close", () => client.destroy());
  upstream.once("connect", () => {
    const headers = [];
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      const name = request.rawHeaders[index];
      if (name?.toLowerCase() !== "host") headers.push(`${name}: ${request.rawHeaders[index + 1] ?? ""}`);
    }
    headers.push(`Host: 127.0.0.1:${target.port}`);
    upstream.write(`${request.method ?? "GET"} ${target.path} HTTP/${request.httpVersion}\r\n${headers.join("\r\n")}\r\n\r\n`);
    if (head.length > 0) upstream.write(head);
    client.pipe(upstream).pipe(client);
  });
  upstream.once("error", () => {
    if (!client.destroyed) client.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
  });
});

server.listen(gatewayPort, "0.0.0.0");
