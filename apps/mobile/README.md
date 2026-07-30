# AutoPR Mobile

A small Expo/React Native shell that mirrors AutoPR's web landing theme. It is intentionally UI-only so authentication and Convex integration can be added against stable product requirements later.

## Commands

From the repository root:

```sh
pnpm --filter @autopr/mobile start
pnpm --filter @autopr/mobile android
pnpm --filter @autopr/mobile ios
pnpm --filter @autopr/mobile check-types
```

The app follows the device appearance setting and is configured for iOS and Android.
