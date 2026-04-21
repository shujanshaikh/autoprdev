# GitHub Project Sandboxes With Persistent Threads

## Summary

Build a repo-first dashboard flow:

- `/dashboard` shows an authenticated GitHub URL input.
- Submitting a public GitHub repo URL creates or reuses a Convex `project`.
- For a new repo, the server creates a Daytona sandbox, clones the repo into it, stores the sandbox metadata on the project, then redirects to `/project/[projectId]`.
- `/project/[projectId]` is the project overview, showing repo/sandbox status and threads for that project.
- Each thread lives at `/project/[projectId]/thread/[threadId]`.
- Every thread under a project reuses the same Daytona sandbox.
- User and assistant messages are persisted in Convex and rendered back into the chat UI.

## Confirmed Product Decisions

- Repo support: public GitHub repositories only.
- Redirect after create: `/project/[projectId]` overview.
- Duplicate repo behavior: reuse the existing project and sandbox for the signed-in user.

## References Consulted

- AI SDK `createUIMessageStream` supports `originalMessages` and `onFinish` for persistence-oriented UI message streams: https://ai-sdk.dev/docs/reference/ai-sdk-ui/create-ui-message-stream
- AI SDK `useChat` transport customization uses `prepareSendMessagesRequest`: https://ai-sdk.dev/docs/ai-sdk-ui/transport
- Daytona TypeScript SDK supports creating sandboxes and cloning Git repos with `sandbox.git.clone`: https://www.daytona.io/docs/en/getting-started/
- Convex recommends argument validators and access control for public functions: https://docs.convex.dev/functions/validation and https://docs.convex.dev/understanding/best-practices

## Data Model

Update `packages/backend/convex/schema.ts` with these tables.

### `projects`

Fields:

- `authorId: string`
- `githubUrl: string`
- `cloneUrl: string`
- `repoFullName: string`
- `repoOwner: string`
- `repoName: string`
- `repoBranch?: string`
- `sandboxCacheKey: string`
- `sandboxId?: string`
- `sandboxName?: string`
- `sandboxSnapshot?: string`
- `sandboxWorkDir?: string`
- `sandboxStatus: "creating" | "ready" | "failed"`
- `sandboxError?: string`
- `createdAt: number`
- `updatedAt: number`
- `lastOpenedAt?: number`

Indexes:

- `by_author: ["authorId"]`
- `by_author_repo: ["authorId", "repoFullName"]`

### `threads`

Fields:

- `projectId: v.id("projects")`
- `authorId: string`
- `title: string`
- `createdAt: number`
- `updatedAt: number`
- `currentRunId?: string`
- `isLive?: boolean`

Indexes:

- `by_project: ["projectId"]`
- `by_author_project: ["authorId", "projectId"]`

### `messages`

Fields:

- `threadId: v.id("threads")`
- `projectId: v.id("projects")`
- `authorId: string`
- `messageId: string`
- `role: "system" | "user" | "assistant"`
- `parts: v.array(v.any())`
- `metadata?: v.any()`
- `createdAt: number`
- `updatedAt: number`

Indexes:

- `by_thread: ["threadId"]`
- `by_message_id: ["messageId"]`
- `by_project: ["projectId"]`

Use `v.any()` only for AI SDK message parts and metadata so AI SDK 6 tool/reasoning/data part shapes are preserved without lossy conversion.

## Convex Functions

Add `packages/backend/convex/lib/auth.ts`:

- `requireUserId(ctx)` returns `ctx.auth.getUserIdentity().subject`.
- Throws `ConvexError({ code: "UNAUTHORIZED" })` if signed out.

Add `packages/backend/convex/projects.ts`:

- `ensureForGithubRepo`
  - Public mutation.
  - Args: normalized repo fields.
  - If `by_author_repo` exists, patch `lastOpenedAt` and return `{ projectId, created: false, sandboxStatus }`.
  - Otherwise insert project with `sandboxStatus: "creating"` and return `{ projectId, created: true, sandboxStatus: "creating" }`.

- `markSandboxReady`
  - Public mutation called by authenticated Next API route.
  - Verifies project owner.
  - Stores `sandboxId`, `sandboxName`, `sandboxSnapshot`, `sandboxWorkDir`, `sandboxStatus: "ready"`.

- `markSandboxFailed`
  - Public mutation called by authenticated Next API route.
  - Verifies project owner.
  - Stores `sandboxStatus: "failed"` and a short error message.

- `get`
  - Public query.
  - Args: `projectId`.
  - Returns project only if current user owns it.

- `list`
  - Public query.
  - Lists current user’s projects newest first.

Add `packages/backend/convex/threads.ts`:

