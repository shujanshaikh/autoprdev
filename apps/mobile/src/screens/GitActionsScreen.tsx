import { api } from "@autopr/backend/convex/_generated/api";
import type { ThreadGitStatus } from "@autopr/backend/convex/lib/gitStatus";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "convex/react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  CircleAlert,
  FileDiff,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  RefreshCw,
  Rocket,
} from "lucide-react-native";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { webRequest } from "../api/web";
import { ErrorNotice, LoadingState, PrimaryButton, SecondaryButton } from "../components/ui";
import { useAppTheme } from "../hooks/useAppTheme";
import { useWebMutation, useWebQuery } from "../hooks/useWebQuery";
import type { RootStackParamList } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "GitActions">;

type GitAction =
  | "commit"
  | "push"
  | "create_pr"
  | "commit_push"
  | "push_create_pr"
  | "commit_push_create_pr"
  | "pull";

type ChangedFile = ThreadGitStatus["changedFiles"][number];
type GitStatusResponse = { status: ThreadGitStatus };
type GitOperationResponse = {
  operationId: string;
  status: "running" | "failed" | "succeeded" | "updated";
};

type ActionOption = {
  action: GitAction;
  label: string;
  description: string;
};

const actionLabels: Record<GitAction, string> = {
  commit: "Commit",
  push: "Push branch",
  create_pr: "Open pull request",
  commit_push: "Commit and push",
  push_create_pr: "Push and open PR",
  commit_push_create_pr: "Commit, push and open PR",
  pull: "Pull latest changes",
};

const fileKey = (file: ChangedFile) => file.path;

function createOperationId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

const ChangedFileRow = memo(function ChangedFileRow({ file }: { file: ChangedFile }) {
  const theme = useAppTheme();
  return (
    <View style={[styles.fileRow, { borderColor: theme.line, backgroundColor: theme.surface }]}>
      <FileDiff color={theme.muted} size={15} />
      <Text numberOfLines={1} style={[styles.filePath, { color: theme.ink }]}>{file.path}</Text>
      <Text style={[styles.fileStat, { color: theme.add }]}>+{file.additions ?? 0}</Text>
      <Text style={[styles.fileStat, { color: theme.delete }]}>−{file.deletions ?? 0}</Text>
    </View>
  );
});

function availableActions(status: GitStatusResponse["status"]): ActionOption[] {
  if (!status.isRepo || status.detachedHead || status.diverged) return [];
  const remoteAvailable = status.hasRemote && status.remoteStatus !== "unavailable";
  const behind = status.behindCount ?? 0;
  if (behind > 0) {
    if (status.hasWorkingTreeChanges || !status.hasUpstream || !remoteAvailable) return [];
    return [{ action: "pull", label: "Pull latest changes", description: "Update this branch from its remote." }];
  }
  if (status.hasWorkingTreeChanges) {
    return [
      { action: "commit", label: "Commit", description: "Save changes locally on this branch." },
      ...(remoteAvailable ? [{
        action: "commit_push" as const,
        label: "Commit and push",
        description: "Save changes and update the remote branch.",
      }] : []),
      ...(status.pullRequest || !remoteAvailable ? [] : [{
        action: "commit_push_create_pr" as const,
        label: "Commit, push and open PR",
        description: "Ship the complete change to GitHub for review.",
      }]),
    ];
  }
  const hasLocalCommits = (status.aheadCount ?? 0) > 0
    || (!status.hasUpstream && (status.aheadOfBaseCount ?? 0) > 0);
  if (hasLocalCommits) {
    if (!remoteAvailable) return [];
    return [
      { action: "push", label: "Push branch", description: "Publish local commits to GitHub." },
      ...(status.pullRequest ? [] : [{
        action: "push_create_pr" as const,
        label: "Push and open PR",
        description: "Publish commits and create a pull request.",
      }]),
    ];
  }
  const branchIsPushed = Boolean(
    status.localHeadSha
    && status.remoteHeadSha
    && status.localHeadSha === status.remoteHeadSha,
  );
  if (!status.pullRequest && (status.aheadOfBaseCount ?? 0) > 0 && branchIsPushed) {
    return [{ action: "create_pr", label: "Open pull request", description: "Create a pull request for this branch." }];
  }
  return [];
}

