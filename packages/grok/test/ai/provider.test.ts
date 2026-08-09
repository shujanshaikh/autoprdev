import { describe, expect, it, vi } from "vitest";

import { createGrokOAuthFetch, createGrokOAuthProvider } from "../../src/ai/index";

describe("Grok OAuth provider", () => {
  it("creates an xAI Responses model", () => {
    const model = createGrokOAuthProvider({ accessToken: () => "access" }).responses("grok-4");
    expect(model.provider).toBe("xai.responses");
    expect(model.modelId).toBe("grok-4");
  });

  it("replaces the SDK bearer while preserving request headers", async () => {
    const requestFetch = vi.fn(async (_input: Parameters<typeof fetch>[0], _init?: RequestInit) =>
      Response.json({ ok: true }));
    const oauthFetch = createGrokOAuthFetch({
      accessToken: async () => "subscription-token",
      fetch: requestFetch as typeof fetch,
      userAgent: "autopr/test",
    });

    await oauthFetch("https://api.x.ai/v1/responses", {
      headers: { Authorization: "Bearer dummy", "x-request-id": "request-1" },
    });

    const headers = new Headers(requestFetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer subscription-token");
    expect(headers.get("user-agent")).toBe("autopr/test");
    expect(headers.get("x-request-id")).toBe("request-1");
  });
});