- `create`
  - Public mutation.
  - Args: `projectId`, optional `title`.
  - Verifies project ownership.
  - Inserts a thread under the project.

- `listByProject`
  - Public query.
  - Verifies project ownership.
  - Returns project threads ordered desc.

- `get`
  - Public query.
  - Verifies thread ownership.

- `markRunStarted`
  - Public mutation.
  - Sets `currentRunId` and `isLive: true`.

- `markRunFinished`
  - Public mutation.
  - Clears `currentRunId` and sets `isLive: false`.

Add `packages/backend/convex/messages.ts`:

- `listByThread`
  - Public query.
  - Verifies thread/project ownership.
  - Returns messages ordered asc.

- `createTurn`
  - Public mutation.
  - Args: `projectId`, `threadId`, `userMessage`, `assistantMessageId`.
  - Verifies ownership.
  - Inserts user message and empty assistant placeholder.

- `patchAssistant`
  - Public mutation.
  - Args: `threadId`, `assistantMessageId`, `parts`, optional `metadata`.
  - Verifies ownership.
  - Patches the assistant message after stream completion.

## Daytona Package And Sandbox Helpers

Update `packages/agent` to use the renamed Daytona SDK package:

- Replace dependency `@daytonaio/sdk` with `@daytona/sdk`.
- Update import in `packages/agent/src/sandbox/index.ts`.

Export a plain server helper from `@autopr/agent`:

- `bootstrapRepositorySandbox(options)`
  - Args: `cacheKey`, `repoUrl`, optional `repoBranch`, optional `snapshot`.
  - Calls existing `getSandboxContext`.
  - Returns `{ sandboxId, sandboxName, snapshot, workDir }`.
  - Used by the Next project creation API route.

Update `SandboxSessionOptions` usage so workflows can reuse a project sandbox:

- Support `sandboxId`.
- Support `repoUrl` and `repoBranch`.
- Keep clone idempotent via `sandbox.git.status("repo")`, otherwise `sandbox.git.clone(repoUrl, "repo", repoBranch)`.

## GitHub URL Normalization

Add a shared helper in `apps/web/src/lib/github-url.ts`:

- Accept:
  - `https://github.com/owner/repo`
  - `https://github.com/owner/repo.git`
  - Optional trailing slash
  - Optional `/tree/[branch]` branch URLs
- Reject:
  - Non-GitHub URLs
  - SSH URLs for the first implementation
  - Missing owner/repo
- Return:
  - `githubUrl`
  - `cloneUrl: https://github.com/owner/repo.git`
  - `repoFullName: owner/repo` lowercased for duplicate detection
  - `repoOwner`
  - `repoName`
  - optional `repoBranch`

## Next API Routes

Add `apps/web/src/app/api/projects/route.ts`:

- `POST { githubUrl }`
- Require Clerk auth using `auth()` from `@clerk/nextjs/server`.
- Get Clerk Convex JWT with `getToken({ template: "convex" })`.
- Use `ConvexHttpClient` with that token.
- Normalize GitHub URL.
- Call `api.projects.ensureForGithubRepo`.
- If existing project is returned, respond `{ projectId, reused: true }`.
- If new project:
  - Call `bootstrapRepositorySandbox({ cacheKey: projectId, repoUrl: cloneUrl, repoBranch })`.
  - On success call `api.projects.markSandboxReady`.
  - On failure call `api.projects.markSandboxFailed` and return a user-facing error.

Add `apps/web/src/app/api/project/[projectId]/thread/[threadId]/agent/route.ts`:

- `POST { message }`, where `message` is the last AI SDK 6 `UIMessage`.
- Require Clerk auth and Convex JWT.
- Fetch project and thread through Convex to verify access and sandbox readiness.
- Generate `assistantMessageId`.
- Call `api.messages.createTurn`.
- Fetch full persisted thread history with `api.messages.listByThread`.
- Convert DB rows to AI SDK `UIMessage[]`, then to model messages with `convertToModelMessages`.
- Start `agentWorkflow` with:
  - model messages
  - `projectId`
  - `threadId`
  - `sandboxCacheKey`
  - `sandboxId`
  - `repoUrl`
  - `repoBranch`
  - `assistantMessageId`
- Call `api.threads.markRunStarted` with the workflow run ID.
- Tee the workflow stream:
  - One stream goes to `createUIMessageStreamResponse`.
  - The other is consumed with `readUIMessageStream`.
  - Final assistant parts are saved via `api.messages.patchAssistant`.
  - Then call `api.threads.markRunFinished`.

Keep `apps/web/src/app/api/agent/[id]/stream/route.ts` for workflow run resumption.

## Workflow Changes

Update `apps/web/src/workflows/agent/workflow.ts`:

