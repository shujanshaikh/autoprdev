import { api } from "@autopr/backend/convex/_generated/api";
import { useUploadFile } from "@convex-dev/r2/react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useConvex, useMutation } from "convex/react";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Bot,
  ChevronDown,
  CircleStop,
  FileDiff,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  ImagePlus,
  MoreHorizontal,
  TerminalSquare,
  X,
} from "lucide-react-native";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { webRequest } from "../api/web";
import { useAuth } from "../auth/AuthProvider";
import { ErrorNotice, LoadingState } from "../components/ui";
import { ThreadMessage } from "../components/thread/ThreadMessage";
import { mobileConfig } from "../config";
import { useAppTheme } from "../hooks/useAppTheme";
import { useThreadData } from "../hooks/useThreadData";
import { useWebMutation, useWebQuery } from "../hooks/useWebQuery";
import { extractDiffEntries } from "../lib/diff";
import type { RootStackParamList } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "Thread">;

type CodexStatus = {
  connected: boolean;
  models?: string[];
};

type GitStatus = {
  status: {
    kind: string;
    hasWorkingTreeChanges: boolean;
    changedFiles: Array<{ path: string; additions?: number; deletions?: number }>;
    aheadCount: number | null;
    behindCount: number | null;
    pullRequest?: { number: number; url: string; state: string };
  };
};

type PendingImage = {
  uri: string;
  fileName: string;
  mediaType: string;
};

type ComposerOption = {
  kind: "model" | "effort";
  value: string;
};

