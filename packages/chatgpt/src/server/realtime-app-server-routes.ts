import type {
  ChatGPTRealtimeSessionOptions,
  ChatGPTTokens,
  ReasoningEffort,
} from "../core/index.ts";
import type {
  ChatGPTRealtimeAppServerOptions,
  RealtimeBridgeEvent,
  RealtimeConfirmationResult,
  RealtimeDynamicTool,
  RealtimeToolContext,
  RealtimeToolResult,
  StartRealtimeAppServerOptions,
} from "./realtime-app-server.ts";
import { readTextBody } from "./request-body.ts";

const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_QUEUED_EVENTS = 256;
const APP_SERVER_SESSION_KEYS = new Set([
  "voice", "model", "timezone", "timezoneOffsetMinutes",
]);

export interface RealtimeAppServerToolContext extends RealtimeToolContext {
  /** Stable id of the authenticated Login with ChatGPT session. */
  loginSessionId: string;
  /** Opaque id of this Live call. */
  liveSessionId: string;
  /** Header-only snapshot of the authenticated session-creation request. */
  request: Request;
}

export interface RealtimeAppServerConfirmationContext extends RealtimeAppServerToolContext {
  confirmation: unknown;
  pending: RealtimeToolResult;
}

/** Minimal process/session contract required by the HTTP lifecycle manager. */
export interface RealtimeAppServerSessionHandle {
  readonly id: string;
  start(options: StartRealtimeAppServerOptions): Promise<string>;
  onEvent(listener: (event: RealtimeBridgeEvent) => void): () => void;
  resolveConfirmation(
    callId: string,
    confirmation: unknown,
  ): Promise<unknown>;
  close(): Promise<void>;
}

export interface RealtimeAppServerPolicy {
  /** Server-owned function schemas exposed to the delegated execution turn. */
  tools: readonly RealtimeDynamicTool[];
  /** Executes one allowlisted tool under the authenticated application user. */
  executeTool: (context: RealtimeAppServerToolContext) => Promise<RealtimeToolResult>;
  /** Performs an application-owned pending action after explicit confirmation. */
  confirmTool?: (
    context: RealtimeAppServerConfirmationContext,
  ) => Promise<RealtimeConfirmationResult>;
  /** Restricts browser-selected delegated execution models. */
  allowedModels?: readonly string[] | ((model: string) => boolean);
  /** Used when the browser does not select a model. */
  defaultModel?: string;
  /** Defaults to `low` for responsive tool turns. */
  reasoningEffort?: ReasoningEffort;
  /** Defaults to 30 minutes. */
  sessionTtlMs?: number;
  /** Optional app-server executable override. */
  command?: readonly string[];
  executionInstructions?: string;
  realtimePrompt?: string;
  /** Advanced factory hook for custom process hosting and tests. */
  sessionFactory?: (
    options: ChatGPTRealtimeAppServerOptions,
  ) => RealtimeAppServerSessionHandle;
}

interface ManagedSession {
  ownerSessionId: string;
  session: RealtimeAppServerSessionHandle;
  expires: ReturnType<typeof setTimeout>;
  queuedEvents: RealtimeBridgeEvent[];
  subscribers: Set<(event: RealtimeBridgeEvent) => void>;
  unsubscribe: () => void;
}

interface RealtimePayload {
  sdp: string;
  session?: ChatGPTRealtimeSessionOptions;
}

type RouteMethods = Partial<Record<string, (request: Request) => Promise<Response>>>;

export interface RealtimeAppServerRoutes {
  start(request: Request): Promise<Response>;
  methods(route: string): RouteMethods | undefined;
  closeOwner(ownerSessionId: string): Promise<void>;
}