- `AgentWorkflowOptions` includes:
  - `projectId`
  - `threadId`
  - `sandboxCacheKey`
  - `sandboxId`
  - `repoUrl`
  - `repoBranch`
  - `assistantMessageId`

- Build sandbox options with `sandboxId`, `cacheKey`, `repoUrl`, and `repoBranch`.
- Before `agent.stream`, write a `start` chunk with `messageId: assistantMessageId`.
- Call `agent.stream({ sendStart: false, ... })` so the UI message ID matches the Convex assistant placeholder.
- Keep `maxSteps: 12`.
- Keep existing Daytona tools and system prompt, but append repo context:
  - sandbox ID
  - repo URL
  - workdir
  - project/thread identifiers

## Frontend Routes

### `/dashboard`

Replace the placeholder with:

- Authenticated dashboard shell.
- GitHub URL input.
- Submit button labeled “Create sandbox”.
- Existing projects list from `api.projects.list`.
- Loading state while sandbox is creating/cloning.
- Error state for invalid URL or clone failure.
- On success, `router.push("/project/" + projectId)`.

### `/project/[projectId]`

Create project overview page:

- Query `api.projects.get`.
- Query `api.threads.listByProject`.
- Show repo name, clone URL, sandbox status, sandbox ID when ready.
- If sandbox is `creating`, show progress copy and disable new thread creation.
- If `failed`, show error and a link back to dashboard.
- If `ready`, show:
  - “New thread” button calling `api.threads.create`, then redirecting to `/project/[projectId]/thread/[threadId]`.
  - Existing thread list linking to thread routes.

### `/project/[projectId]/thread/[threadId]`

Create project thread chat page by adapting `apps/web/src/app/agent/page.tsx`:

- Query project, thread, and `api.messages.listByThread`.
- Convert Convex messages into AI SDK 6 `UIMessage[]`.
- Use `useChat` with:
  - `id: threadId`
  - `messages: persistedMessages`
  - `resume: Boolean(thread.currentRunId)`
  - `WorkflowChatTransport`
  - `api: /api/project/${projectId}/thread/${threadId}/agent`
  - `prepareSendMessagesRequest` sending only `{ message: messages[messages.length - 1] }`
  - `prepareReconnectToStreamRequest` using `/api/agent/${thread.currentRunId}/stream`
- Render messages with the existing AI Elements components.
- Keep tool/reasoning rendering from the existing agent page.
- Add project-aware header and link back to `/project/[projectId]`.

## UI Direction

Use the existing app’s restrained technical style:

- Keep the teal/monospace durable workflow visual language already used in `agent/page.tsx`.
- Avoid a marketing landing page.
- Dashboard should feel like an operational console: URL input, create action, recent projects, clear status.
- Project overview should be compact and scan-friendly.
- Thread page should prioritize chat and tool output.

## Error Handling

- Invalid GitHub URL: client-side validation plus API-side validation.
- Unauthenticated API call: return `401`.
- Existing project reuse: no Daytona call.
- Clone failure:
  - Mark project `failed`.
  - Show failure in dashboard/project UI.
- Project not ready:
  - Thread creation disabled.
  - Chat POST returns `409`.
- Unauthorized project/thread access:
  - Convex returns null for queries.
  - Mutations throw `ConvexError({ code: "UNAUTHORIZED" })`.

## Tests And Verification

Run after implementation:

- `pnpm --filter @autopr/backend exec convex codegen`
- `pnpm check-types`
- `pnpm --filter web build`

Manual scenarios:

- Signed-out dashboard shows sign-in.
- Invalid GitHub URL is rejected.
- Public repo URL creates project, creates Daytona sandbox, clones repo, redirects to `/project/[projectId]`.
- Submitting the same repo again reuses the same project and does not create a new sandbox.
- Project overview can create a thread and route to `/project/[projectId]/thread/[threadId]`.
- First user message streams an assistant response.
- Refreshing after completion shows persisted user and assistant messages.
- Second thread under same project reuses the same `sandboxId`.
- Existing thread sends another message and includes previous thread messages as model context.
- Tool output/reasoning parts render without crashing.
- Clone failure marks project failed and shows a recoverable UI state.

## Explicit Assumptions

- Public GitHub repositories only for this pass; no PAT, SSH, or Clerk GitHub OAuth token handling.
- A project means one signed-in user plus one normalized GitHub repo.
- One project owns one Daytona sandbox.
- Threads under the same project share that sandbox but keep separate message histories.
- Assistant messages are persisted after the workflow stream finishes.
- During streaming, the live UI comes from the workflow stream; Convex becomes source of truth after completion.
- The old `/agent` page can remain as a standalone demo unless the implementer chooses to link away from it.
