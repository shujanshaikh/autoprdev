import { api } from "@autopr/backend/convex/_generated/api";
import { useUploadFile } from "@convex-dev/r2/react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as ImagePicker from "expo-image-picker";
import { useConvex, useMutation } from "convex/react";
import {
  Archive,
  Bot,
  ChevronDown,
  CircleStop,
  FileDiff,
  GitCommitHorizontal,
  GitPullRequest,
  ImagePlus,
  KeyRound,
  RefreshCw,
  Send,
  Sparkles,
  ToolCase,
  TerminalSquare,
  X,
} from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { webRequest } from "../api/web";
import { useAuth } from "../auth/AuthProvider";
import { ErrorNotice, LoadingState, StatusPill } from "../components/ui";
import { mobileConfig } from "../config";
import { useAppTheme } from "../hooks/useAppTheme";
import { useThreadData } from "../hooks/useThreadData";
import { useWebMutation, useWebQuery } from "../hooks/useWebQuery";
import { extractDiffEntries } from "../lib/diff";
import { messageParts } from "../lib/messages";
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

function id() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function displayToolName(name: string) {
  return name.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function MessageCard({
  message,
  isLast,
  isLive,
}: {
  message: { messageId: string; role: string; parts: unknown[] };
  isLast: boolean;
  isLive: boolean;
}) {
  const theme = useAppTheme();
  const parts = messageParts(message.parts);
  const isUser = message.role === "user";
  return (
    <View style={[styles.message, isUser && styles.userMessage]}>
      <View style={styles.messageHeading}>
        <View style={[
          styles.messageAvatar,
          { backgroundColor: isUser ? theme.accentSoft : theme.surfaceSoft },
        ]}>
          {isUser
            ? <Text style={[styles.you, { color: theme.accent }]}>YOU</Text>
            : <Bot color={theme.ink} size={16} />}
        </View>
        <Text style={[styles.messageAuthor, { color: theme.muted }]}>
          {isUser ? "You" : "AutoPR agent"}
        </Text>
        {!isUser && isLast && isLive ? <StatusPill label="Working" tone="success" /> : null}
      </View>
      <View style={styles.partList}>
        {parts.map((part, index) => {
          if (part.kind === "text") {
            return (
              <Text
                key={`${message.messageId}:text:${index}`}
                selectable
                style={[
                  styles.messageText,
                  isUser && [styles.userBubble, { backgroundColor: theme.accentSoft, color: theme.ink }],
                  !isUser && { color: theme.ink },
                ]}
              >
                {part.text}
              </Text>
            );
          }
          if (part.kind === "reasoning") {
            return (
              <View
                key={`${message.messageId}:reasoning:${index}`}
                style={[styles.reasoning, { borderLeftColor: theme.accent, backgroundColor: theme.surfaceSoft }]}
              >
                <View style={styles.reasoningHeading}>
                  <Sparkles color={theme.accent} size={13} />
                  <Text style={[styles.reasoningLabel, { color: theme.accent }]}>Reasoning</Text>
                </View>
                <Text numberOfLines={5} style={[styles.reasoningText, { color: theme.muted }]}>{part.text}</Text>
              </View>
            );
          }
          if (part.kind === "file" && part.mediaType.startsWith("image/")) {
            return (
              <Image
                key={`${message.messageId}:file:${index}`}
                accessibilityLabel={part.filename ?? "Attached image"}
                source={{ uri: part.url }}
                style={[styles.messageImage, { backgroundColor: theme.surfaceSoft }]}
              />
            );
          }
          if (part.kind === "tool") {
            const finished = part.state === "output-available";
            return (
              <View
                key={`${message.messageId}:tool:${index}`}
                style={[styles.tool, { backgroundColor: theme.surface, borderColor: theme.line }]}
              >
                <View style={[styles.toolIcon, { backgroundColor: theme.surfaceSoft }]}>
                  <ToolCase color={theme.muted} size={14} />
                </View>
                <View style={styles.toolCopy}>
                  <Text style={[styles.toolName, { color: theme.ink }]}>{displayToolName(part.name)}</Text>
                  {part.summary ? (
                    <Text numberOfLines={2} style={[styles.toolSummary, { color: theme.muted }]}>{part.summary}</Text>
                  ) : null}
                </View>
                {finished
                  ? <StatusPill label="Done" tone="success" />
                  : <ActivityIndicator size="small" color={theme.accent} />}
              </View>
            );
          }
          return null;
        })}
      </View>
    </View>
  );
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
  const listRef = useRef<FlatList>(null);
  const diffs = useMemo(() => extractDiffEntries(messages), [messages]);
  const running = Boolean(thread?.isLive || sending);
  const draftKey = `autopr.mobile.diff-draft:${threadId}`;

  useEffect(() => {
    if (!selectedModel && codex.data?.models?.[0]) setSelectedModel(codex.data.models[0]);
  }, [codex.data?.models, selectedModel]);

  useEffect(() => {
    void AsyncStorage.getItem(draftKey).then((draft) => {
      if (!draft) return;
      setPrompt((current) => current ? `${current}\n\n${draft}` : draft);
      void AsyncStorage.removeItem(draftKey);
    });
  }, [draftKey]);

  useEffect(() => {
    if (messages.length > 0) {
      const timer = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
      return () => clearTimeout(timer);
    }
  }, [messages.length]);

  const gitAction = useWebMutation(
    async (action: "commit" | "push" | "create_pr" | "commit_push" | "push_create_pr" | "commit_push_create_pr" | "pull", token) =>
      await webRequest<Record<string, unknown>>(
        `/api/project/${encodeURIComponent(projectId)}/thread/${encodeURIComponent(threadId)}`,
        token,
        { method: "POST", body: JSON.stringify({ action }) },
      ),
    { onSuccess: () => void git.refetch() },
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
        const blob = await fetch(pendingImage.uri).then((response) => response.blob());
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
      <View style={[styles.reviewRibbon, { backgroundColor: theme.surface, borderColor: theme.line }]}>
        <Pressable
          onPress={() => navigation.navigate("Changes", { projectId, threadId, title: thread.title })}
          style={styles.ribbonMain}
        >
          <FileDiff color={theme.accent} size={18} />
          <View style={styles.ribbonCopy}>
            <Text style={[styles.ribbonTitle, { color: theme.ink }]}>
              {diffs.length > 0 ? `${diffs.length} changed ${diffs.length === 1 ? "file" : "files"}` : "Review changes"}
            </Text>
            <Text numberOfLines={1} style={[styles.ribbonMeta, { color: theme.muted }]}>
              {thread.featureBranch ?? thread.baseBranch ?? "Preparing branch"}
            </Text>
          </View>
          <Text style={[styles.diffStats, { color: theme.add }]}>+{diffs.reduce((sum, entry) => sum + entry.additions, 0)}</Text>
          <Text style={[styles.diffStats, { color: theme.delete }]}>−{diffs.reduce((sum, entry) => sum + entry.deletions, 0)}</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Open terminal"
          onPress={() => navigation.navigate("Terminal", { projectId, threadId, title: thread.title })}
          style={[styles.ribbonButton, { borderLeftColor: theme.line }]}
        >
          <TerminalSquare color={theme.muted} size={16} />
        </Pressable>
        <Pressable
          accessibilityLabel="Manage environment variables"
          onPress={() => navigation.navigate("Environment", { projectId, title: project.repoName })}
          style={[styles.ribbonButton, { borderLeftColor: theme.line }]}
        >
          <KeyRound color={theme.muted} size={16} />
        </Pressable>
        <Pressable
          accessibilityLabel="Refresh Git status"
          onPress={() => void git.refetch()}
          style={[styles.ribbonButton, { borderLeftColor: theme.line }]}
        >
          <RefreshCw color={theme.muted} size={16} />
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
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(message) => message.messageId}
          contentContainerStyle={styles.messages}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item, index }) => (
            <MessageCard message={item} isLast={index === messages.length - 1} isLive={Boolean(thread.isLive)} />
          )}
        />
      )}

      <View style={[styles.composerWrap, { backgroundColor: theme.surface, borderTopColor: theme.line }]}>
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
        {showControls ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.controls}>
            {(codex.data?.models ?? []).map((model) => (
              <Pressable
                key={model}
                onPress={() => setSelectedModel(model)}
                style={[
                  styles.controlChip,
                  {
                    backgroundColor: selectedModel === model ? theme.accentSoft : theme.surfaceSoft,
                    borderColor: selectedModel === model ? theme.accent : theme.line,
                  },
                ]}
              >
                <Text style={[styles.controlText, { color: selectedModel === model ? theme.accent : theme.muted }]}>{model}</Text>
              </Pressable>
            ))}
            {["low", "medium", "high", "xhigh"].map((effort) => (
              <Pressable
                key={effort}
                onPress={() => setReasoningEffort(effort)}
                style={[
                  styles.controlChip,
                  {
                    backgroundColor: reasoningEffort === effort ? theme.accentSoft : theme.surfaceSoft,
                    borderColor: reasoningEffort === effort ? theme.accent : theme.line,
                  },
                ]}
              >
                <Text style={[styles.controlText, { color: reasoningEffort === effort ? theme.accent : theme.muted }]}>
                  {effort}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        <View style={[styles.composer, { backgroundColor: theme.screen, borderColor: theme.line }]}>
          <TextInput
            multiline
            value={prompt}
            onChangeText={setPrompt}
            editable={!running && canChat}
            placeholder={canChat ? "Add a follow-up…" : codex.data?.connected === false ? "Connect Codex in Settings" : "Workspace unavailable"}
            placeholderTextColor={theme.faint}
            style={[styles.prompt, { color: theme.ink }]}
          />
          <View style={styles.composerActions}>
            <Pressable accessibilityLabel="Add image" disabled={running} onPress={() => void chooseImage()} style={styles.smallAction}>
              <ImagePlus color={theme.muted} size={19} />
            </Pressable>
            <Pressable accessibilityLabel="Model and reasoning" onPress={() => setShowControls((value) => !value)} style={styles.modelButton}>
              <Text numberOfLines={1} style={[styles.modelText, { color: theme.muted }]}>
                {selectedModel?.replace(/^gpt-/, "") ?? "Model"} · {reasoningEffort}
              </Text>
              <ChevronDown color={theme.faint} size={13} />
            </Pressable>
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
                <Send color={theme.accentInk} size={18} />
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
  reviewRibbon: { minHeight: 59, borderBottomWidth: 1, flexDirection: "row" },
  ribbonMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14 },
  ribbonCopy: { flex: 1, minWidth: 0 },
  ribbonTitle: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  ribbonMeta: { fontFamily: "Inter_400Regular", fontSize: 10, marginTop: 4 },
  diffStats: { fontFamily: "Inter_700Bold", fontSize: 11 },
  ribbonButton: { width: 48, alignItems: "center", justifyContent: "center", borderLeftWidth: 1 },
  errorWrap: { paddingHorizontal: 12, paddingTop: 10 },
  threadEmpty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  emptyBot: { width: 62, height: 62, borderRadius: 20, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  emptyTitle: { fontFamily: "Inter_700Bold", fontSize: 20 },
  emptyBody: { maxWidth: 330, fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: 9 },
  messages: { padding: 16, paddingBottom: 24 },
  message: { marginBottom: 25 },
  userMessage: { alignItems: "flex-end" },
  messageHeading: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 9, alignSelf: "stretch" },
  messageAvatar: { width: 28, height: 28, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  you: { fontFamily: "Inter_700Bold", fontSize: 8 },
  messageAuthor: { flex: 1, fontFamily: "Inter_600SemiBold", fontSize: 11 },
  partList: { width: "100%", gap: 8 },
  messageText: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 22 },
  userBubble: { alignSelf: "flex-end", maxWidth: "88%", borderRadius: 17, borderBottomRightRadius: 5, paddingHorizontal: 14, paddingVertical: 10 },
  reasoning: { borderLeftWidth: 2, borderRadius: 10, padding: 11 },
  reasoningHeading: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 5 },
  reasoningLabel: { fontFamily: "Inter_700Bold", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.7 },
  reasoningText: { fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18 },
  messageImage: { width: 210, height: 160, borderRadius: 14, alignSelf: "flex-end" },
  tool: { minHeight: 54, borderWidth: 1, borderRadius: 13, padding: 10, flexDirection: "row", alignItems: "center", gap: 9 },
  toolIcon: { width: 32, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  toolCopy: { flex: 1, minWidth: 0 },
  toolName: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  toolSummary: { fontFamily: "Inter_400Regular", fontSize: 10, lineHeight: 14, marginTop: 4 },
  composerWrap: { borderTopWidth: 1, paddingHorizontal: 10, paddingTop: 8, paddingBottom: 7 },
  attachment: { alignSelf: "flex-start", marginBottom: 7, marginLeft: 4 },
  attachmentImage: { width: 58, height: 58, borderRadius: 11 },
  removeAttachment: { position: "absolute", right: -5, top: -5, width: 22, height: 22, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  controls: { gap: 7, paddingBottom: 8, paddingHorizontal: 3 },
  controlChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  controlText: { fontFamily: "Inter_600SemiBold", fontSize: 10 },
  composer: { borderRadius: 16, borderWidth: 1, padding: 9 },
  prompt: { minHeight: 42, maxHeight: 116, fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20, paddingHorizontal: 3, paddingTop: 3 },
  composerActions: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 5 },
  smallAction: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  modelButton: { flex: 1, flexDirection: "row", alignItems: "center", gap: 4 },
  modelText: { maxWidth: 165, fontFamily: "Inter_600SemiBold", fontSize: 10 },
  sendButton: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  gitBar: { minHeight: 39, flexDirection: "row", alignItems: "center", gap: 5, paddingTop: 5 },
  gitSummary: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 5 },
  gitText: { flex: 1, fontFamily: "Inter_500Medium", fontSize: 10, textTransform: "capitalize" },
  gitAction: { minHeight: 30, borderRadius: 9, paddingHorizontal: 9, flexDirection: "row", alignItems: "center", gap: 5 },
  gitActionText: { fontFamily: "Inter_600SemiBold", fontSize: 10 },
});
