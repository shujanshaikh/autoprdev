export const CHATGPT_SESSION_COOKIE_NAME = "lwc_session";

export type CodexPublicSession = {
  status: "unauthenticated" | "pending" | "authenticated" | "expired" | "error";
  user?: {
    accountId: string;
    email?: string;
    name?: string;
    plan?: string;
  };
};

export type StoredCodexSessionLink = {
  version: 1;
  provider: "openai-codex";
  type: "login-with-chatgpt-session";
  sessionCookieHeader: string;
};

export type ResolvedCodexSession = {
  cookieHeader: string;
  request: Request;
  session: CodexPublicSession;
  source: "request" | "account";
};

function normalizedSessionCookieHeader(value: string) {
  return `${CHATGPT_SESSION_COOKIE_NAME}=${encodeURIComponent(value)}`;
}

export function getChatGPTSessionCookieHeader(request: Request) {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return undefined;
  }

  for (const part of cookieHeader.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex === -1 || part.slice(0, separatorIndex).trim() !== CHATGPT_SESSION_COOKIE_NAME) {
      continue;
    }

    const rawValue = part.slice(separatorIndex + 1).trim();
    try {
      return normalizedSessionCookieHeader(decodeURIComponent(rawValue));
    } catch {
      return normalizedSessionCookieHeader(rawValue);
    }
  }

  return undefined;
}

export function requestWithChatGPTSession(request: Request, sessionCookieHeader: string) {
  const headers = new Headers(request.headers);
  const otherCookies = (headers.get("cookie") ?? "")
    .split(";")
    .map((cookie) => cookie.trim())
    .filter(Boolean)
    .filter((cookie) => cookie.split("=", 1)[0]?.trim() !== CHATGPT_SESSION_COOKIE_NAME);

  headers.set("cookie", [...otherCookies, sessionCookieHeader].join("; "));
  return new Request(request, { headers });
}

export function getCodexSessionCookieHeaders(
  request: Request,
  accountCookieHeader?: string,
) {
  return [getChatGPTSessionCookieHeader(request), accountCookieHeader].filter(
    (cookieHeader, index, cookieHeaders): cookieHeader is string =>
      Boolean(cookieHeader) && cookieHeaders.indexOf(cookieHeader) === index,
  );
}

export function createStoredCodexSessionLink(sessionCookieHeader: string): StoredCodexSessionLink {
  return {
    version: 1,
    provider: "openai-codex",
    type: "login-with-chatgpt-session",
    sessionCookieHeader,
  };
}

export function parseStoredCodexSessionLink(value: string): StoredCodexSessionLink | undefined {
  try {
    const parsed = JSON.parse(value) as Partial<StoredCodexSessionLink>;
    if (
      parsed.version !== 1 ||
      parsed.provider !== "openai-codex" ||
      parsed.type !== "login-with-chatgpt-session" ||
      typeof parsed.sessionCookieHeader !== "string"
    ) {
      return undefined;
    }

    const request = new Request("https://autopr.local", {
      headers: { cookie: parsed.sessionCookieHeader },
    });
    const sessionCookieHeader = getChatGPTSessionCookieHeader(request);
    if (!sessionCookieHeader || sessionCookieHeader !== parsed.sessionCookieHeader) {
      return undefined;
    }

    return createStoredCodexSessionLink(sessionCookieHeader);
  } catch {
    return undefined;
  }
}

export async function resolveCodexSession(options: {
  request: Request;
  getSession: (request: Request) => Promise<CodexPublicSession>;
  loadAccountCookieHeader: () => Promise<string | undefined>;
}): Promise<ResolvedCodexSession | undefined> {
  const requestCookieHeader = getChatGPTSessionCookieHeader(options.request);
  let requestSession: CodexPublicSession | undefined;

  if (requestCookieHeader) {
    requestSession = await options.getSession(options.request);
    if (requestSession.status === "authenticated" || requestSession.status === "pending") {
      return {
        cookieHeader: requestCookieHeader,
        request: options.request,
        session: requestSession,
        source: "request",
      };
    }
  }

  const accountCookieHeader = await options.loadAccountCookieHeader();
  if (accountCookieHeader && accountCookieHeader !== requestCookieHeader) {
    const accountRequest = requestWithChatGPTSession(options.request, accountCookieHeader);
    const accountSession = await options.getSession(accountRequest);
    if (accountSession.status === "authenticated") {
      return {
        cookieHeader: accountCookieHeader,
        request: accountRequest,
        session: accountSession,
        source: "account",
      };
    }
  }

  if (!requestCookieHeader || !requestSession) {
    return undefined;
  }

  return {
    cookieHeader: requestCookieHeader,
    request: options.request,
    session: requestSession,
    source: "request",
  };
}
