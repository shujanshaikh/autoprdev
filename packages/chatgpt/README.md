# `@autopr/chatgpt`

AutoPR's internal Login with ChatGPT implementation. It owns the complete
authentication and transport stack so the application does not depend on the
published `loginwithchatgpt` packages.

## Entry points

- `@autopr/chatgpt/core` — OAuth, PKCE, device authorization, token refresh,
  JWT parsing, Codex transport, and browser Realtime clients.
- `@autopr/chatgpt/server` — cookie-backed sessions, encrypted persistence,
  the HTTP handler/proxy, rate limiting, and app-server Realtime support.
- `@autopr/chatgpt/react` — the login hook, consent flow, and reusable login UI.
- `@autopr/chatgpt/ai` — direct and proxy Vercel AI SDK providers plus image
  generation/editing helpers.

The package root is an alias for the framework-independent core entry point.
Keep access and refresh tokens server-side; browser code should use the React
client and server proxy.
