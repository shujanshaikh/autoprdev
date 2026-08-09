import { describe, expect, it, vi } from "vitest";

import {
  fetchGrokModels,
  GROK_DEVICE_CODE_GRANT_TYPE,
  GROK_OAUTH_CLIENT_ID,
  pollGrokDeviceToken,
  refreshGrokTokens,
  requestGrokDeviceCode,
} from "../../src/core/index";

describe("Grok OAuth", () => {
  it("starts the public Grok CLI device flow with subscription scopes", async () => {
    const request = viRequest({
      device_code: "device",
      user_code: "ABCD-EFGH",
      verification_uri: "https://x.ai/device",
      verification_uri_complete: "https://x.ai/device?code=ABCD-EFGH",
      expires_in: 600,
      interval: 5,
    });
    const result = await requestGrokDeviceCode({ fetch: request, referrer: "autopr" });
    const body = new URLSearchParams(String(request.mock.calls[0]?.[1]?.body));

    expect(body.get("client_id")).toBe(GROK_OAUTH_CLIENT_ID);
    expect(body.get("scope")).toContain("grok-cli:access");
    expect(body.get("scope")).toContain("api:access");
    expect(result.verificationUriComplete).toContain("ABCD-EFGH");
  });

  it("distinguishes pending, slowdown, denial, expiry, and success", async () => {
    for (const [error, expected] of [
      ["authorization_pending", { status: "pending", slowDown: false }],
      ["slow_down", { status: "pending", slowDown: true }],
      ["access_denied", { status: "denied" }],
      ["expired_token", { status: "expired" }],
    ] as const) {
      await expect(pollGrokDeviceToken("device", {
        fetch: viRequest({ error }, 400),
      })).resolves.toEqual(expected);
    }

    const request = viRequest({ access_token: "access", refresh_token: "refresh", expires_in: 60 });
    const result = await pollGrokDeviceToken("device", { fetch: request, now: () => 1_000 });
    const body = new URLSearchParams(String(request.mock.calls[0]?.[1]?.body));
    expect(body.get("grant_type")).toBe(GROK_DEVICE_CODE_GRANT_TYPE);
    expect(result).toMatchObject({ status: "success", tokens: { expiresAt: 61_000 } });
  });

  it("keeps a rotating refresh token when xAI omits a replacement", async () => {
    await expect(refreshGrokTokens("refresh-old", {
      fetch: viRequest({ access_token: "access-new", expires_in: 3600 }),
      now: () => 10,
    })).resolves.toMatchObject({ refreshToken: "refresh-old", expiresAt: 3_600_010 });
  });

  it("discovers every model returned for the subscription", async () => {
    await expect(fetchGrokModels("access", {
      fetch: viRequest({ data: [{ id: "grok-4" }, { id: "grok-code-fast-1" }, { id: "grok-4" }] }),
    })).resolves.toEqual(["grok-4", "grok-code-fast-1"]);
  });
});

function viRequest(body: unknown, status = 200) {
  return vi.fn(async () => Response.json(body, { status })) as unknown as typeof fetch & {
    mock: { calls: Parameters<typeof fetch>[] };
  };
}
