# Autopr

Autopr is a cloud based coding agent platform similar to Cursor Cloud and Devin Cloud and serves web and mobile clients.

You can think of Autopr as an open source "bring-your-own-subscription" alternative to apps like Cursor Cloud and Devin Cloud.

### 1. Open at the core

Autopr is truly open. We share our roadmap, we share how we think about things, and of course we share all our code. We work in the open, and should strive to stay that way.

### 2. Multi-surface

Autopr has 2 key app surfaces: **web** and **mobile**.

**Web** is a kind of website that people will use to access Autopr features.

**Mobile** is a React Native app for both iOS and Android. The mobile app allows for connecting to server **backend** to control work remotely.

## A note from Theo

I like ambitious ideas, simple systems, and software that feels obvious. Do not preserve complexity just because it already exists. Do not introduce machinery because it looks architecturally impressive. Understand the real constraint, then fight for the smallest model that makes the correct behavior unsurprising.

Channel both "measure twice, cut once" and "yagni". Fight scope creep. Try to honor the dev's intent in both a minimal and realistic fashion.

## Pull requests

- Never make a PR unless the developer explicitly asks you to do so.
- Conventional commit titles, plain language: `fix(web): new threads no longer spike CPU`.
- Body: the problem in a sentence or two, then how you fixed it. End with the model and harness that did the work.
- UI changes need before/after images. Motion or timing needs a short video.
- Upload PR evidence to GitHub. Never commit PR-only screenshots or assets such as `.github/pr-assets/`.
- One concern per PR. If the description says "also", split it.

## Plans and work artifacts

- Do not commit implementation plans, research notes, or agent scratch files. Keep temporary working material outside the worktree. `.plans/` is gitignored only as a safety net for legacy tooling.
- A merged PR is the implementation record. Close or update its tracking item when the work lands; do not preserve a second checklist in the repository.

## How it works

Web and mobile subscribe to Convex for the live read model: projects, threads, messages, sandbox state, and git status. Starting a turn hits a TanStack Start API route. That route persists the messages, issues a short-lived _persistence grant_, and triggers a Trigger.dev _task_. The client then consumes the task's indexed stream and can reconnect from the last chunk.

The task runs `CodingHarness` from `@autopr/agent`. The harness prepares a Daytona sandbox, tools, and the system prompt, then leaves the model loop to Vercel AI SDK `streamText`. Codex and Grok credentials come from `@autopr/chatgpt` and `@autopr/grok`. Tools execute inside the VM: file edits, bash, FFF search, and CUA computer use. The worker patches assistant parts back to Convex through the grant.

Each thread owns a feature branch and, when needed, a git worktree in the sandbox. Commit, push, and pull request are a phased git workflow. Long threads compact with a conversation checkpoint so the model keeps a tail plus a summary.

## Where code lives

- `apps/web` - TanStack Start UI, WorkOS AuthKit, GitHub/OAuth cookie routes, and the Trigger.dev agent tasks. Vite + React. Put HTTP here only when Convex cannot: Trigger.dev, provider cookies, or signed sandbox previews.
- `apps/mobile` - Expo/React Native client on the same Convex deployment. Auth code exchange goes through the web app. No remote desktop.
- `packages/backend` - Convex schema, queries, mutations, and actions. Source of truth for projects, threads, messages, and sandbox cost. Prefer a Convex function over a new HTTP route.
- `packages/agent` - Daytona sandbox bootstrap, coding tools, step controller, and `CodingHarness`. No model runtime here.
- `packages/chatgpt` - Login with ChatGPT, Codex transport, and the AI SDK provider. Keep tokens on the server.
- `packages/grok` - xAI device/OAuth and the Grok AI SDK provider.
- `packages/ui` - Shared shadcn primitives and tokens. App-specific UI stays in `apps/web`.
- `packages/config` - Shared tsconfig and sandbox network policy.
- `infra/daytona/autopr` - The `autopr-cua` snapshot: Ubuntu desktop, CUA computer-server, FFF, ttyd. Rebuild the snapshot when this directory changes. Do not mutate it at runtime.

## Taste

- Complexity belongs at the adapter boundary. Orchestration stays pure, UI stays dumb.
- Inferred types over annotations. `any` is the enemy.
- Comments describe how a thing is used, and move when the code moves. To be used mostly to describe functions, not to annotate every line of behavior.
- Our users drive agents all day and notice a dropped frame, a lying spinner, and a stale label. No continuously repainting animations; they peg the GPU on high-refresh displays.
- If a rule here fights the task in front of you, say so loudly and get a human sign-off before breaking it.

## Additional tips

- Don't verify with browsers or computer use unless the user explicitly agrees or requests it.
- Security is important, but should not be over-indexed on, especially for dev mode/maintainer-only features.
