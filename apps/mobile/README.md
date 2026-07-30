# AutoPR Mobile

The Expo client mirrors AutoPR's web workflow with a mobile-native project list,
thread chat, Git controls, terminal access, sandbox environment variables, pull
requests, settings, image prompts, and unified diff review. The remote desktop
surface is intentionally omitted.

The native theme mirrors the shared web tokens from `packages/ui`: neutral
canvas and surfaces, pale-magenta primary actions, matching operational colors,
and Inter typography. Appearance can follow the device or be pinned to Light or
Dark from Settings.

## Configuration

Copy `.env.example` to `.env` and set:

- `EXPO_PUBLIC_CONVEX_URL` to the same deployment used by `apps/web`.
- `EXPO_PUBLIC_WEB_URL` to a reachable HTTPS deployment of `apps/web`.

Add `autopr://auth/callback` to the Redirects list for the same WorkOS
application used by Convex. The mobile app uses PKCE; the web backend performs
the confidential code exchange and refreshes the session tokens.

The web deployment must also have its existing `WORKOS_CLIENT_ID`,
`WORKOS_API_KEY`, and Convex configuration.

## Run

Use `pnpm --filter @autopr/mobile start`. A development build is recommended
for testing the custom `autopr://` authentication callback.
