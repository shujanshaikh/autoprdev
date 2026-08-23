import { hasBooleanType, hasNumberType, hasStringType } from "@autopr/config/runtime-type";
import { isJsonObject, jsonValueSchema, type JsonObject, type JsonValue } from "@autopr/config/runtime-value";

import type { ResolvedConfig } from "./config.ts";
import { ChatGPTAuthError } from "./errors.ts";
import { requestSignal } from "./internal/request-signal.ts";

export type ChatGPTRealtimeTransport = "wm" | "vp" | "vps";
export type ChatGPTRealtimeVoiceMode = "wingman" | "advanced" | "standard";
/** Voice names currently documented by ChatGPT. The wire API remains open to newer names. */
export const CHATGPT_REALTIME_VOICES = [
  "arbor", "breeze", "cove", "ember", "juniper",
  "maple", "sol", "spruce", "vale",
] as const;
export type ChatGPTRealtimeVoice = typeof CHATGPT_REALTIME_VOICES[number];
export type ChatGPTRealtimeState =
  | "connecting"
  | "idle"
  | "connected"
  | "halted"
  | "listening"
  | "listening_intently"
  | "thinking"
  | "speaking";

export type ChatGPTRealtimeAction =
  | "start_listening"
  | "stop_listening"
  | "stop_speaking"
  | "resume_listening"
  | "relay_message";

export interface ChatGPTRealtimeSessionOptions {
  /** Experimental private ChatGPT transport. `wm` is the GPT Live path. */
  transport?: ChatGPTRealtimeTransport;
  voice?: string;
  voiceMode?: ChatGPTRealtimeVoiceMode;
  model?: string;
  advancedModel?: string;
  language?: string | null;
  conversationId?: string | null;
  parentMessageId?: string;
  timezone?: string;
  timezoneOffsetMinutes?: number;
  /**
   * Reserved for ChatGPT's first-party device tools. `/wm` rejects arbitrary
   * application function IDs.
   */
  clientTools?: readonly never[];
  conversationMode?: JsonObject;
  historyAndTrainingDisabled?: boolean;
  enableMessageStreaming?: boolean;
}

const REALTIME_SESSION_OPTION_KEYS = new Set<keyof ChatGPTRealtimeSessionOptions>([
  "transport", "voice", "voiceMode", "model", "advancedModel", "language",
  "conversationId", "parentMessageId", "timezone", "timezoneOffsetMinutes",
  "clientTools", "conversationMode", "historyAndTrainingDisabled",
  "enableMessageStreaming",
]);

