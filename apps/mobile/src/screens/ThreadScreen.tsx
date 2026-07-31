import { api } from "@autopr/backend/convex/_generated/api";
import { useUploadFile } from "@convex-dev/r2/react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { UIMessage } from "ai";
import { fetch as expoFetch } from "expo/fetch";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useConvex, useMutation, useQuery } from "convex/react";
import {
  ArrowDown,
  ArrowUp,
  Bot,
  ChevronDown,
  CircleStop,
  FileDiff,
  GitCommitHorizontal,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Settings2,
  TerminalSquare,
  Video,
  X,
} from "lucide-react-native";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  FlatList,
  InteractionManager,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useAuth } from "../auth/AuthProvider";
import { ErrorNotice, LoadingState } from "../components/ui";
import { ComposerSheet } from "../components/ComposerSheet";
import { GlassSurface } from "../components/GlassSurface";
import { ModelReasoningSheet } from "../components/ModelReasoningSheet";
import { OpenAIIcon } from "../components/OpenAIIcon";
import { ThreadMessage } from "../components/thread/ThreadMessage";
import { mobileConfig } from "../config";
import { useAppTheme } from "../hooks/useAppTheme";
import { useThreadData } from "../hooks/useThreadData";
import { useWebQuery } from "../hooks/useWebQuery";
import { extractDiffEntries } from "../lib/diff";
import { consumeAgentRunStream } from "../lib/agentStream";
import { consumeInitialThreadSubmit } from "../lib/initialThreadSubmit";
import {
  DEFAULT_THREAD_TITLE,
  firstUserMessageText,
  MAX_THREAD_TITLE_ATTEMPTS,
  shouldRetryThreadTitleError,
  threadTitleRetryDelayMs,
} from "../lib/threadTitle";
import {
  DEFAULT_CODEX_REASONING_EFFORT,
  getCodexModelOptions,
  getCodexReasoningEfforts,
  isCodexReasoningEffortForModel,
  selectCodexModel,
  type CodexReasoningEffort,
} from "../lib/codexModels";
import type { PromptFilePart, RootStackParamList } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "Thread">;

type CodexStatus = {
  connected: boolean;
  models?: string[];
};

type PendingImage = {
  id: string;
  uri: string;
  fileName: string;
  mediaType: string;
};

type OptimisticMessage = {
  messageId: string;
  role: "user";
  parts: unknown[];
  createdAt: number;
};

type StreamingAssistantMessage = {
  messageId: string;
  role: "assistant";
  parts: unknown[];
  createdAt: number;
};

type AgentStreamStatus = "idle" | "connecting" | "reconnecting" | "streaming";

type ComposerAttachment = {
  key: string;
  uri: string;
  filename: string;
  source: "pending" | "handoff";
  identity: string;
};

const attachmentKey = (attachment: ComposerAttachment) => attachment.key;

const ComposerAttachmentItem = memo(function ComposerAttachmentItem({
  attachment,
  onRemove,
}: {
  attachment: ComposerAttachment;
  onRemove: (source: ComposerAttachment["source"], identity: string) => void;
}) {
  const theme = useAppTheme();
  const remove = useCallback(
    () => onRemove(attachment.source, attachment.identity),
    [attachment.identity, attachment.source, onRemove],
  );
  return (
    <View style={styles.attachment}>
      <Image source={{ uri: attachment.uri }} style={styles.attachmentImage} />
      <Pressable
        accessibilityLabel={`Remove ${attachment.filename}`}
        onPress={remove}
        style={[styles.removeAttachment, { backgroundColor: theme.code }]}
      >
        <X color={theme.codeInk} size={13} />
      </Pressable>
    </View>
  );
});

function id() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const streamingFetch = expoFetch as unknown as typeof globalThis.fetch;

