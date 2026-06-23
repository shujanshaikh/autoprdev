# autopr

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines TanStack Start, Convex, and more.

## Features

- **TypeScript** - For type safety and improved developer experience
- **TanStack Start** - Full-stack React framework
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **Shared UI package** - shadcn/ui primitives live in `packages/ui`
- **Convex** - Reactive backend-as-a-service platform
- **Authentication** - WorkOS AuthKit
- **Turborepo** - Optimized monorepo build system

## Getting Started

First, install the dependencies:

```bash
pnpm install
```

## Convex Setup

This project uses Convex as a backend. You'll need to set up Convex before running the app:

```bash
pnpm run dev:setup
```

Follow the prompts to create a new Convex project and connect it to your application.

Copy environment variables from `packages/backend/.env.local` to `apps/*/.env`.

### WorkOS AuthKit Setup

- Follow the Convex guide for [adding WorkOS AuthKit to an existing app](https://docs.convex.dev/auth/authkit/add-to-app) and use the **Standard WorkOS team** flow.
- In the WorkOS Dashboard, configure AuthKit redirect URIs and session CORS for the app origin. Local development uses `http://localhost:3001` and `http://localhost:3001/callback`.
- Set `WORKOS_CLIENT_ID` and `WORKOS_API_KEY` on the Convex deployment with `pnpm --filter @autopr/backend exec convex env set`.
- Set `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_COOKIE_PASSWORD`, `WORKOS_REDIRECT_URI`, and `VITE_CONVEX_URL` in `apps/web/.env`.
- Set `WORKOS_CLIENT_ID` in `packages/backend/.env.local` for local Convex auth config evaluation.

### Vercel + Convex deployment

This repo's Vercel project is configured with `apps/web` as the project root, so a normal Vercel build only bundles the TanStack Start app. Convex functions and `packages/backend/convex/auth.config.ts` are deployed separately by the Convex CLI.

`apps/web/vercel.json` makes Vercel run:

```bash
pnpm run build:vercel
```

That script delegates to:

```bash
pnpm --filter @autopr/backend run deploy:vercel
```

which runs `convex deploy --cmd "pnpm --filter web build" --cmd-url-env-var-name VITE_CONVEX_URL`. This deploys Convex first, then builds the web app with the Convex deployment URL injected into `VITE_CONVEX_URL`.

For production deploys, configure Vercel with:

- `CONVEX_DEPLOY_KEY`: a production deploy key from the Convex dashboard.
- `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_COOKIE_PASSWORD`, and `WORKOS_REDIRECT_URI`: the WorkOS values for the same WorkOS environment used by the Convex deployment.
- Any app runtime secrets such as `AI_GATEWAY_API_KEY`, `DAYTONA_API_KEY`, and `DAYTONA_API_URL`.

Also make sure the Convex deployment itself has `WORKOS_CLIENT_ID` set to the same WorkOS AuthKit client ID. If the web bundle uses one WorkOS app but the Convex deployment was never deployed or has a different `WORKOS_CLIENT_ID`, the browser will reconnect but Convex will log `No auth provider found matching the given token`.

Then, run the development server:

```bash
pnpm run dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser to see the web application.
Your app will connect to the Convex cloud backend automatically.

## UI Customization

React web apps in this stack share shadcn/ui primitives through `packages/ui`.

- Change design tokens and global styles in `packages/ui/src/styles/globals.css`
- Update shared primitives in `packages/ui/src/components/*`
- Adjust shadcn aliases or style config in `packages/ui/components.json` and `apps/web/components.json`

### Add more shared components

Run this from the project root to add more primitives to the shared UI package:

```bash
npx shadcn@latest add accordion dialog popover sheet table -c packages/ui
```

Import shared components like this:

```tsx
import { Button } from "@autopr/ui/components/button";
```

### Add app-specific blocks

If you want to add app-specific blocks instead of shared primitives, run the shadcn CLI from `apps/web`.

## Project Structure

```
autopr/
├── apps/
│   ├── web/         # Frontend application (TanStack Start)
├── packages/
│   ├── ui/          # Shared shadcn/ui components and styles
│   ├── backend/     # Convex backend functions and schema
│   │   ├── convex/    # Convex functions and schema
│   │   └── .env.local # Convex environment variables
```

## Available Scripts

- `pnpm run dev`: Start all applications in development mode
- `pnpm run build`: Build all applications
- `pnpm run dev:web`: Start only the web application
- `pnpm run dev:setup`: Setup and configure your Convex project
- `pnpm run check-types`: Check TypeScript types across all apps