function id() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function ThreadScreen({ navigation, route }: Props) {
  const { projectId, threadId } = route.params;
  const theme = useAppTheme();
  const { getAccessToken } = useAuth();
  const { project, thread, messages, loading, hydrationError } = useThreadData(projectId, threadId);
  const codex = useWebQuery<CodexStatus>(["codex", "status"], "/api/codex/status", {
    staleTime: 60_000,
    retry: false,
  });
  const git = useWebQuery<GitStatus>(
    ["git-status", projectId, threadId],
    `/api/project/${encodeURIComponent(projectId)}/thread/${encodeURIComponent(threadId)}?gitStatus=1&refresh=1`,
    { enabled: Boolean(project?.sandboxStatus === "ready" && thread), staleTime: 20_000, retry: false },
  );
  const refetchGit = git.refetch;
  const setSettlement = useMutation(api.threads.setSettlement);
  const uploadImage = useUploadFile(api.imageUploads);
  const convex = useConvex();
  const [prompt, setPrompt] = useState("");
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [reasoningEffort, setReasoningEffort] = useState("medium");
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(false);
  const [composerFocused, setComposerFocused] = useState(false);
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const listRef = useRef<FlatList>(null);
  const promptRef = useRef<TextInput>(null);
  const diffs = useMemo(() => extractDiffEntries(messages), [messages]);
  const running = Boolean(thread?.isLive || sending);
  const diffDraftKey = `autopr.mobile.diff-draft:${threadId}`;
  const composerDraftKey = `autopr.mobile.composer-draft:${threadId}`;
  const composerOptions = useMemo<ComposerOption[]>(() => [
    ...(codex.data?.models ?? []).map((value) => ({ kind: "model" as const, value })),
    ...["low", "medium", "high", "xhigh"].map((value) => ({ kind: "effort" as const, value })),
  ], [codex.data?.models]);

  const renderMessage = useCallback(({ item, index }: {
    item: (typeof messages)[number];
    index: number;
  }) => (
    <ThreadMessage
      message={item}
      isLast={index === messages.length - 1}
      isLive={Boolean(thread?.isLive)}
    />
  ), [messages.length, thread?.isLive]);

  const updateLatestPosition = useCallback((nativeEvent: {
    contentSize: { height: number };
    layoutMeasurement: { height: number };
    contentOffset: { y: number };
  }) => {
    const distance = nativeEvent.contentSize.height
      - nativeEvent.layoutMeasurement.height
      - nativeEvent.contentOffset.y;
    setAwayFromLatest(distance > 120);
  }, []);

  const renderComposerOption = useCallback(({ item: option }: { item: ComposerOption }) => {
    const selected = option.kind === "model"
      ? selectedModel === option.value
      : reasoningEffort === option.value;
    return (
      <Pressable
        onPress={() => {
          if (option.kind === "model") setSelectedModel(option.value);
          else setReasoningEffort(option.value);
        }}
        style={[
          styles.controlChip,
          {
            backgroundColor: selected ? theme.accentSoft : theme.surfaceSoft,
            borderColor: selected ? theme.accent : theme.line,
          },
        ]}
      >
        <Text style={[styles.controlText, { color: selected ? theme.secondary : theme.muted }]}>
          {option.value}
        </Text>
      </Pressable>
    );
  }, [reasoningEffort, selectedModel, theme]);

  useEffect(() => {
    if (!selectedModel && codex.data?.models?.[0]) setSelectedModel(codex.data.models[0]);
  }, [codex.data?.models, selectedModel]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      AsyncStorage.getItem(composerDraftKey),
      AsyncStorage.getItem(diffDraftKey),
    ]).then(([draft, diffDraft]) => {
      if (!active) return;
      const combined = [draft, diffDraft].filter(Boolean).join("\n\n");
      if (combined) setPrompt(combined);
      if (diffDraft) void AsyncStorage.removeItem(diffDraftKey);
    });
    return () => {
      active = false;
    };
  }, [composerDraftKey, diffDraftKey]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (prompt.trim()) void AsyncStorage.setItem(composerDraftKey, prompt);
      else void AsyncStorage.removeItem(composerDraftKey);
    }, 250);
    return () => clearTimeout(timer);
  }, [composerDraftKey, prompt]);

  useEffect(() => {
    if (messages.length > 0) {
      const timer = setTimeout(() => {
        if (!awayFromLatest) listRef.current?.scrollToEnd({ animated: true });
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [awayFromLatest, messages.length]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: thread?.title ?? route.params.title ?? "Conversation",
      headerRight: () => (
        <View style={styles.headerActions}>
          <Pressable
            accessibilityLabel="Review changes"
            onPress={() => navigation.navigate("Changes", { projectId, threadId, title: thread?.title })}
            style={({ pressed }) => [styles.headerButton, { opacity: pressed ? 0.55 : 1 }]}
          >
            <FileDiff color={theme.ink} size={18} />
            {diffs.length > 0 ? (
              <View style={[styles.headerBadge, { backgroundColor: theme.accent }]}>
                <Text style={[styles.headerBadgeText, { color: theme.accentInk }]}>{diffs.length}</Text>
              </View>
            ) : null}
          </Pressable>
          <Pressable
            accessibilityLabel="Open terminal"
            onPress={() => navigation.navigate("Terminal", { projectId, threadId, title: thread?.title })}
            style={({ pressed }) => [styles.headerButton, { opacity: pressed ? 0.55 : 1 }]}
          >
            <TerminalSquare color={theme.ink} size={18} />
          </Pressable>
          <Pressable
            accessibilityLabel="More conversation actions"
            onPress={() => Alert.alert("Conversation tools", undefined, [
              {
                text: "Environment variables",
                onPress: () => navigation.navigate("Environment", { projectId, title: project?.repoName }),
              },
              { text: "Refresh Git status", onPress: () => void refetchGit() },
              { text: "Cancel", style: "cancel" },
            ])}
            style={({ pressed }) => [styles.headerButton, { opacity: pressed ? 0.55 : 1 }]}
          >
            <MoreHorizontal color={theme.ink} size={19} />
          </Pressable>
        </View>
      ),
    });
  }, [diffs.length, navigation, project?.repoName, projectId, refetchGit, route.params.title, theme, thread?.title, threadId]);

  const gitAction = useWebMutation(
    async (action: "commit" | "push" | "create_pr" | "commit_push" | "push_create_pr" | "commit_push_create_pr" | "pull", token) =>
      await webRequest<Record<string, unknown>>(
        `/api/project/${encodeURIComponent(projectId)}/thread/${encodeURIComponent(threadId)}`,
        token,
        { method: "POST", body: JSON.stringify({ action }) },
      ),
    { onSuccess: () => void refetchGit() },
  );

  const authenticatedWebFetch = async (path: string, init: RequestInit) => {
    const execute = async (token: string) => {
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${token}`);
      return await fetch(`${mobileConfig.webUrl}${path}`, { ...init, headers });
    };
    const token = await getAccessToken();
    if (!token) throw new Error("Sign in to continue.");
    const response = await execute(token);
    if (response.status !== 401) return response;
    const refreshed = await getAccessToken(true);
    return refreshed ? await execute(refreshed) : response;
  };

  const chooseImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
      allowsMultipleSelection: false,
    });
    const asset = result.assets?.[0];
    if (!result.canceled && asset) {
      setPendingImage({
        uri: asset.uri,
        fileName: asset.fileName ?? `image-${Date.now()}.jpg`,
        mediaType: asset.mimeType ?? "image/jpeg",
      });
    }
  };

  const send = async () => {
    const text = prompt.trim();
    if ((!text && !pendingImage) || running || !thread || !project) return;
    setSending(true);
    setSendError(null);
    try {
      const parts: unknown[] = text ? [{ type: "text", text }] : [];
      if (pendingImage) {
        const imageResponse = await fetch(pendingImage.uri);
        if (!imageResponse.ok) {
          throw new Error("The selected image could not be read.");
        }
        const blob = await imageResponse.blob();
        const file = Object.assign(blob, {
          name: pendingImage.fileName,
          lastModified: Date.now(),
        }) as File;
        const key = await uploadImage(file);
        const url = await convex.query(api.imageUploads.getUrl, { key });
        parts.push({
          type: "file",
          filename: pendingImage.fileName,
          mediaType: pendingImage.mediaType,
          url,
          providerMetadata: { autopr: { r2Key: key } },
        });
      }

      const messageId = id();
      const response = await authenticatedWebFetch(
        `/api/project/${encodeURIComponent(projectId)}/thread/${encodeURIComponent(threadId)}/agent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: { id: messageId, role: "user", parts },
            ...(selectedModel ? { model: selectedModel } : {}),
            reasoningEffort,
          }),
        },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? `Could not start the agent (${response.status}).`);
      }
      setPrompt("");
      setPendingImage(null);
      void AsyncStorage.removeItem(composerDraftKey);
      if (thread.title === "New thread" && text) {
        const token = await getAccessToken();
        void webRequest(
          `/api/project/${encodeURIComponent(projectId)}/thread/${encodeURIComponent(threadId)}`,
          token,
          { method: "POST", body: JSON.stringify({ action: "generate_title", message: text }) },
        ).catch(() => undefined);
      }
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Could not send the message.");
    } finally {
      setSending(false);
    }
  };

  const stop = async () => {
    if (!thread?.currentRunId) return;
    const response = await authenticatedWebFetch(
      `/api/project/${encodeURIComponent(projectId)}/thread/${encodeURIComponent(threadId)}/agent/${encodeURIComponent(thread.currentRunId)}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
    );
    if (!response.ok) setSendError("The active run could not be stopped.");
  };

  if (loading) return <LoadingState label="Loading conversation…" />;
  if (!project || !thread || thread.projectId !== projectId) {
    return <ErrorNotice message="This conversation was not found." />;
  }

  const canChat = project.sandboxStatus === "ready" && codex.data?.connected;
  const gitStatus = git.data?.status ?? thread.gitStatus;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      style={[styles.screen, { backgroundColor: theme.screen }]}
    >
      <View style={[styles.threadContext, { backgroundColor: theme.surface, borderColor: theme.line }]}>
        <GitBranch color={theme.muted} size={14} />
        <Text numberOfLines={1} style={[styles.contextBranch, { color: theme.muted }]}>
          {thread.featureBranch ?? thread.baseBranch ?? "Preparing branch"}
        </Text>
        {running ? (
          <View style={styles.contextStatus}>
            <View style={[styles.contextDot, { backgroundColor: theme.accent }]} />
            <Text style={[styles.contextStatusText, { color: theme.muted }]}>Agent working</Text>
          </View>
        ) : null}
        <Pressable
          onPress={() => navigation.navigate("Changes", { projectId, threadId, title: thread.title })}
          style={({ pressed }) => [
            styles.changeSummary,
            { backgroundColor: pressed ? theme.surfaceSoft : "transparent" },
          ]}
        >
          <FileDiff color={theme.muted} size={14} />
          <Text style={[styles.changeCount, { color: theme.ink }]}>
            {diffs.length > 0 ? `${diffs.length} files` : "Changes"}
          </Text>
          <Text style={[styles.diffStats, { color: theme.add }]}>+{diffs.reduce((sum, entry) => sum + entry.additions, 0)}</Text>
          <Text style={[styles.diffStats, { color: theme.delete }]}>−{diffs.reduce((sum, entry) => sum + entry.deletions, 0)}</Text>
        </Pressable>
      </View>

      {(hydrationError || sendError || git.error || gitAction.error) ? (
        <View style={styles.errorWrap}>
          <ErrorNotice message={
            hydrationError ?? sendError ?? git.error?.message ?? gitAction.error?.message ?? "Something went wrong."
          } />
        </View>
      ) : null}

      {messages.length === 0 ? (
        <View style={styles.threadEmpty}>
          <View style={[styles.emptyBot, { backgroundColor: theme.accentSoft }]}>
            <Bot color={theme.accent} size={28} />
          </View>
          <Text style={[styles.emptyTitle, { color: theme.ink }]}>Give AutoPR a task</Text>
          <Text style={[styles.emptyBody, { color: theme.muted }]}>
            Be specific about the outcome. The agent will inspect this repository, make the change, and return a reviewable diff.
          </Text>
          <View style={styles.starters}>
            {["Explain this codebase", "Fix failing checks", "Review the current branch"].map((starter) => (
              <Pressable
                key={starter}
                onPress={() => {
                  setPrompt(starter);
                  setTimeout(() => promptRef.current?.focus(), 50);
                }}
                style={({ pressed }) => [
                  styles.starter,
                  {
                    backgroundColor: pressed ? theme.accentSoft : theme.surface,
                    borderColor: theme.line,
                  },
                ]}
              >
                <Text style={[styles.starterText, { color: theme.ink }]}>{starter}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        <View style={styles.feed}>
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(message) => message.messageId}
            contentContainerStyle={styles.messages}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => {
              if (!awayFromLatest) listRef.current?.scrollToEnd({ animated: false });
            }}
            onMomentumScrollEnd={({ nativeEvent }) => updateLatestPosition(nativeEvent)}
            onScrollEndDrag={({ nativeEvent }) => updateLatestPosition(nativeEvent)}
            renderItem={renderMessage}
          />
          {awayFromLatest ? (
            <Pressable
              accessibilityLabel="Scroll to latest message"
              onPress={() => {
                listRef.current?.scrollToEnd({ animated: true });
                setAwayFromLatest(false);
              }}
              style={[
                styles.latestButton,
                {
                  backgroundColor: theme.surfaceRaised,
                  borderColor: theme.line,
                  boxShadow: "0 3px 8px rgba(0,0,0,0.12)",
                },
              ]}
            >
              <ArrowDown color={theme.ink} size={17} />
            </Pressable>
          ) : null}
        </View>
      )}

      <View style={[styles.composerWrap, { backgroundColor: theme.screen }]}>
        {pendingImage ? (
          <View style={styles.attachment}>
            <Image source={{ uri: pendingImage.uri }} style={styles.attachmentImage} />
            <Pressable
              accessibilityLabel="Remove image"
              onPress={() => setPendingImage(null)}
              style={[styles.removeAttachment, { backgroundColor: theme.code }]}
            >
              <X color={theme.codeInk} size={13} />
            </Pressable>
          </View>
        ) : null}
        {showControls && composerFocused ? (
          <FlatList
            horizontal
            data={composerOptions}
            keyExtractor={(option) => `${option.kind}:${option.value}`}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.controls}
            renderItem={renderComposerOption}
          />
        ) : null}
        <View
          style={[
            styles.composer,
            composerFocused ? styles.composerExpanded : styles.composerCollapsed,
            {
              backgroundColor: theme.surfaceSoft,
              borderColor: composerFocused ? theme.strongLine : theme.line,
              boxShadow: "0 6px 14px rgba(0,0,0,0.12)",
            },
          ]}
        >
          <TextInput
            ref={promptRef}
            multiline
            value={prompt}
            onChangeText={setPrompt}
            onFocus={() => setComposerFocused(true)}
            onBlur={() => {
              setComposerFocused(false);
              setShowControls(false);
            }}
            editable={!running && canChat}
            placeholder={canChat
              ? messages.length > 0 ? "Add a follow-up…" : "Describe a task…"
              : codex.data?.connected === false ? "Connect Codex in Settings" : "Workspace unavailable"}
            placeholderTextColor={theme.faint}
            scrollEnabled={composerFocused}
            style={[
              styles.prompt,
              composerFocused ? styles.promptExpanded : styles.promptCollapsed,
              { color: theme.ink },
            ]}
          />
          <View style={[styles.composerActions, !composerFocused && styles.composerActionsCollapsed]}>
            {composerFocused ? (
              <>
                <Pressable accessibilityLabel="Add image" disabled={running} onPress={() => void chooseImage()} style={styles.smallAction}>
                  <ImagePlus color={theme.muted} size={18} />
                </Pressable>
                <Pressable
                  accessibilityLabel="Model and reasoning"
                  onPress={() => setShowControls((value) => !value)}
                  style={[styles.modelButton, { backgroundColor: theme.surface }]}
                >
                  <Text numberOfLines={1} style={[styles.modelText, { color: theme.muted }]}>
                    {selectedModel?.replace(/^gpt-/, "") ?? "Model"} · {reasoningEffort}
                  </Text>
                  <ChevronDown color={theme.faint} size={13} />
                </Pressable>
              </>
            ) : null}
            {running ? (
              <Pressable
                accessibilityLabel="Stop agent"
                onPress={() => void stop()}
                style={[styles.sendButton, { backgroundColor: theme.dangerSoft }]}
              >
                <CircleStop color={theme.danger} size={19} />
              </Pressable>
            ) : (
              <Pressable
                accessibilityLabel="Send message"
                disabled={(!prompt.trim() && !pendingImage) || !canChat}
                onPress={() => void send()}
                style={[
                  styles.sendButton,
                  {
                    backgroundColor: theme.accent,
                    opacity: (!prompt.trim() && !pendingImage) || !canChat ? 0.35 : 1,
                  },
                ]}
              >
                <ArrowUp color={theme.accentInk} size={19} strokeWidth={2.5} />
              </Pressable>
            )}
          </View>
        </View>

        {gitStatus ? (
          <View style={styles.gitBar}>
            <View style={styles.gitSummary}>
              <GitCommitHorizontal color={theme.muted} size={15} />
              <Text numberOfLines={1} style={[styles.gitText, { color: theme.muted }]}>
                {gitStatus.kind.replace(/_/g, " ")}
                {gitStatus.aheadCount ? ` · ${gitStatus.aheadCount} ahead` : ""}
              </Text>
            </View>
            {gitStatus.hasWorkingTreeChanges ? (
              <Pressable
                disabled={gitAction.isPending || running}
                onPress={() => gitAction.mutate("commit_push")}
                style={[styles.gitAction, { backgroundColor: theme.surfaceSoft }]}
              >
                <Text style={[styles.gitActionText, { color: theme.ink }]}>Commit + push</Text>
              </Pressable>
            ) : null}
            {gitStatus.aheadCount && !gitStatus.pullRequest ? (
              <Pressable
                disabled={gitAction.isPending || running}
                onPress={() => gitAction.mutate("push_create_pr")}
                style={[styles.gitAction, { backgroundColor: theme.accentSoft }]}
              >
                <GitPullRequest color={theme.accent} size={14} />
                <Text style={[styles.gitActionText, { color: theme.accent }]}>Open PR</Text>
              </Pressable>
            ) : null}
            {!running ? (
              <Pressable
                accessibilityLabel={thread.settledOverride === "settled" ? "Restore conversation" : "Archive conversation"}
                onPress={() => {
                  const settled = thread.settledOverride !== "settled";
                  Alert.alert(
                    settled ? "Archive conversation?" : "Restore conversation?",
                    settled ? "The thread stays available in this project." : "The thread will return to active work.",
                    [
                      { text: "Cancel", style: "cancel" },
                      { text: settled ? "Archive" : "Restore", onPress: () => void setSettlement({ threadId, settled }) },
                    ],
                  );
                }}
                style={styles.smallAction}
              >
                <Archive color={theme.faint} size={16} />
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 2 },
  headerButton: { width: 34, height: 36, alignItems: "center", justifyContent: "center" },
  headerBadge: {
    position: "absolute",
    right: 1,
    top: 1,
    minWidth: 15,
    height: 15,
    borderRadius: 8,
    paddingHorizontal: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  headerBadgeText: { fontFamily: "Inter_700Bold", fontSize: 8 },
  threadContext: {
    minHeight: 42,
    borderBottomWidth: 1,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  contextBranch: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 10 },
  contextStatus: { flexDirection: "row", alignItems: "center", gap: 5 },
  contextDot: { width: 6, height: 6, borderRadius: 99 },
  contextStatusText: { fontFamily: "Inter_500Medium", fontSize: 9 },
  changeSummary: { minHeight: 30, borderRadius: 6, paddingHorizontal: 7, flexDirection: "row", alignItems: "center", gap: 5 },
  changeCount: { fontFamily: "Inter_600SemiBold", fontSize: 10 },
  diffStats: { fontFamily: "Inter_700Bold", fontSize: 9 },
  errorWrap: { paddingHorizontal: 12, paddingTop: 10 },
  threadEmpty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 28, paddingVertical: 20 },
  emptyBot: { width: 52, height: 52, borderRadius: 10, alignItems: "center", justifyContent: "center", marginBottom: 15 },
  emptyTitle: { fontFamily: "Inter_600SemiBold", fontSize: 20, letterSpacing: -0.45 },
  emptyBody: { maxWidth: 330, fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: 9 },
  starters: { width: "100%", maxWidth: 340, gap: 7, marginTop: 21 },
  starter: { minHeight: 44, borderRadius: 7, borderWidth: 1, paddingHorizontal: 13, justifyContent: "center" },
  starterText: { fontFamily: "Inter_500Medium", fontSize: 12 },
  feed: { flex: 1 },
  messages: { paddingHorizontal: 17, paddingTop: 20, paddingBottom: 28 },
  latestButton: {
    position: "absolute",
    right: 16,
    bottom: 10,
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  composerWrap: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 7 },
  attachment: { alignSelf: "flex-start", marginBottom: 7, marginLeft: 4 },
  attachmentImage: { width: 64, height: 64, borderRadius: 8 },
  removeAttachment: { position: "absolute", right: -5, top: -5, width: 22, height: 22, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  controls: { gap: 7, paddingBottom: 8, paddingHorizontal: 3 },
  controlChip: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 7 },
  controlText: { fontFamily: "Inter_600SemiBold", fontSize: 10 },
  composer: {
    borderWidth: 1,
  },
  composerCollapsed: {
    minHeight: 50,
    borderRadius: 25,
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 5,
    flexDirection: "row",
    alignItems: "center",
  },
  composerExpanded: { borderRadius: 12, padding: 10 },
  prompt: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 21 },
  promptCollapsed: { flex: 1, height: 38, paddingHorizontal: 0, paddingVertical: 8 },
  promptExpanded: { minHeight: 76, maxHeight: 142, paddingHorizontal: 3, paddingTop: 2, paddingBottom: 8 },
  composerActions: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  composerActionsCollapsed: { marginTop: 0 },
  smallAction: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  modelButton: { flex: 1, minHeight: 34, borderRadius: 6, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 4 },
  modelText: { maxWidth: 175, fontFamily: "Inter_600SemiBold", fontSize: 10 },
  sendButton: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  gitBar: { minHeight: 35, flexDirection: "row", alignItems: "center", gap: 5, paddingTop: 5, paddingHorizontal: 2 },
  gitSummary: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 5 },
  gitText: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 10, textTransform: "capitalize" },
  gitAction: { minHeight: 29, borderRadius: 6, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 5 },
  gitActionText: { fontFamily: "Inter_600SemiBold", fontSize: 10 },
});