export function ThreadScreen({ navigation, route }: Props) {
  const { projectId, threadId } = route.params;
  const theme = useAppTheme();
  const { getAccessToken } = useAuth();
  const { project, thread, messages, loading, hydrationError } = useThreadData(projectId, threadId);
  const codex = useWebQuery<CodexStatus>(["codex", "status"], "/api/codex/status", {
    staleTime: 60_000,
    retry: false,
  });
  const git = useWebQuery(
    ["git-status", projectId, threadId],
    `/api/project/${encodeURIComponent(projectId)}/thread/${encodeURIComponent(threadId)}?gitStatus=1&refresh=1`,
    {
      enabled: Boolean(project?.sandboxStatus === "ready" && thread),
      staleTime: 20_000,
      refetchInterval: thread?.isLive ? 5_000 : 30_000,
      retry: false,
    },
  );
  const refetchGit = git.refetch;
  const updateTitle = useMutation(api.threads.updateTitle);
  const setDemoEnabled = useMutation(api.threads.setDemoEnabled);
  const userSettings = useQuery(api.userSettings.get, {});
  const latestGitOperation = useQuery(api.threads.getLatestGitOperation, { threadId });
  const uploadImage = useUploadFile(api.imageUploads);
  const convex = useConvex();
  const [prompt, setPrompt] = useState(route.params.initialPrompt ?? "");
  const [selectedModelChoice, setSelectedModelChoice] = useState<string | undefined>(route.params.initialModel);
  const [reasoningEffort, setReasoningEffort] = useState<CodexReasoningEffort>(
    isCodexReasoningEffortForModel(route.params.initialModel, route.params.initialReasoningEffort)
      ? route.params.initialReasoningEffort
      : DEFAULT_CODEX_REASONING_EFFORT,
  );
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [handoffFiles, setHandoffFiles] = useState<PromptFilePart[]>(route.params.initialFiles ?? []);
  const [optimisticMessage, setOptimisticMessage] = useState<OptimisticMessage | null>(null);
  const [streamingAssistant, setStreamingAssistant] = useState<StreamingAssistantMessage | null>(null);
  const [streamStatus, setStreamStatus] = useState<AgentStreamStatus>("idle");
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [showControls, setShowControls] = useState(false);
  const [toolsVisible, setToolsVisible] = useState(false);
  const [renameVisible, setRenameVisible] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  const [renameSaving, setRenameSaving] = useState(false);
  const [demoSaving, setDemoSaving] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const listRef = useRef<FlatList>(null);
  const autoSubmitRef = useRef(false);
  const streamAbortRef = useRef<AbortController | null>(null);
  const activeStreamRunIdRef = useRef<string | null>(null);
  const completedStreamRunIdRef = useRef<string | null>(null);
  const stoppedRunIdsRef = useRef<Set<string> | null>(null);
  stoppedRunIdsRef.current ??= new Set<string>();
  const messagesRef = useRef(messages);
  const pendingStreamMessageRef = useRef<StreamingAssistantMessage | null>(null);
  const streamRenderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedModel = useMemo(
    () => selectCodexModel(codex.data?.models, selectedModelChoice),
    [codex.data?.models, selectedModelChoice],
  );
  const modelOptions = useMemo(
    () => getCodexModelOptions(codex.data?.models, selectedModel),
    [codex.data?.models, selectedModel],
  );
  const reasoningOptions = useMemo(() => getCodexReasoningEfforts(selectedModel), [selectedModel]);
  const effectiveStreamingAssistant = useMemo(() => {
    if (!streamingAssistant || thread?.isLive) return streamingAssistant;
    const persisted = messages.find(
      (message) =>
        message.messageId === streamingAssistant.messageId
        && message.role === "assistant",
    );
    return persisted ? null : streamingAssistant;
  }, [messages, streamingAssistant, thread?.isLive]);
  const displayMessages = useMemo(() => {
    let next = [...messages];
    if (optimisticMessage && !next.some((message) => message.messageId === optimisticMessage.messageId)) {
      next.push(optimisticMessage);
    }
    if (effectiveStreamingAssistant) {
      const persistedIndex = next.findIndex(
        (message) => message.messageId === effectiveStreamingAssistant.messageId,
      );
      if (persistedIndex >= 0) {
        next[persistedIndex] = {
          ...next[persistedIndex],
          ...effectiveStreamingAssistant,
        };
      } else {
        next.push(effectiveStreamingAssistant);
      }
    }
    return next;
  }, [effectiveStreamingAssistant, messages, optimisticMessage]);
  const firstTitleMessage = useMemo(() => firstUserMessageText(messages), [messages]);
  const [titleGeneration, setTitleGeneration] = useState({ threadId, attempt: 0 });
  const titleGenerationAttempt = titleGeneration.threadId === threadId
    ? titleGeneration.attempt
    : 0;
  const diffs = useMemo(() => extractDiffEntries(displayMessages), [displayMessages]);
  const running = Boolean(thread?.isLive || sending || streamStatus !== "idle");
  const diffDraftKey = `autopr.mobile.diff-draft:${threadId}`;
  const composerDraftKey = `autopr.mobile.composer-draft:${threadId}`;
  const composerAttachments = useMemo<ComposerAttachment[]>(() => [
    ...pendingImages.map((image) => ({
      key: `pending:${image.id}`,
      uri: image.uri,
      filename: image.fileName,
      source: "pending" as const,
      identity: image.id,
    })),
    ...handoffFiles.map((file) => ({
      key: `handoff:${file.providerMetadata.autopr.r2Key}`,
      uri: file.url,
      filename: file.filename,
      source: "handoff" as const,
      identity: file.providerMetadata.autopr.r2Key,
    })),
  ], [handoffFiles, pendingImages]);
  const removeComposerAttachment = useCallback((
    source: ComposerAttachment["source"],
    identity: string,
  ) => {
    if (source === "pending") {
      setPendingImages((current) => current.filter((image) => image.id !== identity));
    } else {
      setHandoffFiles((current) => current.filter(
        (file) => file.providerMetadata.autopr.r2Key !== identity,
      ));
    }
  }, []);
  const toggleDemo = useCallback(async () => {
    if (!thread || demoSaving) return;
    setDemoSaving(true);
    setSendError(null);
    try {
      await setDemoEnabled({ threadId, demoEnabled: !thread.demoEnabled });
    } catch (cause) {
      setSendError(cause instanceof Error ? cause.message : "Could not update demo recording.");
    } finally {
      setDemoSaving(false);
    }
  }, [demoSaving, setDemoEnabled, thread, threadId]);
  const renderComposerAttachment = useCallback(
    ({ item }: { item: ComposerAttachment }) => (
      <ComposerAttachmentItem attachment={item} onRemove={removeComposerAttachment} />
    ),
    [removeComposerAttachment],
  );

  const renderMessage = useCallback(({ item, index }: {
    item: (typeof displayMessages)[number];
    index: number;
  }) => (
    <ThreadMessage
      message={item}
      isLast={index === displayMessages.length - 1}
      isLive={Boolean(thread?.isLive)}
      projectId={projectId}
      threadId={threadId}
    />
  ), [displayMessages.length, projectId, thread?.isLive, threadId]);

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

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    const currentRunId = thread?.currentRunId;
    for (const runId of stoppedRunIdsRef.current ?? []) {
      if (runId !== currentRunId) stoppedRunIdsRef.current?.delete(runId);
    }
  }, [thread?.currentRunId]);

  useEffect(() => {
    if (!isCodexReasoningEffortForModel(selectedModel, reasoningEffort)) {
      setReasoningEffort(reasoningOptions[0] ?? DEFAULT_CODEX_REASONING_EFFORT);
    }
  }, [reasoningEffort, reasoningOptions, selectedModel]);

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
    }).catch(() => {
      if (active) setSendError("The saved message draft could not be restored.");
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
    if (displayMessages.length > 0) {
      const timer = setTimeout(() => {
        if (!awayFromLatest) listRef.current?.scrollToEnd({ animated: true });
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [awayFromLatest, displayMessages.length]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: thread?.title ?? route.params.title ?? "Conversation",
      headerTitle: () => (
        <View style={styles.headerTitle}>
          <Text numberOfLines={1} style={[styles.headerTitleText, { color: theme.ink }]}>
            {thread?.title ?? route.params.title ?? "Conversation"}
          </Text>
          <Text numberOfLines={1} style={[styles.headerSubtitle, { color: theme.muted }]}>
            {[project?.repoName, thread?.featureBranch ?? thread?.baseBranch].filter(Boolean).join(" · ")}
          </Text>
        </View>
      ),
      headerRight: () => (
        <View style={[styles.headerActions, { backgroundColor: theme.surfaceSoft, borderColor: theme.line }]}>
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
            accessibilityLabel="Git actions"
            onPress={() => navigation.navigate("GitActions", { projectId, threadId, title: thread?.title })}
            style={({ pressed }) => [styles.headerButton, { opacity: pressed ? 0.55 : 1 }]}
          >
            <GitCommitHorizontal color={theme.ink} size={18} />
          </Pressable>
          <Pressable
            accessibilityLabel="More conversation actions"
            onPress={() => setToolsVisible(true)}
            style={({ pressed }) => [styles.headerButton, { opacity: pressed ? 0.55 : 1 }]}
          >
            <MoreHorizontal color={theme.ink} size={19} />
          </Pressable>
        </View>
      ),
    });
  }, [
    diffs.length,
    navigation,
    project?.repoName,
    projectId,
    refetchGit,
    route.params.title,
    theme,
    thread,
    threadId,
    toggleDemo,
    userSettings?.demoRecordingExperimentEnabled,
  ]);

  const authenticatedWebFetch = useCallback(async (path: string, init: RequestInit) => {
    const execute = async (token: string) => {
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${token}`);
      return await streamingFetch(`${mobileConfig.webUrl}${path}`, { ...init, headers });
    };
    const token = await getAccessToken();
    if (!token) throw new Error("Sign in to continue.");
    const response = await execute(token);
    if (response.status !== 401) return response;
    const refreshed = await getAccessToken(true);
    return refreshed ? await execute(refreshed) : response;
  }, [getAccessToken]);

  const publishStreamingMessage = useCallback((message: StreamingAssistantMessage) => {
    pendingStreamMessageRef.current = message;
    if (streamRenderTimerRef.current) return;
    streamRenderTimerRef.current = setTimeout(() => {
      streamRenderTimerRef.current = null;
      const latest = pendingStreamMessageRef.current;
      if (latest) setStreamingAssistant(latest);
    }, 48);
  }, []);

  const beginAgentStream = useCallback((runId: string) => {
    if (
      activeStreamRunIdRef.current === runId
      || completedStreamRunIdRef.current === runId
      || stoppedRunIdsRef.current?.has(runId)
    ) {
      return;
    }

    streamAbortRef.current?.abort();
    const controller = new AbortController();
    streamAbortRef.current = controller;
    activeStreamRunIdRef.current = runId;
    setStreamStatus("connecting");

    const lastMessage = messagesRef.current.at(-1);
    const lastAssistant = lastMessage?.role === "assistant" && lastMessage.parts.length === 0
      ? lastMessage
      : undefined;
    const initialMessage = lastAssistant
      ? {
          id: lastAssistant.messageId,
          role: "assistant" as const,
          parts: lastAssistant.parts as UIMessage["parts"],
        }
      : undefined;

    void consumeAgentRunStream({
      runId,
      streamPath: `/api/project/${encodeURIComponent(projectId)}/thread/${encodeURIComponent(threadId)}/agent/${encodeURIComponent(runId)}/stream`,
      fetchAuthenticated: authenticatedWebFetch,
      signal: controller.signal,
      initialMessage,
      onStatus: setStreamStatus,
      onMessage: (message) => {
        if (controller.signal.aborted) return;
        publishStreamingMessage({
          messageId: message.id || lastAssistant?.messageId || `stream:${runId}`,
          role: "assistant",
          parts: message.parts,
          createdAt: Date.now(),
        });
      },
    })
      .then(() => {
        if (!controller.signal.aborted) completedStreamRunIdRef.current = runId;
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setSendError(error instanceof Error ? error.message : "The live response disconnected.");
        }
      })
      .finally(() => {
        if (activeStreamRunIdRef.current === runId) {
          activeStreamRunIdRef.current = null;
          setStreamStatus("idle");
        }
      });
  }, [authenticatedWebFetch, projectId, publishStreamingMessage, threadId]);

  useEffect(() => {
    if (thread?.isLive && thread.currentRunId) {
      beginAgentStream(thread.currentRunId);
      return;
    }
    if (!thread?.isLive) {
      streamAbortRef.current?.abort();
      activeStreamRunIdRef.current = null;
      setStreamStatus("idle");
    }
  }, [
    beginAgentStream,
    thread?.currentRunId,
    thread?.isLive,
  ]);

  useEffect(() => {
    if (
      thread?.title !== DEFAULT_THREAD_TITLE
      || !firstTitleMessage
      || titleGenerationAttempt >= MAX_THREAD_TITLE_ATTEMPTS
    ) {
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      void authenticatedWebFetch(
        `/api/project/${encodeURIComponent(projectId)}/thread/${encodeURIComponent(threadId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "generate_title", message: firstTitleMessage }),
          signal: controller.signal,
        },
      ).then(async (response) => {
        if (controller.signal.aborted) return;
        const body = await response.json().catch(() => null) as {
          error?: string;
          title?: string;
        } | null;
        if (response.ok) {
          if (!body?.title) throw new Error("Thread title generation returned no title.");
          return;
        }
        const retryable =
          response.status === 408
          || response.status === 425
          || response.status === 429
          || response.status >= 500;
        throw Object.assign(
          new Error(body?.error ?? `Could not generate the title (${response.status}).`),
          { retryable },
        );
      }).catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        const retryable = shouldRetryThreadTitleError(cause);
        setTitleGeneration({
          threadId,
          attempt: retryable
            ? titleGenerationAttempt + 1
            : MAX_THREAD_TITLE_ATTEMPTS,
        });
      });
    }, threadTitleRetryDelayMs(titleGenerationAttempt));

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    authenticatedWebFetch,
    firstTitleMessage,
    projectId,
    thread?.title,
    threadId,
    titleGenerationAttempt,
  ]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && thread?.isLive && thread.currentRunId) {
        beginAgentStream(thread.currentRunId);
      }
    });
    return () => subscription.remove();
  }, [beginAgentStream, thread?.currentRunId, thread?.isLive]);

  useEffect(() => () => {
    streamAbortRef.current?.abort();
    if (streamRenderTimerRef.current) clearTimeout(streamRenderTimerRef.current);
  }, []);

  const chooseImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
      allowsMultipleSelection: true,
      selectionLimit: Math.max(1, 6 - pendingImages.length),
    });
    if (result.canceled) return;
    setPendingImages((current) => [
      ...current,
      ...result.assets.map((asset, index) => ({
        id: `${Date.now()}:${index}:${asset.assetId ?? asset.uri}`,
        uri: asset.uri,
        fileName: asset.fileName ?? `image-${Date.now()}-${index + 1}.jpg`,
        mediaType: asset.mimeType ?? "image/jpeg",
      })),
    ].slice(0, 6));
  };

  const send = async (initial?: {
    text?: string;
    files?: PromptFilePart[];
    isActive?: () => boolean;
  }) => {
    const isActive = initial?.isActive ?? (() => true);
    const text = (initial?.text ?? prompt).trim();
    const initialFiles = initial?.files ?? (messages.length === 0 ? handoffFiles : []);
    if (
      (!text && pendingImages.length === 0 && initialFiles.length === 0)
      || running
      || demoSaving
      || !thread
      || !project
    ) return;
    setSending(true);
    setSendError(null);
    setStreamingAssistant(null);
    pendingStreamMessageRef.current = null;
    if (streamRenderTimerRef.current) {
      clearTimeout(streamRenderTimerRef.current);
      streamRenderTimerRef.current = null;
    }
    try {
      const parts: unknown[] = [
        ...(text ? [{ type: "text", text }] : []),
        ...initialFiles,
      ];
      const uploadedImages = await Promise.all(pendingImages.map(async (image) => {
        const imageResponse = await fetch(image.uri);
        if (!imageResponse.ok) throw new Error(`The selected image ${image.fileName} could not be read.`);
        const blob = await imageResponse.blob();
        const file = Object.assign(blob, {
          name: image.fileName,
          lastModified: Date.now(),
        }) as File;
        const key = await uploadImage(file);
        const url = await convex.query(api.imageUploads.getUrl, { key });
        return {
          type: "file",
          filename: image.fileName,
          mediaType: image.mediaType,
          url,
          providerMetadata: { autopr: { r2Key: key } },
        };
      }));
      parts.push(...uploadedImages);
      if (!isActive()) return;

      const messageId = id();
      setOptimisticMessage({ messageId, role: "user", parts, createdAt: Date.now() });
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
      const runId = response.headers.get("x-trigger-run-id");
      if (!runId) throw new Error("The agent started without a live response ID.");
      beginAgentStream(runId);
      if (!isActive()) return;
      setPrompt("");
      setPendingImages([]);
      setHandoffFiles([]);
      void AsyncStorage.removeItem(composerDraftKey);
    } catch (error) {
      if (isActive()) {
        setOptimisticMessage(null);
        setSendError(error instanceof Error ? error.message : "Could not send the message.");
      }
    } finally {
      setSending(false);
    }
  };

  const stop = async () => {
    const runId = thread?.currentRunId ?? activeStreamRunIdRef.current;
    if (!runId || stopping) return;
    setStopping(true);
    setSendError(null);
    stoppedRunIdsRef.current?.add(runId);
    streamAbortRef.current?.abort();
    if (streamRenderTimerRef.current) {
      clearTimeout(streamRenderTimerRef.current);
      streamRenderTimerRef.current = null;
    }
    const finalAssistant = pendingStreamMessageRef.current ?? streamingAssistant;
    if (finalAssistant) setStreamingAssistant(finalAssistant);
    try {
      const response = await authenticatedWebFetch(
        `/api/project/${encodeURIComponent(projectId)}/thread/${encodeURIComponent(threadId)}/agent/${encodeURIComponent(runId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(finalAssistant ? {
              assistantMessage: {
                id: finalAssistant.messageId,
                parts: finalAssistant.parts,
              },
            } : {}),
          }),
        },
      );
      if (!response.ok) throw new Error("The active run could not be stopped.");
    } catch (error) {
      stoppedRunIdsRef.current?.delete(runId);
      if (thread?.isLive) {
        beginAgentStream(runId);
      }
      setSendError(error instanceof Error ? error.message : "The active run could not be stopped.");
    } finally {
      setStopping(false);
    }
  };

  useEffect(() => {
    if (
      autoSubmitRef.current
      || loading
      || messages.length > 0
      || !thread
      || !project
      || project.sandboxStatus !== "ready"
      || codex.data?.connected !== true
      || (!route.params.initialPrompt && !route.params.initialFiles?.length)
    ) {
      return;
    }
    autoSubmitRef.current = true;
    let active = true;
    const cancelHandoff = consumeInitialThreadSubmit(threadId, () => {
      void send({
        text: route.params.initialPrompt,
        files: route.params.initialFiles,
        isActive: () => active,
      });
    });
    return () => {
      active = false;
      cancelHandoff();
    };
  }, [codex.data?.connected, loading, messages.length, project, route.params.initialFiles, route.params.initialPrompt, thread, threadId]);

  if (loading) return <LoadingState label="Loading conversation…" />;
  if (!project || !thread || thread.projectId !== projectId) {
    return <ErrorNotice message="This conversation was not found." />;
  }

  const canChat = Boolean(project.sandboxStatus === "ready" && codex.data?.connected);
  const composerPlaceholder = canChat
    ? messages.length > 0 ? "Add a follow-up…" : "Describe a task…"
    : codex.data?.connected === false ? "Connect Codex in Settings" : "Workspace unavailable";
  const hasComposerContent = Boolean(prompt.trim())
    || pendingImages.length > 0
    || handoffFiles.length > 0;
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={0}
      style={[styles.screen, { backgroundColor: theme.screen }]}
    >
      {(hydrationError || sendError || thread.agentRunIssue?.message || thread.workflowIssue?.message || git.error) ? (
        <View style={styles.errorWrap}>
          <ErrorNotice message={
            hydrationError
              ?? sendError
              ?? thread.agentRunIssue?.message
              ?? thread.workflowIssue?.message
              ?? git.error?.message
              ?? "Something went wrong."
          } />
        </View>
      ) : null}

      {displayMessages.length === 0 ? (
        <View style={styles.threadEmpty}>
          <View style={[styles.emptyBot, { backgroundColor: theme.accentSoft }]}>
            <Bot color={theme.accentOn} size={28} />
          </View>
          <Text style={[styles.emptyTitle, { color: theme.ink }]}>Give AutoPR a task</Text>
          <Text style={[styles.emptyBody, { color: theme.muted }]}>
            Be specific about the outcome. The agent will inspect this repository, make the change, and return a reviewable diff.
          </Text>
          <View style={styles.starters}>
            {["Explain this codebase", "Fix failing checks", "Review the current branch"].map((starter) => (
              <Pressable
                key={starter}
                disabled={!canChat || running}
                onPress={() => void send({ text: starter })}
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
            data={displayMessages}
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
        {composerAttachments.length > 0 ? (
          <FlatList
            horizontal
            data={composerAttachments}
            keyExtractor={attachmentKey}
            renderItem={renderComposerAttachment}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.attachments}
          />
        ) : null}
        <GlassSurface
          interactive
          radius={28}
          style={[styles.composer, { borderColor: theme.line }]}
        >
          <Pressable
            accessibilityLabel="Select model and reasoning effort"
            accessibilityRole="button"
            onPress={() => setShowControls(true)}
            style={({ pressed }) => [
              styles.modelButton,
              { backgroundColor: theme.surfaceSoft, opacity: pressed ? 0.6 : 1 },
            ]}
          >
            <OpenAIIcon size={15} />
            <ChevronDown color={theme.faint} size={12} />
          </Pressable>
          <Pressable
            accessibilityHint="Opens a full-screen editor"
            accessibilityLabel="Message"
            accessibilityRole="button"
            disabled={!canChat}
            onPress={() => setComposerOpen(true)}
            style={({ pressed }) => [styles.promptPreview, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Text
              numberOfLines={1}
              style={[styles.prompt, { color: prompt.trim() ? theme.ink : theme.faint }]}
            >
              {prompt.trim() || composerPlaceholder}
            </Text>
          </Pressable>
          <View style={styles.composerActions}>
            {running ? (
              <Pressable
                accessibilityLabel="Stop agent"
                disabled={stopping}
                onPress={() => void stop()}
                style={[styles.sendButton, { backgroundColor: theme.dangerSoft, opacity: stopping ? 0.55 : 1 }]}
              >
                <CircleStop color={theme.danger} size={19} />
              </Pressable>
            ) : (
              <Pressable
                accessibilityLabel="Send message"
                disabled={!hasComposerContent || !canChat || demoSaving}
                onPress={() => void send()}
                style={[
                  styles.sendButton,
                  {
                    backgroundColor: theme.accent,
                    opacity: !hasComposerContent || !canChat || demoSaving ? 0.35 : 1,
                  },
                ]}
              >
                <ArrowUp color={theme.accentInk} size={19} strokeWidth={2.5} />
              </Pressable>
            )}
          </View>
        </GlassSurface>
        {running ? (
          <View style={styles.connectionRow}>
            <View style={[
              styles.connectionDot,
              { backgroundColor: streamStatus === "reconnecting" ? theme.warning : theme.success },
            ]} />
            <Text style={[styles.connectionText, { color: theme.faint }]}>
              {streamStatus === "reconnecting"
                ? "Reconnecting to live response…"
                : streamStatus === "connecting"
                  ? "Connecting to live response…"
                  : sending ? "Starting agent…" : "Live response connected"}
            </Text>
          </View>
        ) : null}

        {latestGitOperation?.status === "running" || latestGitOperation?.status === "failed" ? (
          <View style={[
            styles.gitOperation,
            { backgroundColor: latestGitOperation.status === "failed" ? theme.dangerSoft : theme.accentSoft },
          ]}>
            <View style={[
              styles.gitOperationDot,
              { backgroundColor: latestGitOperation.status === "failed" ? theme.danger : theme.accent },
            ]} />
            <Text numberOfLines={2} style={[
              styles.gitOperationText,
              { color: latestGitOperation.status === "failed" ? theme.danger : theme.ink },
            ]}>
              {latestGitOperation.status === "failed"
                ? latestGitOperation.failure?.message ?? "Git operation failed"
                : `${latestGitOperation.currentPhase?.replace(/_/g, " ") ?? latestGitOperation.requestedAction.replace(/_/g, " ")}…`}
            </Text>
          </View>
        ) : null}

      </View>
      <ComposerSheet
        visible={composerOpen}
        title={messages.length > 0 ? "Follow-up" : "New task"}
        subtitle={[project.repoName, thread.featureBranch ?? thread.baseBranch].filter(Boolean).join(" · ")}
        placeholder={composerPlaceholder}
        value={prompt}
        editable={canChat}
        canSend={hasComposerContent && canChat && !running && !demoSaving}
        sending={sending}
        picker={{
          models: modelOptions,
          selectedModel,
          reasoningEfforts: reasoningOptions,
          selectedReasoningEffort: reasoningEffort,
          onSelectModel: setSelectedModelChoice,
          onSelectReasoningEffort: setReasoningEffort,
        }}
        attachments={composerAttachments.length > 0 ? (
          <FlatList
            horizontal
            data={composerAttachments}
            keyExtractor={attachmentKey}
            renderItem={renderComposerAttachment}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.sheetAttachments}
            style={styles.sheetAttachmentList}
          />
        ) : null}
        onChangeText={setPrompt}
        onAddImage={() => void chooseImage()}
        onClose={() => setComposerOpen(false)}
        onSend={() => void send()}
      />
      <ModelReasoningSheet
        visible={showControls}
        models={modelOptions}
        selectedModel={selectedModel}
        reasoningEfforts={reasoningOptions}
        selectedReasoningEffort={reasoningEffort}
        onSelectModel={setSelectedModelChoice}
        onSelectReasoningEffort={setReasoningEffort}
        onClose={() => setShowControls(false)}
      />
      <Modal
        animationType="slide"
        onRequestClose={() => setToolsVisible(false)}
        transparent
        visible={toolsVisible}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            accessibilityLabel="Close conversation tools"
            onPress={() => setToolsVisible(false)}
            style={StyleSheet.absoluteFill}
          />
          <View style={[styles.toolsCard, { backgroundColor: theme.surfaceRaised, borderColor: theme.line }]}>
            <View style={styles.toolsHeading}>
              <Text style={[styles.toolsTitle, { color: theme.ink }]}>Conversation tools</Text>
              <Text style={[styles.toolsBody, { color: theme.muted }]}>
                Manage this thread and its workspace.
              </Text>
            </View>
            {[
              {
                key: "rename",
                label: "Rename conversation",
                icon: Pencil,
                onPress: () => {
                  setToolsVisible(false);
                  InteractionManager.runAfterInteractions(() => {
                    setRenameTitle(thread?.title ?? "");
                    setRenameVisible(true);
                  });
                },
              },
              ...(userSettings?.demoRecordingExperimentEnabled ? [{
                key: "demo",
                label: thread?.demoEnabled ? "Disable demo recording" : "Enable demo recording",
                icon: Video,
                onPress: () => {
                  setToolsVisible(false);
                  void toggleDemo();
                },
              }] : []),
              {
                key: "environment",
                label: "Environment variables",
                icon: Settings2,
                onPress: () => {
                  setToolsVisible(false);
                  navigation.navigate("Environment", { projectId, title: project?.repoName });
                },
              },
              {
                key: "terminal",
                label: "Open terminal",
                icon: TerminalSquare,
                onPress: () => {
                  setToolsVisible(false);
                  navigation.navigate("Terminal", { projectId, threadId, title: thread?.title });
                },
              },
              {
                key: "refresh",
                label: "Refresh Git status",
                icon: RefreshCw,
                onPress: () => {
                  setToolsVisible(false);
                  void refetchGit();
                },
              },
            ].map((action) => {
              const Icon = action.icon;
              return (
                <Pressable
                  accessibilityRole="button"
                  key={action.key}
                  onPress={action.onPress}
                  style={({ pressed }) => [
                    styles.toolRow,
                    {
                      backgroundColor: pressed ? theme.surfaceSoft : theme.surface,
                      borderColor: theme.line,
                    },
                  ]}
                >
                  <View style={[styles.toolIcon, { backgroundColor: theme.accentSoft }]}>
                    <Icon color={theme.accentOn} size={17} />
                  </View>
                  <Text style={[styles.toolLabel, { color: theme.ink }]}>{action.label}</Text>
                </Pressable>
              );
            })}
            <Pressable
              accessibilityRole="button"
              onPress={() => setToolsVisible(false)}
              style={[styles.toolsCancel, { backgroundColor: theme.surfaceSoft }]}
            >
              <Text style={[styles.toolsCancelText, { color: theme.muted }]}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal
        animationType="fade"
        onRequestClose={() => setRenameVisible(false)}
        transparent
        visible={renameVisible}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalBackdrop}
        >
          <Pressable
            accessibilityLabel="Close rename conversation"
            onPress={() => setRenameVisible(false)}
            style={StyleSheet.absoluteFill}
          />
          <View style={[styles.renameCard, { backgroundColor: theme.surfaceRaised, borderColor: theme.line }]}>
            <View style={styles.renameHeading}>
              <View style={[styles.renameIcon, { backgroundColor: theme.accentSoft }]}>
                <Pencil color={theme.accentOn} size={17} />
              </View>
              <View style={styles.renameCopy}>
                <Text style={[styles.renameTitle, { color: theme.ink }]}>Rename conversation</Text>
                <Text style={[styles.renameBody, { color: theme.muted }]}>Use a short title that describes the outcome.</Text>
              </View>
            </View>
            <TextInput
              accessibilityLabel="Conversation title"
              autoFocus
              maxLength={120}
              onChangeText={setRenameTitle}
              placeholder="Conversation title"
              placeholderTextColor={theme.faint}
              returnKeyType="done"
              value={renameTitle}
              onSubmitEditing={() => {
                if (!renameTitle.trim() || renameSaving) return;
                setRenameSaving(true);
                void updateTitle({ threadId, title: renameTitle.trim() })
                  .then(() => setRenameVisible(false))
                  .catch((cause) => setSendError(
                    cause instanceof Error ? cause.message : "Could not rename the conversation.",
                  ))
                  .finally(() => setRenameSaving(false));
              }}
              style={[styles.renameInput, { color: theme.ink, backgroundColor: theme.surface, borderColor: theme.strongLine }]}
            />
            <View style={styles.renameActions}>
              <Pressable
                onPress={() => setRenameVisible(false)}
                style={[styles.renameButton, { backgroundColor: theme.surfaceSoft }]}
              >
                <Text style={[styles.renameButtonText, { color: theme.muted }]}>Cancel</Text>
              </Pressable>
              <Pressable
                disabled={!renameTitle.trim() || renameSaving}
                onPress={() => {
                  setRenameSaving(true);
                  void updateTitle({ threadId, title: renameTitle.trim() })
                    .then(() => setRenameVisible(false))
                    .catch((cause) => setSendError(
                      cause instanceof Error ? cause.message : "Could not rename the conversation.",
                    ))
                    .finally(() => setRenameSaving(false));
                }}
                style={[
                  styles.renameButton,
                  { backgroundColor: theme.accent, opacity: !renameTitle.trim() || renameSaving ? 0.45 : 1 },
                ]}
              >
                <Text style={[styles.renameButtonText, { color: theme.accentInk }]}>
                  {renameSaving ? "Saving…" : "Save"}
                </Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  headerTitle: { width: 136, minWidth: 0 },
  headerTitleText: { fontFamily: "DMSans_700Bold", fontSize: 15, letterSpacing: -0.25 },
  headerSubtitle: { fontFamily: "DMSans_400Regular", fontSize: 11, marginTop: 1 },
  headerActions: { borderWidth: 1, borderRadius: 20, paddingHorizontal: 2, flexDirection: "row", alignItems: "center", gap: 1 },
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
  headerBadgeText: { fontFamily: "DMSans_700Bold", fontSize: 8 },
  errorWrap: { paddingHorizontal: 12, paddingTop: 10 },
  threadEmpty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 28, paddingVertical: 20 },
  emptyBot: { width: 52, height: 52, borderRadius: 10, alignItems: "center", justifyContent: "center", marginBottom: 15 },
  emptyTitle: { fontFamily: "DMSans_500Medium", fontSize: 20, letterSpacing: -0.45 },
  emptyBody: { maxWidth: 330, fontFamily: "DMSans_400Regular", fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: 9 },
  starters: { width: "100%", maxWidth: 340, gap: 7, marginTop: 21 },
  starter: { minHeight: 44, borderRadius: 7, borderWidth: 1, paddingHorizontal: 13, justifyContent: "center" },
  starterText: { fontFamily: "DMSans_500Medium", fontSize: 12 },
  feed: { flex: 1 },
  messages: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 28 },
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
  composerWrap: { paddingHorizontal: 12, paddingTop: 7, paddingBottom: 8 },
  attachments: { gap: 8, paddingHorizontal: 4, paddingTop: 4, paddingBottom: 9 },
  attachment: { marginRight: 2 },
  attachmentImage: { width: 64, height: 64, borderRadius: 8 },
  removeAttachment: { position: "absolute", right: -5, top: -5, width: 22, height: 22, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  composer: {
    minHeight: 54,
    borderWidth: 1,
    borderRadius: 27,
    paddingLeft: 7,
    paddingRight: 7,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  promptPreview: { flex: 1, minWidth: 0, justifyContent: "center", minHeight: 40 },
  prompt: { fontFamily: "DMSans_400Regular", fontSize: 15, lineHeight: 21 },
  composerActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  sheetAttachmentList: { flexGrow: 0 },
  sheetAttachments: { gap: 10, paddingHorizontal: 18, paddingBottom: 10 },
  connectionRow: { minHeight: 22, paddingHorizontal: 7, paddingTop: 4, flexDirection: "row", alignItems: "center", gap: 6 },
  connectionDot: { width: 6, height: 6, borderRadius: 3 },
  connectionText: { fontFamily: "DMSans_500Medium", fontSize: 9 },
  modelButton: {
    minHeight: 38,
    borderRadius: 19,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  sendButton: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  gitOperation: { minHeight: 35, marginTop: 6, borderRadius: 8, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  gitOperationDot: { width: 7, height: 7, borderRadius: 99 },
  gitOperationText: { flex: 1, fontFamily: "DMSans_500Medium", fontSize: 10, textTransform: "capitalize" },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.38)", padding: 14 },
  toolsCard: { borderWidth: 1, borderRadius: 18, padding: 12, gap: 8, marginBottom: 6 },
  toolsHeading: { paddingHorizontal: 4, paddingTop: 3, paddingBottom: 6 },
  toolsTitle: { fontFamily: "DMSans_700Bold", fontSize: 15 },
  toolsBody: { fontFamily: "DMSans_400Regular", fontSize: 11, marginTop: 4 },
  toolRow: { minHeight: 52, borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  toolIcon: { width: 32, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  toolLabel: { flex: 1, fontFamily: "DMSans_500Medium", fontSize: 12 },
  toolsCancel: { minHeight: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", marginTop: 2 },
  toolsCancelText: { fontFamily: "DMSans_500Medium", fontSize: 12 },
  renameCard: { borderWidth: 1, borderRadius: 18, padding: 15, gap: 14, marginBottom: 6 },
  renameHeading: { flexDirection: "row", alignItems: "center", gap: 10 },
  renameIcon: { width: 38, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  renameCopy: { flex: 1, minWidth: 0 },
  renameTitle: { fontFamily: "DMSans_700Bold", fontSize: 14 },
  renameBody: { fontFamily: "DMSans_400Regular", fontSize: 10, lineHeight: 15, marginTop: 3 },
  renameInput: { height: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontFamily: "DMSans_500Medium", fontSize: 13 },
  renameActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  renameButton: { minWidth: 82, height: 40, borderRadius: 11, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  renameButtonText: { fontFamily: "DMSans_500Medium", fontSize: 11 },
});