export function createRealtimeAppServerRoutes(options: {
  policy: RealtimeAppServerPolicy;
  maxRequestBytes: number;
  readSessionId: (request: Request) => Promise<string | undefined>;
  getFreshTokens: (sessionId: string) => Promise<ChatGPTTokens | undefined>;
  preparePayload: (request: Request, maxRequestBytes: number) => Promise<RealtimePayload | Response>;
}): RealtimeAppServerRoutes {
  const { policy } = options;
  const sessions = new Map<string, ManagedSession>();
  const ownerOperations = new Map<string, Promise<void>>();

  function getSession(liveSessionId: string, ownerSessionId: string): ManagedSession | undefined {
    const managed = sessions.get(liveSessionId);
    return managed?.ownerSessionId === ownerSessionId ? managed : undefined;
  }

  async function closeSession(liveSessionId: string, ownerSessionId?: string): Promise<boolean> {
    const managed = sessions.get(liveSessionId);
    if (!managed || (ownerSessionId && managed.ownerSessionId !== ownerSessionId)) return false;
    sessions.delete(liveSessionId);
    clearTimeout(managed.expires);
    try {
      await managed.session.close();
    } finally {
      managed.unsubscribe();
    }
    return true;
  }

  async function closeOwnerUnlocked(ownerSessionId: string): Promise<void> {
    const owned = [...sessions]
      .filter(([, managed]) => managed.ownerSessionId === ownerSessionId)
      .map(([liveSessionId]) => liveSessionId);
    await Promise.all(owned.map((liveSessionId) => closeSession(liveSessionId, ownerSessionId)));
  }

  async function withOwnerLock<T>(ownerSessionId: string, action: () => Promise<T>): Promise<T> {
    const previous = ownerOperations.get(ownerSessionId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => gate);
    ownerOperations.set(ownerSessionId, queued);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (ownerOperations.get(ownerSessionId) === queued) ownerOperations.delete(ownerSessionId);
    }
  }

  async function start(request: Request): Promise<Response> {
    const ownerSessionId = await options.readSessionId(request);
    if (!ownerSessionId) return json({ error: "not_authenticated" }, { status: 401 });
    const payload = await options.preparePayload(request, options.maxRequestBytes);
    if (payload instanceof Response) return payload;
    const unsupportedOption = Object.keys(payload.session ?? {})
      .find((key) => !APP_SERVER_SESSION_KEYS.has(key));
    if (unsupportedOption) {
      return json(
        {
          error: "invalid_realtime_request",
          message: `The app-server route does not support session.${unsupportedOption}.`,
        },
        { status: 400 },
      );
    }
    const model = payload.session?.model ?? policy.defaultModel;
    if (model && !isModelAllowed(model, policy.allowedModels)) {
      return json({ error: "realtime_model_not_allowed", model }, { status: 403 });
    }

    return withOwnerLock(ownerSessionId, async () => {
      const tokens = await options.getFreshTokens(ownerSessionId);
      if (!tokens?.accessToken || !tokens.accountId) {
        return json({ error: "not_authenticated" }, { status: 401 });
      }
      await closeOwnerUnlocked(ownerSessionId);

      const requestSnapshot = new Request(request.url, { headers: request.headers });
      let liveSessionId = "";
      const sessionOptions: ChatGPTRealtimeAppServerOptions = {
        tokens,
        refreshTokens: async () => {
          const fresh = await options.getFreshTokens(ownerSessionId);
          if (!fresh?.accessToken || !fresh.accountId) {
            throw new Error("Login with ChatGPT session is no longer authenticated.");
          }
          return fresh;
        },
        tools: policy.tools,
        executeTool: (context) => policy.executeTool({
          ...context,
          loginSessionId: ownerSessionId,
          liveSessionId,
          request: requestSnapshot,
        }),
        ...(policy.confirmTool
          ? {
              confirmTool: (context) => policy.confirmTool!({
                ...context,
                loginSessionId: ownerSessionId,
                liveSessionId,
                request: requestSnapshot,
              }),
            }
          : {}),
        ...(policy.command ? { command: policy.command } : {}),
        ...(policy.executionInstructions ? { executionInstructions: policy.executionInstructions } : {}),
        ...(policy.realtimePrompt ? { realtimePrompt: policy.realtimePrompt } : {}),
      };
      const session = policy.sessionFactory
        ? policy.sessionFactory(sessionOptions)
        : new (await import("./realtime-app-server.ts")).ChatGPTRealtimeAppServerSession(sessionOptions);
      liveSessionId = session.id;
      const queuedEvents: RealtimeBridgeEvent[] = [];
      const subscribers = new Set<(event: RealtimeBridgeEvent) => void>();
      let managed: ManagedSession | undefined;
      const unsubscribe = session.onEvent((event) => {
        if (subscribers.size === 0) {
          queuedEvents.push(event);
          if (queuedEvents.length > MAX_QUEUED_EVENTS) queuedEvents.shift();
        } else {
          for (const subscriber of subscribers) {
            try {
              subscriber(event);
            } catch {
              subscribers.delete(subscriber);
            }
          }
        }
        if (event.type !== "session.closed" || !managed) return;
        const current = sessions.get(liveSessionId);
        if (current?.session !== session) return;
        sessions.delete(liveSessionId);
        clearTimeout(current.expires);
        unsubscribe();
      });

      let answer: string;
      try {
        answer = await session.start({
          sdp: payload.sdp,
          voice: payload.session?.voice,
          model,
          reasoningEffort: policy.reasoningEffort,
        });
      } catch {
        await session.close().catch(() => {});
        unsubscribe();
        return json(
          {
            error: "realtime_app_server_start_failed",
            message: "The Realtime app-server session could not be started.",
          },
          { status: 502 },
        );
      }

      const expires = setTimeout(() => {
        void closeSession(liveSessionId).catch(() => {});
      }, policy.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS);
      if (typeof expires === "object" && "unref" in expires) expires.unref();
      managed = { ownerSessionId, session, expires, queuedEvents, subscribers, unsubscribe };
      sessions.set(liveSessionId, managed);
      if (queuedEvents.some((event) => event.type === "session.closed")) {
        await closeSession(liveSessionId, ownerSessionId).catch(() => {});
        return json(
          {
            error: "realtime_app_server_start_failed",
            message: "The Realtime app-server session closed during startup.",
          },
          { status: 502 },
        );
      }
      return json(
        { sessionId: liveSessionId, sdp: answer },
        { status: 201, headers: new Headers({ "cache-control": "no-store" }) },
      );
    });
  }

  async function events(request: Request, liveSessionId: string): Promise<Response> {
    const ownerSessionId = await options.readSessionId(request);
    if (!ownerSessionId) return json({ error: "not_authenticated" }, { status: 401 });
    const managed = getSession(liveSessionId, ownerSessionId);
    if (!managed) return json({ error: "realtime_session_not_found" }, { status: 404 });

    const encoder = new TextEncoder();
    let unsubscribe = () => {};
    let keepalive: ReturnType<typeof setInterval> | undefined;
    let active = true;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const write = (event: unknown) => {
          if (!active) return;
          if (controller.desiredSize !== null && controller.desiredSize <= 0) {
            active = false;
            clearInterval(keepalive);
            unsubscribe();
            controller.error(new Error("Realtime event subscriber is too slow."));
            return;
          }
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        };
        const listener = (event: RealtimeBridgeEvent) => {
          write(event);
          if (active && event.type === "session.closed") {
            active = false;
            clearInterval(keepalive);
            unsubscribe();
            controller.close();
          }
        };
        managed.subscribers.add(listener);
        unsubscribe = () => managed.subscribers.delete(listener);
        for (const event of managed.queuedEvents.splice(0)) write(event);
        if (!active) return;
        keepalive = setInterval(() => write({ type: "keepalive" }), 15_000);
        request.signal.addEventListener("abort", () => {
          if (!active) return;
          active = false;
          clearInterval(keepalive);
          unsubscribe();
          controller.close();
        }, { once: true });
      },
      cancel() {
        active = false;
        clearInterval(keepalive);
        unsubscribe();
      },
    }, { highWaterMark: MAX_QUEUED_EVENTS });
    return new Response(stream, {
      headers: {
        "content-type": "application/x-ndjson",
        "cache-control": "no-store",
        "x-accel-buffering": "no",
      },
    });
  }

  async function confirm(request: Request, liveSessionId: string): Promise<Response> {
    if (!policy.confirmTool) {
      return json({ error: "realtime_confirmation_not_configured" }, { status: 501 });
    }
    const ownerSessionId = await options.readSessionId(request);
    if (!ownerSessionId) return json({ error: "not_authenticated" }, { status: 401 });
    const managed = getSession(liveSessionId, ownerSessionId);
    if (!managed) return json({ error: "realtime_session_not_found" }, { status: 404 });

    let payload: unknown;
    try {
      const text = await readTextBody(request, options.maxRequestBytes);
      if (text === undefined) {
        return json(
          { error: "realtime_request_too_large", maxRequestBytes: options.maxRequestBytes },
          { status: 413 },
        );
      }
      payload = JSON.parse(text);
    } catch {
      return json({ error: "invalid_realtime_confirmation" }, { status: 400 });
    }
    if (!isRecord(payload) || typeof payload["callId"] !== "string" || !("confirmation" in payload)) {
      return json(
        {
          error: "invalid_realtime_confirmation",
          message: "Expected `callId` and application-defined `confirmation`.",
        },
        { status: 400 },
      );
    }
    try {
      await managed.session.resolveConfirmation(payload["callId"], payload["confirmation"]);
      return json({ status: "resolved", callId: payload["callId"] });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const noLongerPending = message.includes("no longer pending");
      return json(
        {
          error: "realtime_confirmation_failed",
          message: noLongerPending
            ? "Tool confirmation is no longer pending."
            : "Tool confirmation failed.",
        },
        { status: noLongerPending ? 409 : 500 },
      );
    }
  }

  async function close(request: Request, liveSessionId: string): Promise<Response> {
    const ownerSessionId = await options.readSessionId(request);
    if (!ownerSessionId) return json({ error: "not_authenticated" }, { status: 401 });
    const closed = await withOwnerLock(ownerSessionId, () => closeSession(liveSessionId, ownerSessionId));
    return closed
      ? json({ status: "closed" })
      : json({ error: "realtime_session_not_found" }, { status: 404 });
  }

  return {
    start,
    closeOwner: (ownerSessionId) => withOwnerLock(ownerSessionId, () => closeOwnerUnlocked(ownerSessionId)),
    methods(route) {
      const match = /^\/realtime\/app-server\/([^/]+)(?:\/(events|confirm))?$/.exec(route);
      if (!match?.[1]) return undefined;
      let liveSessionId: string;
      try {
        liveSessionId = decodeURIComponent(match[1]);
      } catch {
        return undefined;
      }
      return match[2] === "events"
        ? { GET: (request) => events(request, liveSessionId) }
        : match[2] === "confirm"
          ? { POST: (request) => confirm(request, liveSessionId) }
          : { DELETE: (request) => close(request, liveSessionId) };
    },
  };
}

function isModelAllowed(
  model: string,
  allowedModels: RealtimeAppServerPolicy["allowedModels"],
): boolean {
  if (!allowedModels) return true;
  return typeof allowedModels === "function" ? allowedModels(model) : allowedModels.includes(model);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function json(data: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}
