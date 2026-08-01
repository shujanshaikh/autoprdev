import { api } from "@autopr/backend/convex/_generated/api";
import { useUploadFile } from "@convex-dev/r2/react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useAction, useConvex, useMutation, useQuery } from "convex/react";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  GitBranch,
  GitPullRequest,
  Layers,
  MessageSquare,
  MoreHorizontal,
  Search,
  Trash2,
  Video,
  X,
} from "lucide-react-native";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  InteractionManager,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Composer } from "../components/Composer";
import { ModelReasoningSheet } from "../components/ModelReasoningSheet";
import { EmptyState, ErrorNotice, LoadingState, SecondaryButton, StatusPill } from "../components/ui";
import { useAppTheme } from "../hooks/useAppTheme";
import { useWebQuery } from "../hooks/useWebQuery";
import {
  DEFAULT_CODEX_REASONING_EFFORT,
  formatCodexModelLabel,
  formatReasoningEffort,
  getCodexModelOptions,
  getCodexReasoningEfforts,
  isCodexReasoningEffortForModel,
  selectCodexModel,
  type CodexReasoningEffort,
} from "../lib/codexModels";
import type { PromptFilePart, RootStackParamList } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "Project">;

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

const QUICK_ACTIONS = [
  "Summarize latest changes",
  "Review my latest PR",
  "Suggest a new feature",
  "Create a task for…",
] as const;

const PromptImageItem = memo(function PromptImageItem({
  image,
  onRemove,
}: {
  image: PendingImage;
  onRemove: (imageId: string) => void;
}) {
  const theme = useAppTheme();
  const remove = useCallback(() => onRemove(image.id), [image.id, onRemove]);
  return (
    <View>
      <Image source={{ uri: image.uri }} style={styles.promptImage} />
      <Pressable
        accessibilityLabel={`Remove ${image.fileName}`}
        onPress={remove}
        style={[styles.removeImage, { backgroundColor: theme.code }]}
      >
        <X color={theme.codeInk} size={12} />
      </Pressable>
    </View>
  );
});

