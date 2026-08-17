import { api } from "@autopr/backend/convex/_generated/api";
import type { ThreadGitStatus } from "@autopr/backend/convex/lib/gitStatus";
import { useQueryClient } from "@tanstack/react-query";
import { useQuery } from "convex/react";
import { useCallback, useMemo } from "react";

import { WebRequestError, webRequest } from "../api/web";
import { useAuth } from "../auth/AuthProvider";
import { createOperationId, createsPullRequest, resolveThreadGitActions, type ThreadGitAction } from "../lib/gitActions";
import { useWebQuery } from "./useWebQuery";

type GitStatusResponse = { status: ThreadGitStatus };

export type GitActionResult = {
  operationId?: string;
  status?: string;
  branch?: string;
  commitSha?: string;
  commitMessage?: string;
  url?: string;
  number?: number;
};

export type GitActionInput = {
  action: Exclude<ThreadGitAction, "view_pr">;
  operationId?: string;
  commitMessage?: string;
  pullRequestTitle?: string;
  pullRequestBody?: string;
  pullRequestDraft?: boolean;
};

export function threadGitStatusKey(projectId: string, threadId: string) {
  return ["git-status", projectId, threadId] as const;
}

/**
 * Git status plus the action runner shared by the Git sheets.
 *
 * The runner deliberately does not live in a react-query mutation: the commit
 * sheet dismisses itself the moment an action starts, and a workflow POST stays
 * open for the whole commit/push/PR run. Progress is read back from the
 * `gitOperations` record, which Convex keeps live across screens.
 */
export function useThreadGit(projectId: string, threadId: string) {
  const { getAccessToken } = useAuth();
  const queryClient = useQueryClient();
  const thread = useQuery(api.threads.get, { threadId });
  const latestOperation = useQuery(api.threads.getLatestGitOperation, { threadId });
  const operationRunning = latestOperation?.status === "running";
  const statusKey = threadGitStatusKey(projectId, threadId);
  const statusQuery = useWebQuery<GitStatusResponse>(
    statusKey,
    `/api/project/${encodeURIComponent(projectId)}/thread/${encodeURIComponent(threadId)}?gitStatus=1&refresh=1`,
    {
      staleTime: 5_000,
      refetchInterval: false,
      retry: false,
    },
  );

  const status = statusQuery.data?.status;
  const resolution = useMemo(() => resolveThreadGitActions(status), [status]);
  const agentRunning = Boolean(thread?.isLive);
  const busy = operationRunning || agentRunning;
  const blockedReason = agentRunning
    ? "Wait for the agent to finish before committing or changing this branch."
    : operationRunning
      ? "A Git operation is already running."
      : undefined;

  const run = useCallback(async (input: GitActionInput): Promise<GitActionResult> => {
    const operationId = input.operationId ?? createOperationId();
    const usesPullRequestEndpoint = createsPullRequest(input.action)
      && (input.pullRequestTitle || input.pullRequestBody || input.pullRequestDraft !== undefined);
    const path = `/api/project/${encodeURIComponent(projectId)}/thread/${encodeURIComponent(threadId)}${
      usesPullRequestEndpoint ? "/pull-request" : ""
    }`;
    const body = JSON.stringify({
      action: input.action,
      operationId,
      ...(usesPullRequestEndpoint
        ? {
            ...(() => {
  let optionalProperties;
  if (input.pullRequestTitle) optionalProperties = { title: input.pullRequestTitle };
  return optionalProperties;
})(),
            ...(() => {
  let optionalProperties;
  if (input.pullRequestBody) optionalProperties = { body: input.pullRequestBody };
  return optionalProperties;
})(),
            ...(() => {
  let optionalProperties;
  if (!(input.pullRequestDraft === undefined)) optionalProperties = { draft: input.pullRequestDraft };
  return optionalProperties;
})(),
          }
        : input.commitMessage ? { commitMessage: input.commitMessage } : {}),
    });

    const send = async (token: string) => await webRequest<GitActionResult>(path, token, {
      method: "POST",
      body,
    });

    const token = await getAccessToken();
    if (!token) throw new Error("Sign in to continue.");
    try {
      return await send(token);
    } catch (error) {
      if (!(error instanceof WebRequestError) || error.status !== 401) throw error;
      const refreshed = await getAccessToken(true);
      if (!refreshed) throw error;
      return await send(refreshed);
    } finally {
      // Invalidate through the app-scoped client so the refresh still happens
      // when the screen that started the action has already been dismissed.
      await queryClient.invalidateQueries({ queryKey: statusKey }).catch(() => undefined);
    }
  }, [getAccessToken, projectId, queryClient, statusKey, threadId]);

  const { refetch: refetchStatus } = statusQuery;
  const refresh = useCallback(async () => {
    await refetchStatus();
  }, [refetchStatus]);

  return {
    status,
    resolution,
    latestOperation,
    thread,
    busy,
    blockedReason,
    operationRunning,
    isLoading: statusQuery.isLoading,
    error: statusQuery.error,
    run,
    refresh,
  };
}
