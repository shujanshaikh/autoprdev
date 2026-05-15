# AGENTS.md

## Task Completion Requirements

- Use `pnpm` for this workspace.
- For type validation, run `pnpm run check-types`.
- Do **not** repeatedly run build or dev commands.
- Do **not** run `pnpm build`, `pnpm run build`, `pnpm dev`, `pnpm run dev`, `pnpm run dev:web`, `pnpm run dev:server`, or `pnpm run dev:setup` unless the user explicitly asks for it.
- Assume the dev server/Convex dev process may already be running. Do not start another one.

## Project Snapshot

AutoPR is a TypeScript monorepo built with Better-T-Stack, TanStack Start, Convex, Clerk, TailwindCSS, shadcn/ui, and Turborepo.

This repository is an active WIP. Prefer improvements that make the codebase easier to maintain, reason about, and extend.

## Core Priorities

1. Correctness and reliability first.
2. Maintain predictable behavior during failures, retries, reconnects, and long-running work.
3. Keep frontend and backend boundaries clear.
4. Prefer shared, typed abstractions over duplicated local logic.

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Architecture Guidance

- Prefer Convex backend functions for server-side behavior.
- Create or update Convex `queries`, `mutations`, or `actions` in `packages/backend/convex` wherever appropriate.
- Avoid creating Next.js-style API routes or other ad-hoc API routes. Only add an API route when there is an explicit technical requirement that cannot be handled cleanly by Convex.
- Keep runtime backend logic out of schema/contract-only modules.
- Extract shared logic into packages when it is used in more than one place.

## Package Roles

- `apps/web`: TanStack Start React app. Owns UI, routes, client state, Clerk integration, and connections to Convex/backend functionality.
- `packages/backend`: Convex backend. Owns Convex schema, queries, mutations, actions, and backend integrations.
- `packages/agent`: Agent runtime/tools code shared with the app.
- `packages/ui`: Shared shadcn/ui components, hooks, styles, and UI utilities.
- `packages/config`: Shared TypeScript/configuration used by packages.
- `packages/env`: Shared environment typing/utilities if needed by the workspace.

## Maintainability

- Before adding new functionality, check for existing shared logic that can be reused or extracted.
- Avoid duplicating logic across files or packages.
- Prefer small, focused modules with explicit exports.
- Do not take shortcuts by adding one-off local logic when a reusable abstraction is warranted.
- Keep TypeScript types strict and meaningful; avoid `any` unless there is a clear and documented reason.

## Frontend Guidelines

- Use TanStack Start/TanStack Router conventions in `apps/web`.
- Use shared UI primitives from `@autopr/ui` when possible.
- Keep app-specific components in `apps/web`; move reusable primitives to `packages/ui`.
- Preserve existing styling conventions with TailwindCSS and shadcn/ui.

## Convex Guidelines

- Put data reads in Convex queries, writes in mutations, and external/long-running side effects in actions.
- Validate inputs and keep Convex function boundaries typed.
- Keep business logic close to the Convex function when it is backend-specific; extract only genuinely shared logic.
- Avoid bypassing Convex with separate HTTP endpoints unless explicitly required.