function relativeTime(timestamp: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function ProjectScreen({ navigation, route }: Props) {
  const { projectId } = route.params;
  const theme = useAppTheme();
  const project = useQuery(api.projects.get, { projectId });
  const threads = useQuery(api.threads.listByProject, { projectId });
  const createThread = useMutation(api.threads.create);
  const setSettlement = useMutation(api.threads.setSettlement);
  const markOpened = useMutation(api.projects.markOpened);
  const startSandbox = useAction(api.projectActions.startSandbox);
  const stopSandbox = useAction(api.projectActions.stopSandbox);
  const removeProject = useAction(api.projectActions.removeWithSandbox);
  const removeThread = useAction(api.projectActions.removeThreadWithWorktree);
  const userSettings = useQuery(api.userSettings.get, {});
  const uploadImage = useUploadFile(api.imageUploads);
  const convex = useConvex();
  const codex = useWebQuery<CodexStatus>(["codex", "status"], "/api/codex/status", {
    staleTime: 60_000,
    retry: false,
  });
  const [creating, setCreating] = useState(false);
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [threadFilter, setThreadFilter] = useState<"active" | "archived" | "all">("active");
  const [prompt, setPrompt] = useState("");
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const [selectedModelChoice, setSelectedModelChoice] = useState<string>();
  const [reasoningEffort, setReasoningEffort] = useState<CodexReasoningEffort>(DEFAULT_CODEX_REASONING_EFFORT);
  const [workspaceMode, setWorkspaceMode] = useState<"checkout" | "worktree">("checkout");
  const [demoEnabled, setDemoEnabled] = useState(false);
  const [showPromptControls, setShowPromptControls] = useState(false);
  const [threadMenuTarget, setThreadMenuTarget] = useState<{
    threadId: string;
    title: string;
    archived: boolean;
  } | null>(null);

  const selectedModel = useMemo(
    () => selectCodexModel(codex.data?.models, selectedModelChoice),
    [codex.data?.models, selectedModelChoice],
  );
  const modelOptions = useMemo(
    () => getCodexModelOptions(codex.data?.models, selectedModel),
    [codex.data?.models, selectedModel],
  );
  const reasoningOptions = useMemo(() => getCodexReasoningEfforts(selectedModel), [selectedModel]);
  const removePromptImage = useCallback((imageId: string) => {
    setPendingImages((current) => current.filter((image) => image.id !== imageId));
  }, []);
  const renderPromptImage = useCallback(
    ({ item }: { item: PendingImage }) => <PromptImageItem image={item} onRemove={removePromptImage} />,
    [removePromptImage],
  );

  useEffect(() => {
    if (project?.projectId) void markOpened({ projectId: project.projectId });
  }, [markOpened, project?.projectId]);

  useEffect(() => {
    if (!isCodexReasoningEffortForModel(selectedModel, reasoningEffort)) {
      setReasoningEffort(getCodexReasoningEfforts(selectedModel)[0] ?? DEFAULT_CODEX_REASONING_EFFORT);
    }
  }, [reasoningEffort, selectedModel]);

  const filteredThreads = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (threads ?? []).filter((thread) => {
      const archived = thread.settledOverride === "settled";
      const matchesFilter = threadFilter === "all"
        || (threadFilter === "archived" ? archived : !archived);
      const matchesSearch = !query || [
        thread.title,
        thread.featureBranch,
        thread.baseBranch,
      ].some((value) => value?.toLowerCase().includes(query));
      return matchesFilter && matchesSearch;
    });
  }, [search, threadFilter, threads]);

  if (project === undefined || threads === undefined) return <LoadingState label="Opening project…" />;
  if (!project) {
    return <EmptyState icon={GitBranch} title="Project not found" body="This workspace may have been removed." />;
  }

  const chooseImages = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
      allowsMultipleSelection: true,
      selectionLimit: 6,
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

  const uploadPendingImages = async (): Promise<PromptFilePart[]> => await Promise.all(pendingImages.map(async (image) => {
    const imageResponse = await fetch(image.uri);
    if (!imageResponse.ok) throw new Error(`Could not read ${image.fileName}.`);
    const blob = await imageResponse.blob();
    const file = Object.assign(blob, { name: image.fileName, lastModified: Date.now() }) as File;
    const key = await uploadImage(file);
    const url = await convex.query(api.imageUploads.getUrl, { key });
    return {
      type: "file" as const,
      filename: image.fileName,
      mediaType: image.mediaType,
      url,
      providerMetadata: { autopr: { r2Key: key } },
    };
  }));

  const newThread = async (initialPrompt?: string) => {
    const text = (initialPrompt ?? prompt).trim();
    setCreating(true);
    setError(null);
    try {
      const initialFiles = await uploadPendingImages();
      const threadId = await createThread({
        projectId,
        title: "New thread",
        workspaceMode,
        demoEnabled: Boolean(userSettings?.demoRecordingExperimentEnabled && demoEnabled),
      });
      navigation.navigate("Thread", {
        projectId,
        threadId,
        title: "New thread",
        ...(text ? { initialPrompt: text } : {}),
        ...(initialFiles.length > 0 ? { initialFiles } : {}),
        ...(selectedModel ? { initialModel: selectedModel } : {}),
        initialReasoningEffort: reasoningEffort,
      });
      setPrompt("");
      setPendingImages([]);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not create a thread.");
    } finally {
      setCreating(false);
    }
  };

  const toggleRuntime = async () => {
    setRuntimeBusy(true);
    setError(null);
    try {
      if (project.sandboxRuntimeStatus === "started") {
        await stopSandbox({ projectId });
      } else {
        await startSandbox({ projectId });
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not update the workspace.");
    } finally {
      setRuntimeBusy(false);
    }
  };

  const confirmRemoveThread = (threadId: string, title: string) => {
    Alert.alert(
      `Delete “${title}”?`,
      "The conversation and its isolated worktree will be removed.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => void removeThread({ projectId, threadId }).catch((cause) => {
            setError(cause instanceof Error ? cause.message : "Could not delete the conversation.");
          }),
        },
      ],
    );
  };

  const branch = project.currentBranch ?? project.repoBranch ?? project.defaultBranch ?? "Unknown branch";
  const ready = project.sandboxStatus === "ready";
  const running = ready && project.sandboxRuntimeStatus === "started";
  const promptReady = ready && codex.data?.connected === true;
  const promptPlaceholder = !ready
    ? "Workspace is still being prepared…"
    : codex.data?.connected === false
      ? "Connect Codex in Settings"
      : `Ask ${project.repoName || "the agent"} anything…`;
  const runtime = !ready
    ? {
        label: project.sandboxStatus === "failed" ? "Sandbox failed" : "Preparing sandbox…",
        tone: project.sandboxStatus === "failed" ? theme.danger : theme.warning,
      }
    : running
      ? { label: "Sandbox running", tone: theme.success }
      : project.sandboxRuntimeStatus === "archived"
        ? { label: "Sandbox archived", tone: theme.warning }
        : { label: "Sandbox stopped", tone: theme.faint };
  const runtimeAction = runtimeBusy
    ? running ? "Stopping…" : "Starting…"
    : running ? "Stop" : "Start";
  return (
    <SafeAreaView edges={["bottom"]} style={[styles.screen, { backgroundColor: theme.screen }]}>
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.content}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
      >
        {error ? <ErrorNotice message={error} /> : null}
        {project.sandboxError ? <ErrorNotice message={project.sandboxError} /> : null}

        <View style={styles.promptSection}>
          <Text style={[styles.promptTitle, { color: theme.ink }]}>What do you want to work on?</Text>
          <View style={styles.promptMeta}>
            <GitBranch color={theme.faint} size={12} />
            <Text numberOfLines={1} style={[styles.promptMetaText, { color: theme.muted }]}>
              {project.repoFullName}
            </Text>
          </View>

          <View style={styles.promptBox}>
            <Composer
              alwaysExpanded
              attachments={pendingImages.length > 0 ? (
                <FlatList
                  horizontal
                  data={pendingImages}
                  keyExtractor={(image) => image.id}
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.promptImages}
                  style={styles.promptImageList}
                  renderItem={renderPromptImage}
                />
              ) : null}
              autoFocus={Boolean(route.params.focusComposer)}
              canSend={promptReady && !creating && (Boolean(prompt.trim()) || pendingImages.length > 0)}
              editable={promptReady && !creating}
              hasAttachments={pendingImages.length > 0}
              modelLabel={formatCodexModelLabel(selectedModel)}
              onAddImage={() => void chooseImages()}
              onChangeText={setPrompt}
              onPressModel={() => setShowPromptControls(true)}
              onPressReasoning={() => setShowPromptControls(true)}
              onSend={() => void newThread()}
              placeholder={promptPlaceholder}
              reasoningLabel={formatReasoningEffort(reasoningEffort)}
              sending={creating}
              value={prompt}
            />
          </View>

          <View style={styles.taskOptions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Switch branch. Current branch ${branch}`}
              onPress={() => navigation.navigate("Branches", {
                projectId,
                owner: project.repoOwner,
                repo: project.repoName,
                currentBranch: branch,
              })}
              style={({ pressed }) => [styles.taskOption, { opacity: pressed ? 0.55 : 1 }]}
            >
              <GitBranch color={theme.faint} size={13} />
              <Text numberOfLines={1} style={[styles.taskOptionText, { color: theme.muted }]}>{branch}</Text>
              <ChevronDown color={theme.faint} size={12} />
            </Pressable>
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: workspaceMode === "worktree" }}
              onPress={() => setWorkspaceMode((value) => value === "checkout" ? "worktree" : "checkout")}
              style={({ pressed }) => [styles.taskOption, { opacity: pressed ? 0.55 : 1 }]}
            >
              <Layers
                color={workspaceMode === "worktree" ? theme.accentOn : theme.faint}
                size={13}
              />
              <Text
                numberOfLines={1}
                style={[
                  styles.taskOptionText,
                  { color: workspaceMode === "worktree" ? theme.ink : theme.muted },
                ]}
              >
                {workspaceMode === "checkout" ? "Current checkout" : "New worktree"}
              </Text>
            </Pressable>
            {userSettings?.demoRecordingExperimentEnabled ? (
              <Pressable
                accessibilityRole="switch"
                accessibilityState={{ checked: demoEnabled }}
                onPress={() => setDemoEnabled((value) => !value)}
                style={({ pressed }) => [styles.taskOption, { opacity: pressed ? 0.55 : 1 }]}
              >
                <Video color={demoEnabled ? theme.accentOn : theme.faint} size={13} />
                <Text style={[styles.taskOptionText, { color: demoEnabled ? theme.ink : theme.muted }]}>
                  Demo
                </Text>
              </Pressable>
            ) : null}
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={running ? "Stop the sandbox" : "Start the sandbox"}
            accessibilityState={{ disabled: !ready || runtimeBusy }}
            disabled={!ready || runtimeBusy}
            onPress={() => void toggleRuntime()}
            style={({ pressed }) => [
              styles.runtimeRow,
              { borderColor: theme.line, opacity: pressed || runtimeBusy ? 0.6 : 1 },
            ]}
          >
            {runtimeBusy
              ? <ActivityIndicator color={theme.muted} size="small" />
              : <View style={[styles.statusDot, { backgroundColor: runtime.tone }]} />}
            <Text numberOfLines={1} style={[styles.runtimeLabel, { color: theme.muted }]}>{runtime.label}</Text>
            {ready ? (
              <>
                <Text style={[styles.runtimeSeparator, { color: theme.faint }]}>·</Text>
                <Text style={[styles.runtimeAction, { color: theme.ink }]}>{runtimeAction}</Text>
              </>
            ) : null}
          </Pressable>

          <View style={styles.quickActions}>
            {QUICK_ACTIONS.map((action) => (
              <Pressable
                key={action}
                disabled={!promptReady || creating}
                onPress={() => {
                  setPrompt(action);
                  void newThread(action);
                }}
                style={[styles.quickAction, { borderColor: theme.line, opacity: promptReady ? 1 : 0.45 }]}
              >
                <Text style={[styles.quickActionText, { color: theme.muted }]}>{action}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Pressable
          onPress={() => navigation.navigate("PullRequests", { projectId, title: project.repoName })}
          style={({ pressed }) => [
            styles.pullRow,
            { backgroundColor: pressed ? theme.surfaceSoft : theme.surface, borderColor: theme.line },
          ]}
        >
          <GitPullRequest color={theme.accentOn} size={19} />
          <Text style={[styles.pullText, { color: theme.ink }]}>GitHub pull requests</Text>
          <ChevronRight color={theme.faint} size={18} />
        </Pressable>

        <View style={styles.threadHeading}>
          <Text style={[styles.sectionTitle, { color: theme.ink }]}>Conversations</Text>
          <Text style={[styles.count, { color: theme.faint }]}>{String(filteredThreads.length).padStart(2, "0")}</Text>
        </View>

        {threads.length > 0 ? (
          <>
            <View style={[styles.threadSearch, { backgroundColor: theme.surfaceSoft, borderColor: theme.line }]}>
              <Search color={theme.faint} size={15} />
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                value={search}
                onChangeText={setSearch}
                placeholder="Search conversations"
                placeholderTextColor={theme.faint}
                style={[styles.threadSearchInput, { color: theme.ink }]}
              />
            </View>
            <View style={[styles.filters, { backgroundColor: theme.surfaceSoft }]}>
              {(["active", "archived", "all"] as const).map((filter) => {
                const selected = threadFilter === filter;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    key={filter}
                    onPress={() => setThreadFilter(filter)}
                    style={[
                      styles.filter,
                      selected && { backgroundColor: theme.surface, borderColor: theme.line },
                    ]}
                  >
                    <Text style={[styles.filterText, { color: selected ? theme.ink : theme.muted }]}>
                      {filter[0]?.toUpperCase()}{filter.slice(1)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        {threads.length === 0 ? (
          <View style={styles.emptyWrap}>
            <EmptyState
              icon={MessageSquare}
              title="No conversations yet"
              body="Describe a change in the box above and AutoPR will prepare a branch, run the agent, and collect the diff."
            />
          </View>
        ) : filteredThreads.length === 0 ? (
          <View style={styles.filteredEmpty}>
            <Text style={[styles.filteredEmptyTitle, { color: theme.ink }]}>No matching conversations</Text>
            <Text style={[styles.filteredEmptyBody, { color: theme.muted }]}>
              Try another search or change the filter.
            </Text>
          </View>
        ) : (
          <View style={[styles.threadList, { borderColor: theme.line, backgroundColor: theme.surface }]}>
            {filteredThreads.map((thread, index) => (
              <Pressable
                key={thread.threadId}
                onPress={() => navigation.navigate("Thread", {
                  projectId,
                  threadId: thread.threadId,
                  title: thread.title,
                })}
                onLongPress={() => confirmRemoveThread(thread.threadId, thread.title)}
                style={({ pressed }) => [
                  styles.threadRow,
                  index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line },
                  { backgroundColor: pressed ? theme.surfaceSoft : theme.surface },
                ]}
              >
                <View style={styles.threadCopy}>
                  <View style={styles.threadTitleLine}>
                    {thread.isLive ? <View style={[styles.liveDot, { backgroundColor: theme.success }]} /> : null}
                    <Text numberOfLines={1} style={[styles.threadTitle, { color: theme.ink }]}>{thread.title}</Text>
                    {thread.settledOverride === "settled" ? <Archive color={theme.faint} size={13} /> : null}
                  </View>
                  <Text numberOfLines={1} style={[styles.threadMeta, { color: theme.muted }]}>
                    {thread.featureBranch ?? thread.baseBranch ?? branch} · {relativeTime(thread.updatedAt)}
                  </Text>
                </View>
                {thread.pullRequestNumber ? (
                  <StatusPill label={`PR #${thread.pullRequestNumber}`} tone="accent" />
                ) : thread.isLive ? (
                  <StatusPill label="Agent working" tone="success" />
                ) : null}
                <Pressable
                  accessibilityLabel={`Conversation actions for ${thread.title}`}
                  onPress={(event) => {
                    event.stopPropagation();
                    setThreadMenuTarget({
                      threadId: thread.threadId,
                      title: thread.title,
                      archived: thread.settledOverride === "settled",
                    });
                  }}
                  style={styles.threadMenu}
                >
                  <MoreHorizontal color={theme.faint} size={18} />
                </Pressable>
              </Pressable>
            ))}
          </View>
        )}
        <SecondaryButton
          destructive
          icon={Trash2}
          label="Delete project"
          onPress={() => Alert.alert(
            `Delete ${project.repoFullName}?`,
            "The Daytona sandbox, conversations, and project record will be removed.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Delete",
                style: "destructive",
                onPress: () => void removeProject({ projectId })
                  .then(() => navigation.popToTop())
                  .catch((cause) => {
                    setError(cause instanceof Error ? cause.message : "Could not delete the project.");
                  }),
              },
            ],
          )}
        />
      </ScrollView>
      <Modal
        animationType="slide"
        onRequestClose={() => setThreadMenuTarget(null)}
        transparent
        visible={Boolean(threadMenuTarget)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            accessibilityLabel="Close conversation actions"
            onPress={() => setThreadMenuTarget(null)}
            style={StyleSheet.absoluteFill}
          />
          <View style={[styles.threadMenuCard, { backgroundColor: theme.surfaceRaised, borderColor: theme.line }]}>
            <View style={styles.threadMenuHeading}>
              <Text numberOfLines={1} style={[styles.threadMenuTitle, { color: theme.ink }]}>
                {threadMenuTarget?.title}
              </Text>
              <Text style={[styles.threadMenuBody, { color: theme.muted }]}>
                Manage this conversation.
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                if (!threadMenuTarget) return;
                const target = threadMenuTarget;
                setThreadMenuTarget(null);
                navigation.navigate("Thread", {
                  projectId,
                  threadId: target.threadId,
                  title: target.title,
                });
              }}
              style={({ pressed }) => [
                styles.threadMenuAction,
                { backgroundColor: pressed ? theme.surfaceSoft : theme.surface, borderColor: theme.line },
              ]}
            >
              <MessageSquare color={theme.ink} size={18} />
              <Text style={[styles.threadMenuActionText, { color: theme.ink }]}>Open conversation</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                if (!threadMenuTarget) return;
                const target = threadMenuTarget;
                setThreadMenuTarget(null);
                void setSettlement({
                  threadId: target.threadId,
                  settled: !target.archived,
                }).catch((cause) => {
                  setError(cause instanceof Error ? cause.message : "Could not update the conversation.");
                });
              }}
              style={({ pressed }) => [
                styles.threadMenuAction,
                { backgroundColor: pressed ? theme.surfaceSoft : theme.surface, borderColor: theme.line },
              ]}
            >
              <Archive color={theme.ink} size={18} />
              <Text style={[styles.threadMenuActionText, { color: theme.ink }]}>
                {threadMenuTarget?.archived ? "Restore conversation" : "Archive conversation"}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                if (!threadMenuTarget) return;
                const target = threadMenuTarget;
                setThreadMenuTarget(null);
                InteractionManager.runAfterInteractions(() => {
                  confirmRemoveThread(target.threadId, target.title);
                });
              }}
              style={({ pressed }) => [
                styles.threadMenuAction,
                { backgroundColor: pressed ? theme.dangerSoft : theme.surface, borderColor: theme.line },
              ]}
            >
              <Trash2 color={theme.danger} size={18} />
              <Text style={[styles.threadMenuActionText, { color: theme.danger }]}>Delete conversation</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setThreadMenuTarget(null)}
              style={[styles.threadMenuCancel, { backgroundColor: theme.surfaceSoft }]}
            >
              <Text style={[styles.threadMenuCancelText, { color: theme.muted }]}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <ModelReasoningSheet
        visible={showPromptControls}
        models={modelOptions}
        selectedModel={selectedModel}
        reasoningEfforts={reasoningOptions}
        selectedReasoningEffort={reasoningEffort}
        onSelectModel={setSelectedModelChoice}
        onSelectReasoningEffort={setReasoningEffort}
        onClose={() => setShowPromptControls(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, paddingBottom: 36, gap: 14 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  runtimeRow: {
    alignSelf: "center",
    minHeight: 34,
    marginTop: 14,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  runtimeLabel: { flexShrink: 1, fontFamily: "DMSans_500Medium", fontSize: 11 },
  runtimeSeparator: { fontFamily: "DMSans_500Medium", fontSize: 11 },
  runtimeAction: { fontFamily: "DMSans_700Bold", fontSize: 11 },
  promptSection: { alignItems: "center", paddingTop: 26, paddingBottom: 22 },
  promptTitle: { fontFamily: "DMSans_700Bold", fontSize: 25, letterSpacing: -0.8, textAlign: "center" },
  promptMeta: {
    maxWidth: "100%",
    marginTop: 10,
    marginBottom: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  promptMetaText: { flexShrink: 1, fontFamily: "DMSans_500Medium", fontSize: 11 },
  promptBox: { width: "100%" },
  promptImageList: { flexGrow: 0 },
  promptImages: { gap: 8, paddingRight: 3, paddingBottom: 11 },
  promptImage: { width: 62, height: 62, borderRadius: 10 },
  removeImage: { position: "absolute", right: -5, top: -5, width: 21, height: 21, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  taskOptions: {
    width: "100%",
    marginTop: 10,
    paddingHorizontal: 4,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: 4,
  },
  taskOption: {
    maxWidth: "100%",
    minHeight: 30,
    paddingHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  taskOptionText: { flexShrink: 1, fontFamily: "DMSans_500Medium", fontSize: 11 },
  quickActions: { marginTop: 18, flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8 },
  quickAction: {
    minHeight: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  quickActionText: { fontFamily: "DMSans_500Medium", fontSize: 11 },
  pullRow: {
    minHeight: 54,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 15,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  pullText: { flex: 1, fontFamily: "DMSans_500Medium", fontSize: 13 },
  threadHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginTop: 10,
    paddingHorizontal: 2,
  },
  sectionTitle: { fontFamily: "DMSans_700Bold", fontSize: 18, letterSpacing: -0.4 },
  count: { fontFamily: "DMSans_500Medium", fontSize: 11 },
  threadSearch: { height: 42, borderRadius: 8, borderWidth: 1, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", gap: 8 },
  threadSearchInput: { flex: 1, fontFamily: "DMSans_400Regular", fontSize: 12 },
  filters: { borderRadius: 8, padding: 3, flexDirection: "row", gap: 3 },
  filter: { flex: 1, minHeight: 33, borderRadius: 6, borderWidth: 1, borderColor: "transparent", alignItems: "center", justifyContent: "center" },
  filterText: { fontFamily: "DMSans_500Medium", fontSize: 10 },
  emptyWrap: { minHeight: 330 },
  filteredEmpty: { minHeight: 160, alignItems: "center", justifyContent: "center", padding: 24 },
  filteredEmptyTitle: { fontFamily: "DMSans_500Medium", fontSize: 14 },
  filteredEmptyBody: { fontFamily: "DMSans_400Regular", fontSize: 12, marginTop: 6 },
  threadList: { borderRadius: 10, borderWidth: 1, overflow: "hidden" },
  threadRow: { minHeight: 76, padding: 13, flexDirection: "row", alignItems: "center", gap: 9 },
  threadCopy: { flex: 1, minWidth: 0 },
  threadTitleLine: { flexDirection: "row", alignItems: "center", gap: 7 },
  threadTitle: { flexShrink: 1, fontFamily: "DMSans_500Medium", fontSize: 14 },
  threadMeta: { fontFamily: "DMSans_400Regular", fontSize: 11, marginTop: 7 },
  threadMenu: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  liveDot: { width: 7, height: 7, borderRadius: 999 },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.38)", padding: 14 },
  threadMenuCard: { borderWidth: 1, borderRadius: 18, padding: 12, gap: 8, marginBottom: 6 },
  threadMenuHeading: { paddingHorizontal: 4, paddingTop: 3, paddingBottom: 6 },
  threadMenuTitle: { fontFamily: "DMSans_700Bold", fontSize: 15 },
  threadMenuBody: { fontFamily: "DMSans_400Regular", fontSize: 11, marginTop: 4 },
  threadMenuAction: { minHeight: 52, borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 11 },
  threadMenuActionText: { flex: 1, fontFamily: "DMSans_500Medium", fontSize: 12 },
  threadMenuCancel: { minHeight: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", marginTop: 2 },
  threadMenuCancelText: { fontFamily: "DMSans_500Medium", fontSize: 12 },
});