export function GitActionsScreen({ navigation, route }: Props) {
  const { projectId, threadId } = route.params;
  const theme = useAppTheme();
  const thread = useQuery(api.threads.get, { threadId });
  const latestOperation = useQuery(api.threads.getLatestGitOperation, { threadId });
  const git = useWebQuery<GitStatusResponse>(
    ["git-status", projectId, threadId],
    `/api/project/${encodeURIComponent(projectId)}/thread/${encodeURIComponent(threadId)}?gitStatus=1&refresh=1`,
    { staleTime: 5_000, refetchInterval: latestOperation?.status === "running" ? 2_000 : false },
  );
  const [selectedAction, setSelectedAction] = useState<GitAction | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [pullRequestTitle, setPullRequestTitle] = useState("");
  const [pullRequestBody, setPullRequestBody] = useState("");
  const [pullRequestDraft, setPullRequestDraft] = useState(false);
  const activeOperationIdRef = useRef<string | null>(null);

  const mutation = useWebMutation(
    async ({
      action,
      operationId,
      message,
      title,
      body,
      draft,
    }: {
      action: GitAction;
      operationId: string;
      message?: string;
      title?: string;
      body?: string;
      draft?: boolean;
    }, token) => {
      const createsPullRequest = action.includes("create_pr");
      return await webRequest<GitOperationResponse>(
        `/api/project/${encodeURIComponent(projectId)}/thread/${encodeURIComponent(threadId)}${createsPullRequest ? "/pull-request" : ""}`,
        token,
        {
          method: "POST",
          body: JSON.stringify({
            action,
            operationId,
            ...(createsPullRequest
              ? {
                  ...(title ? { title } : {}),
                  ...(body ? { body } : {}),
                  draft: Boolean(draft),
                }
              : message ? { commitMessage: message } : {}),
          }),
        },
      );
    },
    {
      invalidateQueryKeys: [["git-status", projectId, threadId]],
      onError: () => {
        activeOperationIdRef.current = null;
      },
      onSuccess: (result) => {
        if (result.status !== "running") {
          activeOperationIdRef.current = null;
        }
      },
    },
  );

  const status = git.data?.status;
  const options = useMemo(() => status ? availableActions(status) : [], [status]);
  const effectiveAction = options.some((option) => option.action === selectedAction)
    ? selectedAction
    : options[0]?.action ?? null;
  const selectedOption = options.find((option) => option.action === effectiveAction);
  const createsPullRequest = effectiveAction?.includes("create_pr") ?? false;
  const needsCommitMessage = (effectiveAction?.includes("commit") ?? false) && !createsPullRequest;
  const operationBusy = mutation.isPending || latestOperation?.status === "running";
  const busy = operationBusy || Boolean(thread?.isLive);
  const unsafeReason = thread?.isLive
    ? "Wait for the agent to finish before committing or changing this branch."
    : status?.detachedHead
    ? "This checkout is detached. Switch to a branch before committing."
    : status?.diverged
      ? "The local and remote branches diverged. Resolve the branch before shipping changes."
      : status && !status.isRepo
        ? "This workspace is not a Git repository."
        : status && (status.behindCount ?? 0) > 0 && status.hasWorkingTreeChanges
          ? "Commit or stash the working-tree changes before updating this branch."
          : status && (status.behindCount ?? 0) > 0 && !status.hasUpstream
            ? "This branch has no upstream branch to update from."
            : status
              && ((status.aheadCount ?? 0) > 0 || (status.behindCount ?? 0) > 0)
              && (!status.hasRemote || status.remoteStatus === "unavailable")
              ? status.remoteError?.message ?? "The Git remote is unavailable."
      : null;
  const renderFile = useCallback(({ item }: { item: ChangedFile }) => <ChangedFileRow file={item} />, []);

  useEffect(() => {
    if (
      latestOperation
      && latestOperation.operationId === activeOperationIdRef.current
      && latestOperation.status !== "running"
    ) {
      activeOperationIdRef.current = null;
    }
  }, [latestOperation?.operationId, latestOperation?.status]);

  if (git.isLoading) return <LoadingState label="Checking Git status…" />;
  if (!status) return <ErrorNotice message={git.error?.message ?? "Git status is unavailable."} />;

  const additions = status.changedFiles.reduce((sum, file) => sum + (file.additions ?? 0), 0);
  const deletions = status.changedFiles.reduce((sum, file) => sum + (file.deletions ?? 0), 0);

  const runAction = () => {
    if (!effectiveAction || busy || activeOperationIdRef.current) return;
    const operationId = createOperationId();
    activeOperationIdRef.current = operationId;
    mutation.mutate({
      action: effectiveAction,
      operationId,
      message: needsCommitMessage ? commitMessage.trim() || undefined : undefined,
      title: createsPullRequest ? pullRequestTitle.trim() || undefined : undefined,
      body: createsPullRequest ? pullRequestBody.trim() || undefined : undefined,
      draft: createsPullRequest ? pullRequestDraft : undefined,
    });
  };

  const retryFailedOperation = () => {
    if (
      !latestOperation
      || latestOperation.status !== "failed"
      || busy
      || activeOperationIdRef.current
    ) return;
    activeOperationIdRef.current = latestOperation.operationId;
    mutation.mutate({
      action: latestOperation.requestedAction,
      operationId: latestOperation.operationId,
      message: latestOperation.commitMessage,
      title: latestOperation.pullRequestTitle,
      body: latestOperation.pullRequestBody,
      draft: latestOperation.pullRequestDraft,
    });
  };

  return (
    <SafeAreaView edges={["bottom"]} style={[styles.screen, { backgroundColor: theme.screen }]}>
      <FlatList
        data={status.changedFiles}
        keyExtractor={fileKey}
        renderItem={renderFile}
        contentContainerStyle={styles.content}
        ListHeaderComponent={(
          <View style={styles.headerContent}>
            <View style={[styles.branchCard, { backgroundColor: theme.surface, borderColor: theme.line }]}>
              <View style={[styles.branchIcon, { backgroundColor: theme.accentSoft }]}>
                <GitBranch color={theme.accentOn} size={20} />
              </View>
              <View style={styles.branchCopy}>
                <Text numberOfLines={1} style={[styles.branchName, { color: theme.ink }]}>
                  {status.currentBranch ?? "Thread branch"}
                </Text>
                <Text style={[styles.branchStatus, { color: theme.muted }]}>
                  {status.kind.replace(/_/g, " ")}
                  {status.aheadCount ? ` · ${status.aheadCount} ahead` : ""}
                  {status.behindCount ? ` · ${status.behindCount} behind` : ""}
                </Text>
              </View>
              <Pressable accessibilityLabel="Refresh Git status" onPress={() => void git.refetch()} style={styles.refresh}>
                <RefreshCw color={theme.muted} size={17} />
              </Pressable>
            </View>

            {unsafeReason ? <ErrorNotice message={unsafeReason} /> : null}
            {mutation.error ? <ErrorNotice message={mutation.error.message} /> : null}
            {latestOperation?.status === "failed" ? (
              <View style={styles.failedOperation}>
                <ErrorNotice message={latestOperation.failure?.message ?? "Git operation failed."} />
                {latestOperation.failure?.retryable !== false ? (
                  <SecondaryButton
                    compact
                    icon={RefreshCw}
                    label="Retry failed operation"
                    disabled={busy}
                    onPress={retryFailedOperation}
                  />
                ) : null}
              </View>
            ) : null}

            {latestOperation?.status === "running" ? (
              <View style={[styles.operation, { backgroundColor: theme.accentSoft }]}>
                <View style={[styles.operationDot, { backgroundColor: theme.accentOn }]} />
                <View style={styles.operationCopy}>
                  <Text style={[styles.operationTitle, { color: theme.ink }]}>Shipping changes</Text>
                  <Text style={[styles.operationText, { color: theme.muted }]}>
                    {latestOperation.currentPhase?.replace(/_/g, " ") ?? latestOperation.requestedAction.replace(/_/g, " ")}…
                  </Text>
                </View>
              </View>
            ) : latestOperation?.status === "succeeded" ? (
              <View style={[styles.operation, { backgroundColor: theme.successSoft }]}>
                <Check color={theme.success} size={18} />
                <View style={styles.operationCopy}>
                  <Text style={[styles.operationTitle, { color: theme.ink }]}>Git action complete</Text>
                  <Text numberOfLines={2} style={[styles.operationText, { color: theme.muted }]}>
                    {latestOperation.commitMessage ?? latestOperation.requestedAction.replace(/_/g, " ")}
                  </Text>
                </View>
              </View>
            ) : null}

            <View style={styles.summaryLine}>
              <Text style={[styles.sectionTitle, { color: theme.ink }]}>Ship changes</Text>
              <View style={styles.stats}>
                <Text style={[styles.stat, { color: theme.add }]}>+{additions}</Text>
                <Text style={[styles.stat, { color: theme.delete }]}>−{deletions}</Text>
              </View>
            </View>

            {options.length > 0 ? (
              <View style={styles.actionOptions}>
                {options.map((option) => {
                  const selected = option.action === effectiveAction;
                  const ActionIcon = option.action === "pull"
                    ? ArrowDown
                    : option.action === "push"
                      ? ArrowUp
                      : option.action.includes("pr") ? GitPullRequest : GitCommitHorizontal;
                  return (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      key={option.action}
                      onPress={() => {
                        activeOperationIdRef.current = null;
                        setSelectedAction(option.action);
                      }}
                      style={[
                        styles.actionOption,
                        {
                          backgroundColor: selected ? theme.accentSoft : theme.surface,
                          borderColor: selected ? theme.accentOn : theme.line,
                        },
                      ]}
                    >
                      <View style={[styles.actionIcon, { backgroundColor: selected ? theme.accent : theme.surfaceSoft }]}>
                        <ActionIcon color={selected ? theme.accentInk : theme.muted} size={17} />
                      </View>
                      <View style={styles.actionCopy}>
                        <Text style={[styles.actionLabel, { color: theme.ink }]}>{option.label}</Text>
                        <Text style={[styles.actionDescription, { color: theme.muted }]}>{option.description}</Text>
                      </View>
                      <ChevronRight color={selected ? theme.accentOn : theme.faint} size={17} />
                    </Pressable>
                  );
                })}
              </View>
            ) : status.pullRequest?.url ? (
              <Pressable
                accessibilityRole="link"
                onPress={() => void Linking.openURL(status.pullRequest?.url ?? "")}
                style={[styles.prCard, { backgroundColor: theme.accentSoft, borderColor: theme.accentOn }]}
              >
                <GitPullRequest color={theme.accentOn} size={19} />
                <View style={styles.actionCopy}>
                  <Text style={[styles.actionLabel, { color: theme.ink }]}>PR #{status.pullRequest.number}</Text>
                  <Text numberOfLines={1} style={[styles.actionDescription, { color: theme.muted }]}>
                    {status.pullRequest.title ?? "Open pull request on GitHub"}
                  </Text>
                </View>
                <ChevronRight color={theme.accentOn} size={17} />
              </Pressable>
            ) : (
              <View style={[styles.cleanCard, { backgroundColor: theme.successSoft }]}>
                <Check color={theme.success} size={20} />
                <View style={styles.actionCopy}>
                  <Text style={[styles.actionLabel, { color: theme.ink }]}>Branch is up to date</Text>
                  <Text style={[styles.actionDescription, { color: theme.muted }]}>There is nothing to commit or push.</Text>
                </View>
              </View>
            )}

            {needsCommitMessage ? (
              <View>
                <Text style={[styles.inputLabel, { color: theme.faint }]}>COMMIT MESSAGE</Text>
                <TextInput
                  accessibilityLabel="Commit message"
                  multiline
                  maxLength={500}
                  value={commitMessage}
                  onChangeText={setCommitMessage}
                  placeholder="Leave blank to generate a commit message…"
                  placeholderTextColor={theme.faint}
                  style={[styles.commitInput, { color: theme.ink, backgroundColor: theme.surface, borderColor: theme.line }]}
                />
                <Text style={[styles.inputHint, { color: theme.faint }]}>{commitMessage.length}/500</Text>
              </View>
            ) : null}

            {createsPullRequest ? (
              <View style={styles.pullRequestFields}>
                <View>
                  <Text style={[styles.inputLabel, { color: theme.faint }]}>PULL REQUEST TITLE</Text>
                  <TextInput
                    accessibilityLabel="Pull request title"
                    maxLength={180}
                    value={pullRequestTitle}
                    onChangeText={setPullRequestTitle}
                    placeholder="Leave blank to generate a title…"
                    placeholderTextColor={theme.faint}
                    style={[styles.singleInput, { color: theme.ink, backgroundColor: theme.surface, borderColor: theme.line }]}
                  />
                </View>
                <View>
                  <Text style={[styles.inputLabel, { color: theme.faint }]}>DESCRIPTION</Text>
                  <TextInput
                    accessibilityLabel="Pull request description"
                    multiline
                    maxLength={5_000}
                    value={pullRequestBody}
                    onChangeText={setPullRequestBody}
                    placeholder="Optional pull request description…"
                    placeholderTextColor={theme.faint}
                    style={[styles.prBodyInput, { color: theme.ink, backgroundColor: theme.surface, borderColor: theme.line }]}
                  />
                </View>
                <Pressable
                  accessibilityRole="switch"
                  accessibilityState={{ checked: pullRequestDraft }}
                  onPress={() => setPullRequestDraft((current) => !current)}
                  style={[styles.draftRow, { backgroundColor: theme.surface, borderColor: theme.line }]}
                >
                  <View style={[
                    styles.draftCheck,
                    {
                      backgroundColor: pullRequestDraft ? theme.accent : "transparent",
                      borderColor: pullRequestDraft ? theme.accent : theme.strongLine,
                    },
                  ]}>
                    {pullRequestDraft ? <Check color={theme.accentInk} size={12} strokeWidth={3} /> : null}
                  </View>
                  <View style={styles.actionCopy}>
                    <Text style={[styles.actionLabel, { color: theme.ink }]}>Create as draft</Text>
                    <Text style={[styles.actionDescription, { color: theme.muted }]}>
                      Open the pull request without marking it ready for review.
                    </Text>
                  </View>
                </Pressable>
                <Text style={[styles.inputHint, { color: theme.faint }]}>
                  The commit message for pull-request actions is generated automatically.
                </Text>
              </View>
            ) : null}

            {effectiveAction ? (
              <PrimaryButton
                icon={effectiveAction.includes("pr") ? Rocket : effectiveAction === "pull" ? ArrowDown : GitCommitHorizontal}
                label={operationBusy ? "Working…" : selectedOption?.label ?? actionLabels[effectiveAction]}
                loading={operationBusy}
                disabled={Boolean(unsafeReason)}
                onPress={runAction}
              />
            ) : null}

            <Pressable
              accessibilityRole="button"
              onPress={() => navigation.replace("Changes", { projectId, threadId, title: route.params.title })}
              style={[styles.reviewLink, { borderColor: theme.line }]}
            >
              <FileDiff color={theme.muted} size={16} />
              <Text style={[styles.reviewText, { color: theme.ink }]}>Review changes before shipping</Text>
              <ChevronRight color={theme.faint} size={16} />
            </Pressable>

            {status.changedFiles.length > 0 ? (
              <View style={styles.fileHeading}>
                <Text style={[styles.sectionTitle, { color: theme.ink }]}>Changed files</Text>
                <Text style={[styles.fileCount, { color: theme.faint }]}>{status.changedFiles.length}</Text>
              </View>
            ) : null}
          </View>
        )}
        ListEmptyComponent={unsafeReason ? (
          <View style={styles.unavailable}>
            <CircleAlert color={theme.warning} size={22} />
            <Text style={[styles.unavailableText, { color: theme.muted }]}>Git actions will appear after the branch is ready.</Text>
          </View>
        ) : null}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 14, paddingBottom: 34, gap: 7 },
  headerContent: { gap: 13, paddingBottom: 12 },
  branchCard: { minHeight: 72, borderRadius: 14, borderWidth: 1, padding: 12, flexDirection: "row", alignItems: "center", gap: 11 },
  branchIcon: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  branchCopy: { flex: 1, minWidth: 0 },
  branchName: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  branchStatus: { fontFamily: "Inter_400Regular", fontSize: 10, marginTop: 5, textTransform: "capitalize" },
  refresh: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  operation: { minHeight: 61, borderRadius: 13, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  operationDot: { width: 8, height: 8, borderRadius: 4 },
  operationCopy: { flex: 1, minWidth: 0 },
  operationTitle: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  operationText: { fontFamily: "Inter_400Regular", fontSize: 10, marginTop: 4, textTransform: "capitalize" },
  failedOperation: { gap: 8 },
  summaryLine: { marginTop: 3, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { fontFamily: "Inter_700Bold", fontSize: 15, letterSpacing: -0.3 },
  stats: { flexDirection: "row", gap: 8 },
  stat: { fontFamily: "Inter_700Bold", fontSize: 11 },
  actionOptions: { gap: 7 },
  actionOption: { minHeight: 72, borderRadius: 14, borderWidth: 1, padding: 11, flexDirection: "row", alignItems: "center", gap: 10 },
  actionIcon: { width: 38, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  actionCopy: { flex: 1, minWidth: 0 },
  actionLabel: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  actionDescription: { fontFamily: "Inter_400Regular", fontSize: 10, lineHeight: 15, marginTop: 4 },
  prCard: { minHeight: 68, borderRadius: 14, borderWidth: 1, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  cleanCard: { minHeight: 64, borderRadius: 13, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  inputLabel: { fontFamily: "Inter_700Bold", fontSize: 9, letterSpacing: 1.1, marginBottom: 7, marginLeft: 2 },
  commitInput: { minHeight: 92, maxHeight: 150, borderRadius: 13, borderWidth: 1, padding: 12, fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19, textAlignVertical: "top" },
  pullRequestFields: { gap: 12 },
  singleInput: { height: 46, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, fontFamily: "Inter_400Regular", fontSize: 13 },
  prBodyInput: { minHeight: 104, maxHeight: 190, borderRadius: 12, borderWidth: 1, padding: 12, fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19, textAlignVertical: "top" },
  draftRow: { minHeight: 62, borderRadius: 12, borderWidth: 1, padding: 11, flexDirection: "row", alignItems: "center", gap: 10 },
  draftCheck: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  inputHint: { alignSelf: "flex-end", fontFamily: "Inter_400Regular", fontSize: 9, marginTop: 4, marginRight: 3 },
  reviewLink: { minHeight: 48, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 9 },
  reviewText: { flex: 1, fontFamily: "Inter_600SemiBold", fontSize: 11 },
  fileHeading: { marginTop: 6, flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  fileCount: { fontFamily: "Inter_600SemiBold", fontSize: 10 },
  fileRow: { minHeight: 44, borderRadius: 10, borderWidth: 1, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", gap: 7 },
  filePath: { flex: 1, fontFamily: "monospace", fontSize: 10 },
  fileStat: { fontFamily: "Inter_700Bold", fontSize: 9 },
  unavailable: { minHeight: 100, alignItems: "center", justifyContent: "center", gap: 8 },
  unavailableText: { fontFamily: "Inter_400Regular", fontSize: 11 },
});
