import { type JsonObject } from "@autopr/config/runtime-value";
import { describe, expect, test } from "vitest";
import { createChatGPTHandler, type RealtimeBridgeEvent } from "../../src/server/index.ts";
import { createMockFetch, createOpenAIMock, jsonResponse, makeAccessToken, makeIdToken, makeJwt } from "./helpers.ts";

const BASE = "https://app.dev/api/chatgpt";

/** Extracts the session cookie name=value pair from a response for reuse. */
function cookieFrom(response: Response): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  return setCookie.split(";")[0] ?? "";
}

describe("createChatGPTHandler", () => {
  test("runs the full login → status → session → logout lifecycle", async () => {
    let clock = 1000;
    const handler = createChatGPTHandler({
      fetch: createOpenAIMock({ pollsUntilAuthorized: 1 }),
      secret: "test-secret",
      now: () => clock,
    });

    // 1. Start login.
    const login = await handler.handler(new Request(`${BASE}/login`, { method: "POST" }));
    expect(login.status).toBe(200);
    const loginBody = (await login.json()) satisfies { status: string; userCode: string; verificationUrl: string };
    expect(loginBody.status).toBe("pending");
    expect(loginBody.userCode).toBe("ABCD-1234");
    expect(loginBody.verificationUrl).toBe("https://auth.openai.com/codex/device");
    const cookie = cookieFrom(login);
    expect(cookie).toContain("lwc_session=");

    // 2. Poll status until authenticated.
    clock += 2000;
    const status = await handler.handler(
      new Request(`${BASE}/status`, { headers: { cookie } }),
    );
    const statusBody = (await status.json()) satisfies { status: string; user?: { email?: string } };
    expect(statusBody.status).toBe("authenticated");
    expect(statusBody.user?.email).toBe("savio@result.dev");

    // 3. Session reflects the authenticated user without polling.
    const session = await handler.handler(new Request(`${BASE}/session`, { headers: { cookie } }));
    expect(((await session.json()) satisfies { status: string }).status).toBe("authenticated");

    // 4. Logout clears the session.
    const logout = await handler.handler(new Request(`${BASE}/logout`, { method: "POST", headers: { cookie } }));
    expect(((await logout.json()) satisfies { status: string }).status).toBe("unauthenticated");
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  test("proxies /responses for an authenticated session and streams", async () => {
    let clock = 1000;
    const handler = createChatGPTHandler({
      fetch: createOpenAIMock({ pollsUntilAuthorized: 1 }),
      secret: "test-secret",
      now: () => clock,
    });

    const login = await handler.handler(new Request(`${BASE}/login`, { method: "POST" }));
    const cookie = cookieFrom(login);
    clock += 2000;
    await handler.handler(new Request(`${BASE}/status`, { headers: { cookie } }));

    const responses = await handler.handler(
      new Request(`${BASE}/responses`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ input: "Tell me a joke?" }),
      }),
    );
    expect(responses.status).toBe(200);
    expect(responses.headers.get("content-type")).toContain("text/event-stream");
    expect(await responses.text()).toContain("response.output_text.delta");
  });

  test("exchanges Realtime SDP without exposing ChatGPT tokens", async () => {
    let clock = 1000;
    const fetch = createOpenAIMock({ pollsUntilAuthorized: 1 });
    const handler = createChatGPTHandler({
      fetch,
      secret: "test-secret",
      now: () => clock,
      realtime: {
        allowedModes: ["wingman"],
        getAuth: () => ({ accessToken: "web-access-secret", accountId: "acct_123" }),
      },
    });
    const login = await handler.handler(new Request(`${BASE}/login`, { method: "POST" }));
    const cookie = cookieFrom(login);
    clock += 2000;
    await handler.handler(new Request(`${BASE}/status`, { headers: { cookie } }));

    const realtime = await handler.handler(new Request(`${BASE}/realtime`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        sdp: "v=0\r\no=- browser-offer",
        session: {
          voice: "juniper",
          transport: "wm",
          voiceMode: "wingman",
        },
      }),
    }));
    expect(realtime.status).toBe(201);
    expect(realtime.headers.get("content-type")).toContain("application/sdp");
    expect(await realtime.text()).toMatch(/^v=0/);

    const call = fetch.calls.find((entry) => new URL(entry.url).pathname === "/realtime/wm");
    expect(call).toBeDefined();
    const headers = new Headers(call?.init?.headers);
    expect(headers.get("authorization")).toMatch(/^Bearer /);
    const form = /* SAFETY: This request fixture always sends the realtime payload as FormData. */ call?.init?.body as FormData;
    expect(JSON.parse(String(form.get("session")))).toMatchObject({
      voice: "juniper",
      voice_mode: "wingman",
      history_and_training_disabled: false,
      client_tools: [],
      backend_reasoning_effort: "high",
      chat_mode: "chat",
      enable_message_streaming: true,
    });

    const compatibility = await handler.handler(new Request(`${BASE}/realtime`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        sdp: "v=0\r\no=- browser-offer",
        session: { transport: "vp", voiceMode: "advanced", model: "explicit-model" },
      }),
    }));
    expect(compatibility.status).toBe(403);
    expect(await compatibility.json()).toMatchObject({
      error: "realtime_transport_not_allowed",
      transport: "vp",
    });

    const invalidSession = await handler.handler(new Request(`${BASE}/realtime`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ sdp: "v=0\r\no=- browser-offer", session: { voice: 4 } }),
    }));
    expect(invalidSession.status).toBe(400);
    expect(await invalidSession.json()).toMatchObject({ error: "invalid_realtime_request" });
  });

  test("refuses to reuse Codex login tokens for the GPT Live /wm transport", async () => {
    let clock = 1000;
    const handler = createChatGPTHandler({
      fetch: createOpenAIMock({ pollsUntilAuthorized: 1 }),
      secret: "test-secret",
      now: () => clock,
    });
    const login = await handler.handler(new Request(`${BASE}/login`, { method: "POST" }));
    const cookie = cookieFrom(login);
    clock += 2000;
    await handler.handler(new Request(`${BASE}/status`, { headers: { cookie } }));

    const realtime = await handler.handler(new Request(`${BASE}/realtime`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ sdp: "v=0\r\no=- browser-offer" }),
    }));
    expect(realtime.status).toBe(501);
    expect(await realtime.json()).toMatchObject({ error: "realtime_web_auth_required" });
  });

  test("runs app-server Realtime tools, events, confirmation, and cleanup end to end", async () => {
    let clock = 1000;
    let sessionOptions: any;
    let startOptions: any;
    let executeContext: any;
    let confirmationContext: any;
    let closed = false;
    const listeners = new Set<(event: any) => void>();
    const fakeSession = {
      id: "live_session_123",
      start: async (options: any) => {
        startOptions = options;
        for (const listener of listeners) listener({ type: "session.started" });
        return "v=0\r\no=- app-server-answer";
      },
      onEvent: (listener: (event: any) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      resolveConfirmation: async <ConfirmationValue>(callId: string, confirmation: ConfirmationValue) => {
        return await sessionOptions.confirmTool({
          callId,
          name: "create_record",
          arguments: { title: "Review me" },
          confirmation,
          pending: {
            output: { status: "pending_confirmation" },
            pendingConfirmation: { review: { title: "Review me" } },
          },
        });
      },
      close: async () => {
        closed = true;
        for (const listener of listeners) listener({ type: "session.closed" });
      },
    };
    const handler = createChatGPTHandler({
      fetch: createOpenAIMock({ pollsUntilAuthorized: 1 }),
      secret: "test-secret",
      now: () => clock,
      realtime: {
        appServer: {
          tools: [{
            type: "function",
            name: "create_record",
            description: "Create a reviewable record.",
            inputSchema: { type: "object" },
          }],
          allowedModels: ["gpt-5.6-luna"],
          executeTool: async (context) => {
            executeContext = context;
            return { output: { status: "completed" } };
          },
          confirmTool: async (context) => {
            confirmationContext = context;
            return { output: { status: "confirmed" }, speech: "Confirmed." };
          },
          sessionFactory: (options) => {
            sessionOptions = options;
            return fakeSession;
          },
        },
      },
    });
    const login = await handler.handler(new Request(`${BASE}/login`, { method: "POST" }));
    const cookie = cookieFrom(login);
    clock += 2000;
    await handler.handler(new Request(`${BASE}/status`, { headers: { cookie } }));

    const unsupportedSession = await handler.handler(new Request(`${BASE}/realtime/app-server`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        sdp: "v=0\r\no=- browser-offer",
        session: { language: "en-US" },
      }),
    }));
    expect(unsupportedSession.status).toBe(400);
    expect(sessionOptions).toBeUndefined();

    const started = await handler.handler(new Request(`${BASE}/realtime/app-server`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        sdp: "v=0\r\no=- browser-offer",
        session: { voice: "vale", model: "gpt-5.6-luna" },
      }),
    }));
    expect(started.status).toBe(201);
    expect(await started.json()).toEqual({
      sessionId: "live_session_123",
      sdp: "v=0\r\no=- app-server-answer",
    });
    expect(startOptions).toMatchObject({
      voice: "vale",
      model: "gpt-5.6-luna",
    });

    await sessionOptions.executeTool({
      callId: "call_1",
      name: "create_record",
      arguments: { title: "Review me" },
    });
    expect(executeContext).toMatchObject({
      callId: "call_1",
      name: "create_record",
      liveSessionId: "live_session_123",
    });
    expect(executeContext.loginSessionId).toEqual(expect.any(String));
    expect(executeContext.request.headers.get("cookie")).toBe(cookie);

    // Events emitted before the browser subscribes must be queued, not lost.
    for (const listener of listeners) {
      listener({
        type: "tool.pending_confirmation",
        callId: "call_1",
        name: "create_record",
        review: { title: "Review me" },
      });
    }
    const events = await handler.handler(
      new Request(`${BASE}/realtime/app-server/live_session_123/events`, {
        headers: { cookie },
      }),
    );
    expect(events.status).toBe(200);
    expect(events.headers.get("content-type")).toContain("application/x-ndjson");
    const reader = events.body!.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    while (!buffered.includes('"type":"tool.pending_confirmation"')) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
    }
    expect(buffered).toContain('"type":"session.started"');
    expect(buffered).toContain('"type":"tool.pending_confirmation"');
    await reader.cancel();

    const confirmed = await handler.handler(
      new Request(`${BASE}/realtime/app-server/live_session_123/confirm`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          callId: "call_1",
          confirmation: { approved: true },
        }),
      }),
    );
    expect(confirmed.status).toBe(200);
    expect(confirmationContext).toMatchObject({
      callId: "call_1",
      confirmation: { approved: true },
      liveSessionId: "live_session_123",
    });

    const removed = await handler.handler(
      new Request(`${BASE}/realtime/app-server/live_session_123`, {
        method: "DELETE",
        headers: { cookie },
      }),
    );
    expect(removed.status).toBe(200);
    expect(closed).toBe(true);
  });

  test("serializes concurrent app-server starts for one login session", async () => {
    let clock = 1000;
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const created: Array<{ id: string; closed: boolean }> = [];
    const handler = createChatGPTHandler({
      fetch: createOpenAIMock({ pollsUntilAuthorized: 1 }),
      secret: "test-secret",
      now: () => clock,
      realtime: {
        appServer: {
          tools: [],
          executeTool: async () => ({ output: {} }),
          sessionFactory: () => {
            const state = { id: `live_${created.length + 1}`, closed: false };
            created.push(state);
            return {
              id: state.id,
              start: async () => {
                if (state.id === "live_1") {
                  markFirstStarted();
                  await firstGate;
                }
                return "v=0\r\no=- app-server-answer";
              },
              onEvent: () => () => {},
              resolveConfirmation: async () => ({ output: {} }),
              close: async () => { state.closed = true; },
            };
          },
        },
      },
    });
    const login = await handler.handler(new Request(`${BASE}/login`, { method: "POST" }));
    const cookie = cookieFrom(login);
    clock += 2000;
    await handler.handler(new Request(`${BASE}/status`, { headers: { cookie } }));
    const start = () => handler.handler(new Request(`${BASE}/realtime/app-server`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ sdp: "v=0\r\no=- browser-offer" }),
    }));

    const first = start();
    await firstStarted;
    const second = start();
    await Promise.resolve();
    expect(created).toHaveLength(1);

    releaseFirst();
    expect((await first).status).toBe(201);
    expect((await second).status).toBe(201);
    expect(created).toHaveLength(2);
    expect(created[0]?.closed).toBe(true);
    await handler.handler(new Request(`${BASE}/logout`, { method: "POST", headers: { cookie } }));
    expect(created[1]?.closed).toBe(true);
  });

  test("does not publish an app-server session that closed during startup", async () => {
    let clock = 1000;
    const listeners = new Set<(event: RealtimeBridgeEvent) => void>();
    const handler = createChatGPTHandler({
      fetch: createOpenAIMock({ pollsUntilAuthorized: 1 }),
      secret: "test-secret",
      now: () => clock,
      realtime: {
        appServer: {
          tools: [],
          executeTool: async () => ({ output: {} }),
          sessionFactory: () => ({
            id: "closed_during_start",
            start: async () => {
              for (const listener of listeners) listener({ type: "session.closed" });
              return "v=0\r\no=- stale-answer";
            },
            onEvent: (listener) => {
              listeners.add(listener);
              return () => { listeners.delete(listener); };
            },
            resolveConfirmation: async () => ({ output: {} }),
            close: async () => {},
          }),
        },
      },
    });
    const login = await handler.handler(new Request(`${BASE}/login`, { method: "POST" }));
    const cookie = cookieFrom(login);
    clock += 2000;
    await handler.handler(new Request(`${BASE}/status`, { headers: { cookie } }));

    const response = await handler.handler(new Request(`${BASE}/realtime/app-server`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ sdp: "v=0\r\no=- browser-offer" }),
    }));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: "realtime_app_server_start_failed" });
  });

  test("enforces responses proxy model allowlist", async () => {
    let clock = 1000;
    const handler = createChatGPTHandler({
      fetch: createOpenAIMock({ pollsUntilAuthorized: 1 }),
      secret: "test-secret",
      now: () => clock,
      responsesProxy: { allowedModels: ["gpt-allowed"] },
    });

    const login = await handler.handler(new Request(`${BASE}/login`, { method: "POST" }));
    const cookie = cookieFrom(login);
    clock += 2000;
    await handler.handler(new Request(`${BASE}/status`, { headers: { cookie } }));

    const disallowed = await handler.handler(
      new Request(`${BASE}/responses`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ model: "gpt-other", input: "hi" }),
      }),
    );
    expect(disallowed.status).toBe(403);
    expect(await disallowed.json()).toEqual({ error: "model_not_allowed", model: "gpt-other" });

    const allowed = await handler.handler(
      new Request(`${BASE}/responses`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ model: "gpt-allowed", input: "hi" }),
      }),
    );
    expect(allowed.status).toBe(200);
  });

  test("enforces responses proxy request body limit", async () => {
    let clock = 1000;
    const handler = createChatGPTHandler({
      fetch: createOpenAIMock({ pollsUntilAuthorized: 1 }),
      secret: "test-secret",
      now: () => clock,
      responsesProxy: { maxRequestBytes: 20 },
    });

    const login = await handler.handler(new Request(`${BASE}/login`, { method: "POST" }));
    const cookie = cookieFrom(login);
    clock += 2000;
    await handler.handler(new Request(`${BASE}/status`, { headers: { cookie } }));

    const tooLarge = await handler.handler(
      new Request(`${BASE}/responses`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ input: "this body is too large" }),
      }),
    );
    expect(tooLarge.status).toBe(413);
    expect(await tooLarge.json()).toEqual({ error: "responses_request_too_large", maxRequestBytes: 20 });
  });

  test("passes validated Codex service tier through the responses proxy", async () => {
    let responseBody: JsonObject | undefined;
    const fetch = createMockFetch((url, init) => {
      if (url.endsWith("/deviceauth/usercode")) {
        return jsonResponse({ device_auth_id: "dev_1", user_code: "ABCD-1234", interval: "1" });
      }
      if (url.endsWith("/deviceauth/token")) {
        return jsonResponse({ authorization_code: "ac", code_challenge: "c", code_verifier: "v" });
      }
      if (url.endsWith("/oauth/token")) {
        return jsonResponse({
          access_token: makeAccessToken(3600),
          refresh_token: "rt",
          id_token: makeIdToken({ accountId: "acct_1", email: "savio@result.dev", plan: "pro" }),
        });
      }
      if (new URL(url).pathname.endsWith("/responses")) {
        responseBody = JSON.parse(String(init?.body));
        return new Response('data: {"type":"response.output_text.delta","delta":"hi"}\n\n', {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    let clock = 1000;
    const handler = createChatGPTHandler({ fetch, secret: "test-secret", now: () => clock });

    const login = await handler.handler(new Request(`${BASE}/login`, { method: "POST" }));
    const cookie = cookieFrom(login);
    clock += 2000;
    await handler.handler(new Request(`${BASE}/status`, { headers: { cookie } }));

    const responses = await handler.handler(
      new Request(`${BASE}/responses`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          "x-login-with-chatgpt-service-tier": "fast",
          "x-login-with-chatgpt-reasoning-effort": "high",
        },
        body: JSON.stringify({ model: "gpt-5.5", input: "hi" }),
      }),
    );

    expect(responses.status).toBe(200);
    expect(responseBody?.service_tier).toBe("fast");
    expect(responseBody?.reasoning).toMatchObject({ effort: "high" });

    const invalid = await handler.handler(
      new Request(`${BASE}/responses`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          "x-login-with-chatgpt-service-tier": "warp",
        },
        body: JSON.stringify({ model: "gpt-5.5", input: "hi" }),
      }),
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "invalid_service_tier", serviceTier: "warp" });

    const invalidReasoning = await handler.handler(
      new Request(`${BASE}/responses`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          "x-login-with-chatgpt-reasoning-effort": "galaxy",
        },
        body: JSON.stringify({ model: "gpt-5.5", input: "hi" }),
      }),
    );
    expect(invalidReasoning.status).toBe(400);
    expect(await invalidReasoning.json()).toEqual({ error: "invalid_reasoning_effort", reasoningEffort: "galaxy" });
  });

  test("falls back when upstream rejects Codex fast service tier", async () => {
    const responseBodies: Array<JsonObject> = [];
    const fetch = createMockFetch((url, init) => {
      if (url.endsWith("/deviceauth/usercode")) {
        return jsonResponse({ device_auth_id: "dev_1", user_code: "ABCD-1234", interval: "1" });
      }
      if (url.endsWith("/deviceauth/token")) {
        return jsonResponse({ authorization_code: "ac", code_challenge: "c", code_verifier: "v" });
      }
      if (url.endsWith("/oauth/token")) {
        return jsonResponse({
          access_token: makeAccessToken(3600),
          refresh_token: "rt",
          id_token: makeIdToken({ accountId: "acct_1", email: "savio@result.dev", plan: "pro" }),
        });
      }
      if (new URL(url).pathname.endsWith("/responses")) {
        const body = JSON.parse(String(init?.body));
        responseBodies.push(body);
        if (body.service_tier === "fast") {
          return jsonResponse({ detail: "Unsupported service_tier: fast" }, 400);
        }
        return new Response('data: {"type":"response.output_text.delta","delta":"hi"}\n\n', {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    let clock = 1000;
    const handler = createChatGPTHandler({ fetch, secret: "test-secret", now: () => clock });

    const login = await handler.handler(new Request(`${BASE}/login`, { method: "POST" }));
    const cookie = cookieFrom(login);
    clock += 2000;
    await handler.handler(new Request(`${BASE}/status`, { headers: { cookie } }));

    const responses = await handler.handler(
      new Request(`${BASE}/responses`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/json",
          "x-login-with-chatgpt-service-tier": "fast",
        },
        body: JSON.stringify({ model: "gpt-5.5", input: "hi" }),
      }),
    );

    expect(responses.status).toBe(200);
    expect(responses.headers.get("x-login-with-chatgpt-service-tier-fallback")).toBe("auto");
    expect(responseBodies).toHaveLength(2);
    expect(responseBodies[0]?.service_tier).toBe("fast");
    expect(responseBodies[1]?.service_tier).toBeUndefined();
  });

  test("rejects invalid /responses bodies before proxying", async () => {
    let clock = 1000;
    const handler = createChatGPTHandler({
      fetch: createOpenAIMock({ pollsUntilAuthorized: 1 }),
      secret: "test-secret",
      now: () => clock,
    });

    const login = await handler.handler(new Request(`${BASE}/login`, { method: "POST" }));
    const cookie = cookieFrom(login);
    clock += 2000;
    await handler.handler(new Request(`${BASE}/status`, { headers: { cookie } }));

    const invalid = await handler.handler(
      new Request(`${BASE}/responses`, {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: "nope",
      }),
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      error: "invalid_responses_request",
      message: "Expected a JSON object body.",
    });
  });

  test("lists models for an authenticated session", async () => {
    let clock = 1000;
    const handler = createChatGPTHandler({
      fetch: createOpenAIMock({ pollsUntilAuthorized: 1, models: ["gpt-a", "gpt-b"] }),
      secret: "test-secret",
      now: () => clock,
    });

    const login = await handler.handler(new Request(`${BASE}/login`, { method: "POST" }));
    const cookie = cookieFrom(login);
    clock += 2000;
    await handler.handler(new Request(`${BASE}/status`, { headers: { cookie } }));

    const models = await handler.handler(new Request(`${BASE}/models`, { headers: { cookie } }));
    expect(models.status).toBe(200);
    expect(await models.json()).toEqual({ models: ["gpt-a", "gpt-b"] });

    expect(await handler.getModels(new Request(`${BASE}/models`, { headers: { cookie } }))).toEqual(["gpt-a", "gpt-b"]);
  });

  test("rejects /responses without an authenticated session", async () => {
    const handler = createChatGPTHandler({ fetch: createOpenAIMock(), secret: "s" });
    const res = await handler.handler(
      new Request(`${BASE}/responses`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } }),
    );
    expect(res.status).toBe(401);
  });

  test("routes request-scoped proxyFetch calls without exporting tokens", async () => {
    let clock = 1000;
    const handler = createChatGPTHandler({
      fetch: createOpenAIMock({ pollsUntilAuthorized: 1, models: ["gpt-proxy"] }),
      secret: "test-secret",
      now: () => clock,
    });

    const login = await handler.handler(new Request(`${BASE}/login`, { method: "POST" }));
    const cookie = cookieFrom(login);
    clock += 2000;
    await handler.handler(new Request(`${BASE}/status`, { headers: { cookie } }));

    const proxyFetch = handler.proxyFetch(new Request(`${BASE}/custom-ai-route`, { headers: { cookie } }));
    const models = await proxyFetch("/api/chatgpt/models", { headers: { accept: "application/json" } });
    expect(models.status).toBe(200);
    expect(await models.json()).toEqual({ models: ["gpt-proxy"] });
  });

  test("disables raw token export by default", async () => {
    let clock = 1000;
    const handler = createChatGPTHandler({
      fetch: createOpenAIMock({ pollsUntilAuthorized: 1 }),
      secret: "test-secret",
      now: () => clock,
    });

    const login = await handler.handler(new Request(`${BASE}/login`, { method: "POST" }));
    const cookie = cookieFrom(login);
    clock += 2000;
    await handler.handler(new Request(`${BASE}/status`, { headers: { cookie } }));

    await expect(
      handler.dangerouslyGetTokens(new Request(`${BASE}/session`, { headers: { cookie } })),
    ).rejects.toMatchObject({
      code: "token_export_disabled",
      status: 403,
    });
  });

  test("redacts refresh tokens from the dangerous export unless separately enabled", async () => {
    let clock = 1000;
    const handler = createChatGPTHandler({
      fetch: createOpenAIMock({ pollsUntilAuthorized: 1 }),
      secret: "test-secret",
      now: () => clock,
      dangerouslyAllowTokenExport: true,
    });

    const login = await handler.handler(new Request(`${BASE}/login`, { method: "POST" }));
    const cookie = cookieFrom(login);
    clock += 2000;
    await handler.handler(new Request(`${BASE}/status`, { headers: { cookie } }));

    const tokens = await handler.dangerouslyGetTokens(new Request(`${BASE}/session`, { headers: { cookie } }));
    expect(tokens?.accessToken).toEqual(expect.any(String));
    expect(tokens?.accountId).toBe("acct_1");
    expect(tokens?.refreshToken).toBeUndefined();

    await expect(
      handler.dangerouslyGetTokens(
        new Request(`${BASE}/session`, { headers: { cookie } }),
        { includeRefreshToken: true },
      ),
    ).rejects.toMatchObject({
      code: "refresh_token_export_disabled",
      status: 403,
    });

    const exportHandler = createChatGPTHandler({
      fetch: createOpenAIMock({ pollsUntilAuthorized: 1 }),
      secret: "test-secret",
      now: () => clock,
      dangerouslyAllowTokenExport: true,
      dangerouslyAllowRefreshTokenExport: true,
    });
    const exportLogin = await exportHandler.handler(new Request(`${BASE}/login`, { method: "POST" }));
    const exportCookie = cookieFrom(exportLogin);
    clock += 2000;
    await exportHandler.handler(new Request(`${BASE}/status`, { headers: { cookie: exportCookie } }));

    const exported = await exportHandler.dangerouslyGetTokens(
      new Request(`${BASE}/session`, { headers: { cookie: exportCookie } }),
      { includeRefreshToken: true },
    );
    expect(exported?.refreshToken).toBe("rt");
  });

  test("rate limits /responses per session and recovers after the window", async () => {
    let clock = 1000;
    const handler = createChatGPTHandler({
      fetch: createOpenAIMock({ pollsUntilAuthorized: 1 }),
      secret: "test-secret",
      now: () => clock,
      responsesProxy: { rateLimit: { limit: 2, windowMs: 60_000 } },
    });

    const login = await handler.handler(new Request(`${BASE}/login`, { method: "POST" }));
    const cookie = cookieFrom(login);
    clock += 2000;
    await handler.handler(new Request(`${BASE}/status`, { headers: { cookie } }));

    const send = () =>
      handler.handler(
        new Request(`${BASE}/responses`, {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify({ input: "hi" }),
        }),
      );

    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    const limited = await send();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toEqual(expect.any(String));
    expect(((await limited.json()) satisfies { error: string }).error).toBe("rate_limited");

    clock += 61_000;
    expect((await send()).status).toBe(200);
  });

  test("atomically rate limits concurrent /responses requests", async () => {
    let clock = 1000;
    const handler = createChatGPTHandler({
      fetch: createOpenAIMock({ pollsUntilAuthorized: 1 }),
      secret: "test-secret",
      now: () => clock,
      responsesProxy: { rateLimit: { limit: 2, windowMs: 60_000 } },
    });

    const login = await handler.handler(new Request(`${BASE}/login`, { method: "POST" }));
    const cookie = cookieFrom(login);
    clock += 2000;
    await handler.handler(new Request(`${BASE}/status`, { headers: { cookie } }));

    const statuses = await Promise.all(
      Array.from({ length: 6 }, () =>
        handler.handler(
          new Request(`${BASE}/responses`, {
            method: "POST",
            headers: { cookie, "content-type": "application/json" },
            body: JSON.stringify({ input: "hi" }),
          }),
        ).then((response) => response.status),
      ),
    );

    expect(statuses.filter((status) => status === 200)).toHaveLength(2);
    expect(statuses.filter((status) => status === 429)).toHaveLength(4);
  });

  test("rejects cross-origin POSTs unless the origin is allowlisted", async () => {
    let clock = 1000;
    const handler = createChatGPTHandler({
      fetch: createOpenAIMock({ pollsUntilAuthorized: 1 }),
      secret: "test-secret",
      now: () => clock,
      allowedOrigins: ["https://trusted.example"],
    });

    // Same-origin browser POST passes.
    const sameOrigin = await handler.handler(
      new Request(`${BASE}/login`, { method: "POST", headers: { origin: "https://app.dev" } }),
    );
    expect(sameOrigin.status).toBe(200);

    // Matching host with a different scheme is still cross-origin.
    const differentScheme = await handler.handler(
      new Request(`${BASE}/login`, { method: "POST", headers: { origin: "http://app.dev" } }),
    );
    expect(differentScheme.status).toBe(403);

    // TLS-terminating proxies may expose an internal http URL but forward the
    // public scheme separately.
    const forwardedHttps = await handler.handler(
      new Request(`http://app.dev/api/chatgpt/login`, {
        method: "POST",
        headers: { origin: "https://app.dev", "x-forwarded-proto": "https" },
      }),
    );
    expect(forwardedHttps.status).toBe(200);

    // Allowlisted cross-origin POST passes.
    const allowlisted = await handler.handler(
      new Request(`${BASE}/login`, { method: "POST", headers: { origin: "https://trusted.example" } }),
    );
    expect(allowlisted.status).toBe(200);

    // Anything else is rejected before reaching the route.
    const crossSite = await handler.handler(
      new Request(`${BASE}/login`, { method: "POST", headers: { origin: "https://evil.example" } }),
    );
    expect(crossSite.status).toBe(403);
    expect(((await crossSite.json()) satisfies { error: string }).error).toBe("origin_not_allowed");

    const opaque = await handler.handler(
      new Request(`${BASE}/logout`, { method: "POST", headers: { origin: "null" } }),
    );
    expect(opaque.status).toBe(403);

    // Non-browser requests (no Origin header) are unaffected.
    const server = await handler.handler(new Request(`${BASE}/login`, { method: "POST" }));
    expect(server.status).toBe(200);
  });

  test("deduplicates concurrent token refreshes for one session", async () => {
    let clock = 1000;
    const fetch = createMockFetch((url) => {
      if (url.endsWith("/deviceauth/usercode")) {
        return jsonResponse({ device_auth_id: "dev_1", user_code: "ABCD-1234", interval: "1" });
      }
      if (url.endsWith("/deviceauth/token")) {
        return jsonResponse({ authorization_code: "ac", code_challenge: "c", code_verifier: "v" });
      }
      if (url.endsWith("/oauth/token")) {
        // exp: 2s epoch. Already expired against the mocked clock, so every
        // getFreshTokens call would refresh without single-flight dedup.
        return jsonResponse({
          access_token: makeJwt({ exp: 2 }),
          refresh_token: "rt",
          id_token: makeIdToken({ accountId: "acct_1" }),
        });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const handler = createChatGPTHandler({
      fetch,
      secret: "test-secret",
      now: () => clock,
      dangerouslyAllowTokenExport: true,
    });

    const login = await handler.handler(new Request(`${BASE}/login`, { method: "POST" }));
    const cookie = cookieFrom(login);
    clock += 2000;
    await handler.handler(new Request(`${BASE}/status`, { headers: { cookie } }));

    const tokenCallsBefore = fetch.calls.filter((c) => c.url.endsWith("/oauth/token")).length;
    const request = () => handler.dangerouslyGetTokens(new Request(`${BASE}/session`, { headers: { cookie } }));
    await Promise.all([request(), request(), request(), request()]);
    const tokenCallsAfter = fetch.calls.filter((c) => c.url.endsWith("/oauth/token")).length;
    expect(tokenCallsAfter - tokenCallsBefore).toBe(1);
  });

  test("returns 404 for unknown routes and 405 for wrong methods", async () => {
    const handler = createChatGPTHandler({ fetch: createOpenAIMock(), secret: "s" });
    expect((await handler.handler(new Request(`${BASE}/nope`))).status).toBe(404);
    expect((await handler.handler(new Request(`${BASE}/login`))).status).toBe(405); // GET, needs POST
  });
});