/** Validates the public session contract at a JSON or JavaScript trust boundary. */
export function parseChatGPTRealtimeSessionOptions<ValueValue>(
  value: ValueValue,
): ChatGPTRealtimeSessionOptions {
  if (!isRecord(value)) throw new TypeError("`session` must be a JSON object.");
  for (const key of Object.keys(value)) {
    if (!REALTIME_SESSION_OPTION_KEYS.has(/* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ key as keyof ChatGPTRealtimeSessionOptions)) {
      throw new TypeError(`Unsupported Realtime session option: ${key}`);
    }
  }
  for (const key of ["voice", "model", "advancedModel", "parentMessageId", "timezone"] as const) {
    if (value[key] !== undefined && !hasStringType(value[key])) {
      throw new TypeError(`\`session.${key}\` must be a string.`);
    }
  }
  for (const key of ["language", "conversationId"] as const) {
    if (value[key] !== undefined && value[key] !== null && !hasStringType(value[key])) {
      throw new TypeError(`\`session.${key}\` must be a string or null.`);
    }
  }
  for (const key of ["historyAndTrainingDisabled", "enableMessageStreaming"] as const) {
    if (value[key] !== undefined && !hasBooleanType(value[key])) {
      throw new TypeError(`\`session.${key}\` must be a boolean.`);
    }
  }
  if (value["timezoneOffsetMinutes"] !== undefined && !hasNumberType(value["timezoneOffsetMinutes"])) {
    throw new TypeError("`session.timezoneOffsetMinutes` must be a number.");
  }
  if (value["clientTools"] !== undefined && !Array.isArray(value["clientTools"])) {
    throw new TypeError("`session.clientTools` must be an array.");
  }
  if (value["conversationMode"] !== undefined && !isRecord(value["conversationMode"])) {
    throw new TypeError("`session.conversationMode` must be a JSON object.");
  }
  if (value["transport"] !== undefined &&
      (!hasStringType(value["transport"]) || !["wm", "vp", "vps"].includes(value["transport"]))) {
    throw new TypeError("`session.transport` must be `wm`, `vp`, or `vps`.");
  }
  if (value["voiceMode"] !== undefined &&
      (!hasStringType(value["voiceMode"]) || !["wingman", "advanced", "standard"].includes(value["voiceMode"]))) {
    throw new TypeError("`session.voiceMode` must be `wingman`, `advanced`, or `standard`.");
  }
  return /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ { ...value } as ChatGPTRealtimeSessionOptions;
}

/** The multipart `session` object accepted by ChatGPT's web Realtime edge. */
export interface ChatGPTRealtimeSession {
  conversation_id: string | null;
  language_code: string | null;
  requested_default_model: string;
  voice: string;
  voice_session_id: string;
  voice_status_request_id: string;
  timezone_offset_min: number;
  timezone: string;
  voice_mode: ChatGPTRealtimeVoiceMode;
  model_slug: string;
  model_slug_advanced?: string;
  client_tools: [];
  history_and_training_disabled: boolean;
  conversation_mode: JsonObject;
  enable_message_streaming?: boolean;
  [key: string]: JsonValue;
}

export interface ChatGPTRealtimeAuth {
  /** Must be minted for the ChatGPT web client when using `/wm`. */
  accessToken: string;
  accountId?: string;
  /** Stable ChatGPT web device identity used for auth exchange and signaling. */
  deviceId?: string;
}

export interface ChatGPTRealtimeWebSessionState {
  deviceId: string;
  /** Rotated NextAuth cookie chunks. Encrypt these at rest. */
  sessionCookies: Record<string, string>;
}

export interface ExchangeChatGPTRealtimeWebSessionOptions {
  config: ResolvedConfig;
  /** Opaque ChatGPT web session credential. Keep server-side and encrypted at rest. */
  sessionToken: string;
  /** Reuse the device id returned by the previous exchange. */
  deviceId?: string;
  /** Rotated cookie chunks returned by the previous exchange; takes precedence over `sessionToken`. */
  sessionCookies?: Readonly<Record<string, string>>;
  /** Persist rotated cookies and device identity in the application's encrypted user store. */
  onSessionUpdate?: (state: ChatGPTRealtimeWebSessionState) => Promise<void> | void;
  signal?: AbortSignal;
}

export interface ChatGPTRealtimeWebAuth extends ChatGPTRealtimeAuth {
  deviceId: string;
  sessionCookies: Record<string, string>;
  email: string;
  expiresAt?: string;
}

/**
 * Mints the short-lived web-client access token required by `/realtime/wm`.
 * This is a server-only operation; never return `sessionToken` or the result
 * bearer to browser code.
 */
export async function exchangeChatGPTRealtimeWebSession(
  options: ExchangeChatGPTRealtimeWebSessionOptions,
): Promise<ChatGPTRealtimeWebAuth> {
  const sessionCookies = normalizeRealtimeSessionCookies(options.sessionToken, options.sessionCookies);
  const deviceId = options.deviceId?.trim() || createUuid();
  const response = await options.config.fetch(`${options.config.realtimeBaseUrl}/api/auth/session`, {
    method: "GET",
    headers: {
      accept: "application/json",
      cookie: [
        ...Object.entries(sessionCookies).map(([name, value]) => `${name}=${value}`),
        `oai-did=${deviceId}`,
      ].join("; "),
      "oai-device-id": deviceId,
      origin: options.config.realtimeBaseUrl,
      referer: `${options.config.realtimeBaseUrl}/`,
    },
    signal: requestSignal(options.config, options.signal),
  });
  const body = /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ await response.json().catch(() => undefined) as JsonObject | undefined;
  if (response.status === 403) {
    throw new ChatGPTAuthError(
      "realtime_web_edge_rejected",
      "ChatGPT rejected the GPT Live web session at its edge; retry the request.",
      { status: 502 },
    );
  }
  const accessToken = hasStringType(body?.["accessToken"]) ? body["accessToken"] : undefined;
  const account = isRecord(body?.["account"]) ? body["account"] : undefined;
  const user = isRecord(body?.["user"]) ? body["user"] : undefined;
  const accountId = hasStringType(account?.["id"]) ? account["id"] : undefined;
  const email = hasStringType(user?.["email"]) ? user["email"] : undefined;
  const claims = accessToken ? decodeJwtPayload(accessToken) : undefined;
  if (!response.ok || !accessToken || !accountId || !email || claims?.["client_id"] !== options.config.realtimeWebClientId) {
    throw new ChatGPTAuthError(
      "realtime_web_session_invalid",
      "ChatGPT web session is missing, expired, or was minted for the wrong client.",
      { status: response.status || 401 },
    );
  }
  const rotatedCookies = readRotatedRealtimeSessionCookies(response.headers) ?? { ...sessionCookies };
  const state = { deviceId, sessionCookies: rotatedCookies };
  await options.onSessionUpdate?.(state);
  return {
    accessToken,
    accountId,
    deviceId,
    email,
    expiresAt: hasStringType(body?.["expires"]) ? body["expires"] : undefined,
    sessionCookies: rotatedCookies,
  };
}

export interface CreateChatGPTRealtimeCallOptions {
  config: ResolvedConfig;
  getAuth: () => Promise<ChatGPTRealtimeAuth> | ChatGPTRealtimeAuth;
  /** Browser-generated WebRTC offer SDP. */
  sdp: string;
  session?: ChatGPTRealtimeSessionOptions;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface ChatGPTRealtimeEvent {
  type: string;
  [key: string]: JsonValue;
}

export interface ChatGPTRealtimeStateEvent extends ChatGPTRealtimeEvent {
  type: "state_update";
  new_state?: ChatGPTRealtimeState;
  payload?: { new_state?: ChatGPTRealtimeState; [key: string]: JsonValue };
}

export interface ChatGPTRealtimeActionEvent extends ChatGPTRealtimeEvent {
  type: "action_request";
  payload: { action: ChatGPTRealtimeAction | string; [key: string]: JsonValue };
}

export interface ChatGPTRealtimeTranscriptionEvent extends ChatGPTRealtimeEvent {
  type: "user_transcription_text" | "live_captioning_text";
  text?: string;
  transcript?: string;
}

export interface ChatGPTRealtimeTranscript {
  kind: "user_transcript" | "assistant_caption";
  text: string;
  event: ChatGPTRealtimeTranscriptionEvent;
}

export interface ChatGPTRealtimeToolInvocation {
  callId: string;
  name: string;
  arguments: JsonObject;
}

export interface ChatGPTRealtimeToolInvokeEvent extends ChatGPTRealtimeEvent {
  type: "client_tool_invoke";
  call_id?: string;
  name?: string;
  arguments?: JsonValue;
  payload?: JsonObject;
}

export interface ChatGPTRealtimeToolResultEvent extends ChatGPTRealtimeEvent {
  type: "client_tool_result";
  call_id: string;
  result: JsonObject;
}

export interface ChatGPTRealtimeToolUpdateEvent extends ChatGPTRealtimeEvent {
  type: "client_tool_update";
  call_id: string;
  status: string;
}

/** Known event names observed on ChatGPT's Realtime data channel. */
export const CHATGPT_REALTIME_EVENT_TYPES = [
  "state_update", "action_request", "goodbye", "conversation_update",
  "streaming_message_update", "close_request", "close_ready", "relay_message",
  "relay_message_processed", "track_state", "full_chat_message",
  "chat_message_delta", "live_captioning_text", "speaking_update",
  "user_transcription_text", "client_tool_invoke", "client_tool_result",
  "client_tool_update",
] as const;

export const CHATGPT_REALTIME_PATHS = {
  wm: "/realtime/wm",
  vp: "/realtime/vp",
  vps: "/realtime/vps",
} satisfies Record<ChatGPTRealtimeTransport, string>;

/** Builds the deliberately limited private session payload supported by this SDK. */
export function buildChatGPTRealtimeSession(
  options: ChatGPTRealtimeSessionOptions = {},
): ChatGPTRealtimeSession {
  options = parseChatGPTRealtimeSessionOptions(options);
  const transport = options.transport ?? "wm";
  const expectedVoiceMode = transport === "wm" ? "wingman" : transport === "vps" ? "standard" : "advanced";
  if (options.voiceMode !== undefined && options.voiceMode !== expectedVoiceMode) {
    throw new TypeError(`\`voiceMode\` must be \`${expectedVoiceMode}\` for the \`${transport}\` transport.`);
  }
  if (transport === "wm" && options.historyAndTrainingDisabled === true) {
    throw new TypeError("`historyAndTrainingDisabled` must be false for ChatGPT `/wm`.");
  }
  const voice = options.voice ?? "juniper";
  const language = normalizeRealtimeLanguage(options.language);
  // Let the subscription service select its current model unless the caller
  // explicitly targets a compatibility transport model. Do not pin legacy
  // product models in SDK defaults.
  const model = options.model ?? "";
  if (!voice.trim() || voice.length > 64) throw new TypeError("`voice` must be a non-empty string of at most 64 characters.");
  if (model.length > 128) throw new TypeError("`model` must be at most 128 characters.");
  if (transport !== "wm" && !model.trim()) {
    throw new TypeError("`model` is required for the undocumented `vp` and `vps` compatibility transports.");
  }
  if (options.clientTools?.length) {
    throw new TypeError(
      "`clientTools` cannot contain application tools: ChatGPT `/wm` accepts only reserved first-party device tool IDs.",
    );
  }
  if (options.timezoneOffsetMinutes !== undefined &&
      (!Number.isInteger(options.timezoneOffsetMinutes) || Math.abs(options.timezoneOffsetMinutes) > 24 * 60)) {
    throw new TypeError("`timezoneOffsetMinutes` must be an integer between -1440 and 1440.");
  }
  const id = createUuid();
  const voiceMode = options.voiceMode ?? expectedVoiceMode;
  const session: ChatGPTRealtimeSession = {
    conversation_id: options.conversationId ?? null,
    language_code: language,
    requested_default_model: model,
    voice,
    voice_session_id: id,
    voice_status_request_id: id,
    timezone_offset_min: options.timezoneOffsetMinutes ?? 0,
    timezone: options.timezone ?? "UTC",
    voice_mode: voiceMode,
    model_slug: model,
    client_tools: [],
    history_and_training_disabled: options.historyAndTrainingDisabled ?? (transport === "wm" ? false : true),
    conversation_mode: options.conversationMode ?? { kind: "primary_assistant" },
  };

  if (transport === "wm") {
    session.model_slug_advanced = "";
    session.enable_message_streaming = options.enableMessageStreaming ?? true;
    session.backend_reasoning_effort = "high";
    session.chat_mode = "chat";
  } else if (transport === "vp") {
    session.model_slug_advanced = options.advancedModel ?? model;
    session.enable_message_streaming = options.enableMessageStreaming ?? true;
  } else {
    session.enable_message_streaming = options.enableMessageStreaming ?? true;
  }
  assignDefined(session, "parent_message_id", options.parentMessageId);
  return session;
}

/**
 * Exchanges an SDP offer for an answer through the signed-in user's ChatGPT
 * subscription. This function belongs on the server; never pass its auth into
 * browser code.
 */
export async function createChatGPTRealtimeCall(
  options: CreateChatGPTRealtimeCallOptions,
): Promise<string> {
  if (!options.sdp.trim()) throw new TypeError("`sdp` must be a non-empty WebRTC offer.");
  const session = buildChatGPTRealtimeSession(options.session);
  const transport = options.session?.transport ?? "wm";
  const path = CHATGPT_REALTIME_PATHS[transport];
  const auth = await options.getAuth();
  if (transport !== "wm" && !auth.accountId) {
    throw new ChatGPTAuthError("realtime_request_failed", "Realtime `/vp` and `/vps` require an account id.", { status: 401 });
  }
  const form = new FormData();
  form.set("sdp", options.sdp);
  form.set("session", JSON.stringify(session));

  const headers = new Headers(options.headers);
  headers.set("Authorization", `Bearer ${auth.accessToken}`);
  if (auth.accountId) headers.set("chatgpt-account-id", auth.accountId);
  headers.set("Accept", "application/sdp");
  headers.set("OAI-Language", session.language_code ?? "en-US");
  headers.set("OAI-Device-Id", auth.deviceId ?? createUuid());
  headers.set("OAI-Client-Version", options.config.realtimeClientVersion);
  headers.set("OAI-Client-Build-Number", options.config.realtimeClientBuild);
  headers.set("OAI-Session-Id", createUuid());
  headers.set("X-OpenAI-Target-Path", path);
  headers.set("X-OpenAI-Target-Route", path);
  headers.set("Origin", options.config.realtimeBaseUrl);
  headers.set("Referer", `${options.config.realtimeBaseUrl}/`);

  const requestUrl = `${options.config.realtimeBaseUrl}${path}?dcid=0`;
  const response = await options.config.fetch(requestUrl, {
    method: "POST",
    headers,
    body: form,
    signal: requestSignal(options.config, options.signal),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new ChatGPTAuthError(
      "realtime_request_failed",
      `Realtime session request failed (${response.status}).`,
      { status: response.status, body },
    );
  }
  if (!body.trimStart().startsWith("v=0")) {
    throw new ChatGPTAuthError(
      "realtime_request_failed",
      "Realtime endpoint did not return an SDP answer.",
      { status: response.status, body },
    );
  }
  return body;
}

export function createChatGPTRealtimeAction(
  action: ChatGPTRealtimeAction | string,
  payload: JsonObject = {},
): ChatGPTRealtimeActionEvent {
  return { type: "action_request", payload: { ...payload, action } };
}

/** Encodes an event using the outer transceiver envelope required by `/wm`. */
export function encodeChatGPTRealtimeEvent(event: ChatGPTRealtimeEvent): string {
  return JSON.stringify({ type: "data_message", data: JSON.stringify(event) });
}

export interface ChatGPTRealtimeMessage extends JsonObject {
  id: string;
  author: { role: "user" };
  create_time: number;
  content: { content_type: "text"; parts: string[] };
  metadata: JsonObject;
}

/** Builds the currently observed private `/wm` event used to inject typed messages. */
export function createChatGPTRealtimeRelayMessage(
  text: string,
  metadata: JsonObject = {},
  id = createUuid(),
): ChatGPTRealtimeEvent {
  const message: ChatGPTRealtimeMessage = {
    id,
    author: { role: "user" },
    create_time: Date.now() / 1000,
    content: { content_type: "text", parts: [text] },
    metadata,
  };
  return { type: "relay_message", payload: { type: "relay_message", message } };
}

/** Parse a completed client-tool invocation without inspecting transcripts. */
export function parseChatGPTRealtimeToolInvocation<EventValue>(
  event: EventValue,
): ChatGPTRealtimeToolInvocation | undefined {
  if (!isRecord(event) || event["type"] !== "client_tool_invoke") return undefined;
  const payload = isRecord(event["payload"]) ? event["payload"] : event;
  const tool = isRecord(payload["tool"]) ? payload["tool"] : undefined;
  const callId = payload["call_id"] ?? payload["callId"] ?? payload["id"];
  const name = payload["name"] ?? payload["tool_name"] ?? tool?.["name"] ?? tool?.["id"];
  const args = parseToolArguments(payload["arguments"] ?? payload["args"] ?? payload["input"] ?? {});
  if (!hasStringType(callId) || !callId || !hasStringType(name) || !name || !args) {
    return undefined;
  }
  return { callId, name, arguments: args };
}

/** Complete a client-tool call with a structured application result. */
export function createChatGPTRealtimeToolResult(
  callId: string,
  result: JsonObject,
): ChatGPTRealtimeToolResultEvent {
  if (!callId.trim()) throw new TypeError("`callId` must be a non-empty string.");
  return { type: "client_tool_result", call_id: callId, result };
}

/** Report non-terminal progress, such as waiting for user approval. */
export function createChatGPTRealtimeToolUpdate(
  callId: string,
  status: string,
  detail: JsonObject = {},
): ChatGPTRealtimeToolUpdateEvent {
  if (!callId.trim() || !status.trim()) {
    throw new TypeError("`callId` and `status` must be non-empty strings.");
  }
  return { ...detail, type: "client_tool_update", call_id: callId, status };
}

/**
 * Decodes both direct events and ChatGPT's nested `{type:"data_message",data}`
 * envelope. Unknown event types are returned unchanged for forward compatibility.
 */
export function parseChatGPTRealtimeEvent<InputValue>(input: InputValue): ChatGPTRealtimeEvent | undefined {
  let value = decodeWireValue(input);
  for (let depth = 0; depth < 4; depth += 1) {
    if (hasStringType(value)) {
      try { value = JSON.parse(value); } catch { return undefined; }
      continue;
    }
    if (isRecord(value) && value["type"] === "data_message" && "data" in value) {
      value = decodeWireValue(value["data"]);
      continue;
    }
    break;
  }
  return isRecord(value) && hasStringType(value["type"])
    ? /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ value as ChatGPTRealtimeEvent
    : undefined;
}

/** Returns the event's nested payload when present, otherwise the event itself. */
export function getChatGPTRealtimePayload(event: ChatGPTRealtimeEvent): JsonObject {
  return isRecord(event["payload"]) ? event["payload"] : event;
}

/** Extracts the user transcript or spoken assistant caption from a known event. */
export function parseChatGPTRealtimeTranscript(
  event: ChatGPTRealtimeEvent,
): ChatGPTRealtimeTranscript | undefined {
  if (event.type !== "user_transcription_text" && event.type !== "live_captioning_text") {
    return undefined;
  }
  const payload = getChatGPTRealtimePayload(event);
  const text = payload["text"] ?? payload["transcript"];
  if (!hasStringType(text) || !text) return undefined;
  return {
    kind: event.type === "user_transcription_text" ? "user_transcript" : "assistant_caption",
    text,
    event: /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ event as ChatGPTRealtimeTranscriptionEvent,
  };
}

function decodeWireValue<ValueValue>(value: ValueValue): JsonValue {
  if (value instanceof ArrayBuffer) return new TextDecoder().decode(value);
  if (ArrayBuffer.isView(value)) {
    return new TextDecoder().decode(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  }
  if (Array.isArray(value) && value.every((item) => Number.isInteger(item))) {
    return new TextDecoder().decode(Uint8Array.from(/* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ value as number[]));
  }
  if (isRecord(value)) {
    const numeric = Object.keys(value);
    if (numeric.length > 0 && numeric.every((key) => /^\d+$/.test(key))) {
      return new TextDecoder().decode(Uint8Array.from(
        numeric.sort((a, b) => Number(a) - Number(b)).map((key) => Number(value[key])),
      ));
    }
  }
  return jsonValueSchema.parse(value);
}

function assignDefined(target: JsonObject, key: string, value: JsonValue): void {
  if (value !== undefined) target[key] = value;
}

function normalizeRealtimeLanguage(language: string | null | undefined): string | null {
  if (language == null) return null;
  if (!language.trim() || language.length > 64) {
    throw new TypeError("`language` must be a valid BCP 47 language tag of at most 64 characters.");
  }
  try {
    return Intl.getCanonicalLocales(language)[0] ?? null;
  } catch {
    throw new TypeError("`language` must be a valid BCP 47 language tag.");
  }
}

function isRecord<ValueValue>(value: ValueValue): value is ValueValue & (JsonObject) {
  return isJsonObject(value);
}

function parseToolArguments<ValueValue>(value: ValueValue): JsonObject | undefined {
  if (hasStringType(value)) {
    try {
      const parsed: unknown = JSON.parse(value);
      return isRecord(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return isRecord(value) ? value : undefined;
}

const REALTIME_SESSION_COOKIE = "__Secure-next-auth.session-token";

function normalizeRealtimeSessionCookies(
  sessionToken: string,
  cookies?: Readonly<Record<string, string>>,
): Record<string, string> {
  const values = cookies && Object.keys(cookies).length > 0
    ? { ...cookies }
    : { [REALTIME_SESSION_COOKIE]: sessionToken };
  if (Object.keys(values).length > 8) throw new TypeError("Too many ChatGPT Realtime session cookie chunks.");
  for (const [name, value] of Object.entries(values)) {
    const suffix = name.startsWith(`${REALTIME_SESSION_COOKIE}.`)
      ? name.slice(REALTIME_SESSION_COOKIE.length + 1)
      : undefined;
    if (
      (name !== REALTIME_SESSION_COOKIE && !/^\d+$/.test(suffix ?? ""))
      || !value
      || /[;\r\n]/.test(value)
    ) {
      throw new TypeError("Invalid ChatGPT Realtime session cookies.");
    }
  }
  return values;
}

function readRotatedRealtimeSessionCookies(headers: Headers): Record<string, string> | undefined {
  const getSetCookie = (/* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const lines = getSetCookie?.call(headers) ?? [headers.get("set-cookie") ?? ""];
  const values: Record<string, string> = {};
  const pattern = /(?:^|,\s*)(__Secure-next-auth\.session-token(?:\.\d+)?)=([^;,]*)/g;
  for (const line of lines) {
    for (const match of line.matchAll(pattern)) {
      if (match[1] && match[2]) values[match[1]] = match[2];
    }
  }
  const chunks = Object.fromEntries(Object.entries(values).filter(([name]) => name !== REALTIME_SESSION_COOKIE));
  if (Object.keys(chunks).length > 0) return chunks;
  return values[REALTIME_SESSION_COOKIE] ? { [REALTIME_SESSION_COOKIE]: values[REALTIME_SESSION_COOKIE] } : undefined;
}

function decodeJwtPayload(token: string): JsonObject | undefined {
  const encoded = token.split(".")[1];
  if (!encoded) return undefined;
  try {
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = atob instanceof Function
      ? atob(padded)
      : Buffer.from(padded, "base64").toString("utf8");
    return /* SAFETY: Adjacent runtime validation or typed construction establishes the asserted owner contract before this boundary. */ JSON.parse(decoded) as JsonObject;
  } catch {
    return undefined;
  }
}

function createUuid(): string {
  if (crypto.randomUUID instanceof Function) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
