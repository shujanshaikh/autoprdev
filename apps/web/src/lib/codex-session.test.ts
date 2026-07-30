import { describe, expect, it, vi } from "vitest";

import {
  type CodexPublicSession,
  createStoredCodexSessionLink,
  getCodexSessionCookieHeaders,
  getChatGPTSessionCookieHeader,
  parseStoredCodexSessionLink,
  requestWithChatGPTSession,
  resolveCodexSession,
} from "./codex-session";

const authenticatedSession = {
  status: "authenticated",
  user: { accountId: "account-1", email: "person@example.com" },
} satisfies CodexPublicSession;

function requestWithCookie(cookie?: string) {
  return new Request("https://autopr.dev/api/codex/status", {
    headers: cookie ? { cookie } : undefined,
  });
}

describe("Codex account session resolution", () => {
  it("recovers an authenticated session on a device without the original cookie", async () => {
    const request = requestWithCookie("workos_session=workos-1");
    const getSession = vi.fn(async (candidate: Request) =>
      getChatGPTSessionCookieHeader(candidate) === "lwc_session=desktop-session"
        ? authenticatedSession
        : ({ status: "unauthenticated" } satisfies CodexPublicSession),
    );

    const resolved = await resolveCodexSession({
      request,
      getSession,
      loadAccountCookieHeader: async () => "lwc_session=desktop-session",
    });

    expect(resolved?.source).toBe("account");
    expect(resolved?.session).toEqual(authenticatedSession);
    expect(resolved?.request.headers.get("cookie")).toBe(
      "workos_session=workos-1; lwc_session=desktop-session",
    );
  });

  it("keeps the current device session authoritative after it authenticates", async () => {
    const loadAccountCookieHeader = vi.fn(async () => "lwc_session=other-device");
    const resolved = await resolveCodexSession({
      request: requestWithCookie("lwc_session=current-device"),
      getSession: async () => authenticatedSession,
      loadAccountCookieHeader,
    });

    expect(resolved?.source).toBe("request");
    expect(resolved?.cookieHeader).toBe("lwc_session=current-device");
    expect(loadAccountCookieHeader).not.toHaveBeenCalled();
  });

  it("does not replace an in-progress login with another device's session", async () => {
    const loadAccountCookieHeader = vi.fn(async () => "lwc_session=desktop-session");
    const resolved = await resolveCodexSession({
      request: requestWithCookie("lwc_session=pending-mobile"),
      getSession: async () => ({ status: "pending" }),
      loadAccountCookieHeader,
    });

    expect(resolved?.session.status).toBe("pending");
    expect(resolved?.cookieHeader).toBe("lwc_session=pending-mobile");
    expect(loadAccountCookieHeader).not.toHaveBeenCalled();
  });

  it("replaces only the Codex cookie when creating a server-side session request", () => {
    const request = requestWithCookie(
      "workos_session=workos-1; lwc_session=stale; preference=compact",
    );
    const restored = requestWithChatGPTSession(request, "lwc_session=shared");

    expect(restored.headers.get("cookie")).toBe(
      "workos_session=workos-1; preference=compact; lwc_session=shared",
    );
  });

  it("restores an account session after an agent request body has been consumed", async () => {
    const request = new Request("https://autopr.dev/api/project/project-1/thread/thread-1/agent", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "workos_session=workos-1",
      },
      body: JSON.stringify({ message: { id: "message-1" } }),
    });

    await request.json();

    expect(request.bodyUsed).toBe(true);
    expect(() => requestWithChatGPTSession(request, "lwc_session=desktop-session")).not.toThrow();

    const restored = requestWithChatGPTSession(request, "lwc_session=desktop-session");
    expect(restored.method).toBe("POST");
    expect(restored.url).toBe(request.url);
    expect(restored.body).toBeNull();
    expect(restored.headers.get("cookie")).toBe(
      "workos_session=workos-1; lwc_session=desktop-session",
    );
  });

  it("normalizes request objects created by another server runtime", () => {
    const foreignRequest = {
      bodyUsed: false,
      headers: new Headers({ cookie: "workos_session=workos-1" }),
      method: "POST",
      url: "https://autopr.dev/api/project/project-1/thread/thread-1",
    } as Request;

    const restored = requestWithChatGPTSession(foreignRequest, "lwc_session=desktop-session");

    expect(restored).toBeInstanceOf(Request);
    expect(restored.method).toBe("POST");
    expect(restored.url).toBe(foreignRequest.url);
    expect(restored.body).toBeNull();
    expect(restored.headers.get("cookie")).toBe(
      "workos_session=workos-1; lwc_session=desktop-session",
    );
  });

  it("returns both device and account sessions for a complete disconnect", () => {
    expect(
      getCodexSessionCookieHeaders(
        requestWithCookie("workos_session=workos-1; lwc_session=mobile-session"),
        "lwc_session=desktop-session",
      ),
    ).toEqual(["lwc_session=mobile-session", "lwc_session=desktop-session"]);

    expect(
      getCodexSessionCookieHeaders(
        requestWithCookie("lwc_session=shared-session"),
        "lwc_session=shared-session",
      ),
    ).toEqual(["lwc_session=shared-session"]);
  });

  it("rejects malformed or unrelated stored session links", () => {
    const valid = createStoredCodexSessionLink("lwc_session=signed-session");

    expect(parseStoredCodexSessionLink(JSON.stringify(valid))).toEqual(valid);
    expect(parseStoredCodexSessionLink("not-json")).toBeUndefined();
    expect(
      parseStoredCodexSessionLink(
        JSON.stringify({ ...valid, sessionCookieHeader: "workos_session=secret" }),
      ),
    ).toBeUndefined();
    expect(
      parseStoredCodexSessionLink(
        JSON.stringify({ ...valid, sessionCookieHeader: "lwc_session=one; other=two" }),
      ),
    ).toBeUndefined();
  });
});
