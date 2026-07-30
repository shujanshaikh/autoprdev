import { api } from "@autopr/backend/convex/_generated/api";
import { useUploadFile } from "@convex-dev/r2/react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useAction, useConvex, useMutation, useQuery } from "convex/react";
import {
  Archive,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  GitBranch,
  GitPullRequest,
  ImagePlus,
  Layers,
  MessageSquare,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  Square,
  Trash2,
  Video,
  X,
} from "lucide-react-native";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { GlassSurface } from "../components/GlassSurface";
import { ModelReasoningSheet } from "../components/ModelReasoningSheet";
import { OpenAIIcon } from "../components/OpenAIIcon";
import { EmptyState, ErrorNotice, LoadingState, PrimaryButton, SecondaryButton, StatusPill } from "../components/ui";
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
  const scrollRef = useRef<ScrollView>(null);
  const promptRef = useRef<TextInput>(null);

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

  useEffect(() => {
    if (!route.params.focusComposer || project === undefined) return;
    const timer = setTimeout(() => {
      scrollRef.current?.scrollTo({ y: 185, animated: true });
      promptRef.current?.focus();
      navigation.setParams({ focusComposer: undefined });
    }, 280);
    return () => clearTimeout(timer);
  }, [navigation, project, route.params.focusComposer]);

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
  const promptReady = ready && codex.data?.connected === true;
  const promptPlaceholder = !ready
    ? "Workspace is still being prepared…"
    : codex.data?.connected === false
      ? "Connect Codex in Settings"
      : `Ask ${project.repoName || "the agent"} anything…`;
  return (
    <SafeAreaView edges={["bottom"]} style={[styles.screen, { backgroundColor: theme.screen }]}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={[styles.repoCard, { backgroundColor: theme.surface, borderColor: theme.line }]}>
          <View style={styles.repoTop}>
            <View style={[styles.repoMark, { backgroundColor: theme.accentSoft }]}>
              <GitBranch color={theme.accent} size={22} />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Switch branch. Current branch ${branch}`}
              onPress={() => navigation.navigate("Branches", {
                projectId,
                owner: project.repoOwner,
                repo: project.repoName,
                currentBranch: branch,
              })}
              style={({ pressed }) => [styles.repoCopy, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Text numberOfLines={1} style={[styles.repoName, { color: theme.ink }]}>{project.repoFullName}</Text>
              <View style={styles.branchLine}>
                <Text numberOfLines={1} style={[styles.branch, { color: theme.muted }]}>{branch}</Text>
                <ChevronRight color={theme.faint} size={14} />
              </View>
            </Pressable>
            <StatusPill
              label={project.sandboxRuntimeStatus ?? project.sandboxStatus}
              tone={ready ? "success" : project.sandboxStatus === "failed" ? "danger" : "warning"}
            />
          </View>
          {project.sandboxError ? <ErrorNotice message={project.sandboxError} /> : null}
          <View style={styles.actions}>
            <PrimaryButton
              compact
              icon={Plus}
              label="New task"
              loading={creating}
              disabled={!ready}
              onPress={() => void newThread()}
              style={styles.flexButton}
            />
            <SecondaryButton
              compact
              icon={project.sandboxRuntimeStatus === "started" ? Square : Play}
              label={project.sandboxRuntimeStatus === "started" ? "Stop" : "Start"}
              disabled={!ready || runtimeBusy}
              onPress={() => void toggleRuntime()}
            />
          </View>
        </View>

        {error ? <ErrorNotice message={error} /> : null}

        <View style={styles.promptSection}>
          <Text style={[styles.promptEyebrow, { color: theme.faint }]}>NEW TASK</Text>
          <Text style={[styles.promptTitle, { color: theme.ink }]}>What do you want to work on?</Text>
          <View style={styles.promptMeta}>
            <GitBranch color={theme.faint} size={12} />
            <Text numberOfLines={1} style={[styles.promptMetaText, { color: theme.muted }]}>{project.repoFullName}</Text>
            <Text style={[styles.promptMetaDot, { color: theme.faint }]}>·</Text>
            <Text numberOfLines={1} style={[styles.promptMetaText, { color: theme.muted }]}>{branch}</Text>
          </View>

          <GlassSurface interactive radius={18} style={styles.promptBox}>
            {pendingImages.length > 0 ? (
              <FlatList
                horizontal
                data={pendingImages}
                keyExtractor={(image) => image.id}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.promptImages}
                renderItem={renderPromptImage}
              />
            ) : null}
            <TextInput
              ref={promptRef}
              accessibilityLabel="Task prompt"
              editable={!creating && promptReady}
              multiline
              value={prompt}
              onChangeText={setPrompt}
              placeholder={promptPlaceholder}
              placeholderTextColor={theme.faint}
              style={[styles.taskInput, { color: theme.ink }]}
            />
            <View style={styles.promptToolbar}>
              <Pressable
                accessibilityLabel="Add photos"
                disabled={!promptReady || creating}
                onPress={() => void chooseImages()}
                style={[styles.promptToolButton, { backgroundColor: theme.surfaceSoft }]}
              >
                <ImagePlus color={theme.muted} size={17} />
              </Pressable>
              <Pressable
                accessibilityLabel="Choose model and reasoning"
                onPress={() => setShowPromptControls((value) => !value)}
                style={styles.promptSelector}
              >
                <OpenAIIcon size={16} />
                <Text numberOfLines={1} style={[styles.promptSelectorText, { color: theme.muted }]}>
                  {formatCodexModelLabel(selectedModel)} · {formatReasoningEffort(reasoningEffort)}
                </Text>
                <ChevronDown color={theme.faint} size={13} />
              </Pressable>
              <Pressable
                accessibilityLabel="Send task"
                disabled={!promptReady || creating || (!prompt.trim() && pendingImages.length === 0)}
                onPress={() => void newThread()}
                style={[
                  styles.promptSend,
                  {
                    backgroundColor: theme.accent,
                    opacity: !promptReady || creating || (!prompt.trim() && pendingImages.length === 0) ? 0.35 : 1,
                  },
                ]}
              >
                <ArrowUp color={theme.accentInk} size={18} strokeWidth={2.6} />
              </Pressable>
            </View>
          </GlassSurface>

          <View style={styles.taskOptions}>
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: workspaceMode === "worktree" }}
              onPress={() => setWorkspaceMode((value) => value === "checkout" ? "worktree" : "checkout")}
              style={[styles.taskOption, { backgroundColor: theme.surfaceSoft }]}
            >
              <Layers color={theme.muted} size={14} />
              <Text style={[styles.taskOptionText, { color: theme.muted }]}>
                {workspaceMode === "checkout" ? "Current checkout" : "New worktree"}
              </Text>
            </Pressable>
            {userSettings?.demoRecordingExperimentEnabled ? (
              <Pressable
                accessibilityRole="switch"
                accessibilityState={{ checked: demoEnabled }}
                onPress={() => setDemoEnabled((value) => !value)}
                style={[styles.taskOption, { backgroundColor: demoEnabled ? theme.accentSoft : theme.surfaceSoft }]}
              >
                <Video color={demoEnabled ? theme.accent : theme.muted} size={14} />
                <Text style={[styles.taskOptionText, { color: demoEnabled ? theme.ink : theme.muted }]}>Demo</Text>
              </Pressable>
            ) : null}
          </View>

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
          <GitPullRequest color={theme.accent} size={19} />
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
              title="Start the first task"
              body="Describe a change and AutoPR will prepare an isolated branch, run the agent, and collect the diff."
              action={
                <PrimaryButton
                  icon={Plus}
                  label="New task"
                  loading={creating}
                  disabled={!ready}
                  onPress={() => void newThread()}
                />
              }
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
                    const archived = thread.settledOverride === "settled";
                    Alert.alert(thread.title, undefined, [
                      {
                        text: "Open",
                        onPress: () => navigation.navigate("Thread", {
                          projectId,
                          threadId: thread.threadId,
                          title: thread.title,
                        }),
                      },
                      {
                        text: archived ? "Restore" : "Archive",
                        onPress: () => void setSettlement({
                          threadId: thread.threadId,
                          settled: !archived,
                        }),
                      },
                      {
                        text: "Delete",
                        style: "destructive",
                        onPress: () => confirmRemoveThread(thread.threadId, thread.title),
                      },
                      { text: "Cancel", style: "cancel" },
                    ]);
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
  repoCard: { borderRadius: 10, borderWidth: 1, padding: 15, gap: 14 },
  repoTop: { flexDirection: "row", alignItems: "center", gap: 11 },
  repoMark: { width: 44, height: 44, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  repoCopy: { flex: 1, minWidth: 0 },
  repoName: { fontFamily: "Inter_700Bold", fontSize: 15 },
  branchLine: { flexDirection: "row", alignItems: "center", gap: 2, marginTop: 5 },
  branch: { flexShrink: 1, fontFamily: "Inter_400Regular", fontSize: 12 },
  actions: { flexDirection: "row", gap: 9 },
  flexButton: { flex: 1 },
  promptSection: { alignItems: "center", paddingVertical: 18 },
  promptEyebrow: { fontFamily: "Inter_700Bold", fontSize: 9, letterSpacing: 1.8 },
  promptTitle: { marginTop: 8, fontFamily: "Inter_700Bold", fontSize: 24, letterSpacing: -0.8, textAlign: "center" },
  promptMeta: { maxWidth: "100%", marginTop: 9, marginBottom: 18, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  promptMetaText: { flexShrink: 1, fontFamily: "Inter_500Medium", fontSize: 10 },
  promptMetaDot: { fontFamily: "Inter_700Bold", fontSize: 10 },
  promptBox: { width: "100%", minHeight: 128, padding: 10 },
  promptImages: { gap: 8, paddingHorizontal: 3, paddingTop: 2, paddingBottom: 8 },
  promptImage: { width: 62, height: 62, borderRadius: 10 },
  removeImage: { position: "absolute", right: -5, top: -5, width: 21, height: 21, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  taskInput: { minHeight: 72, maxHeight: 154, paddingHorizontal: 6, paddingTop: 6, paddingBottom: 8, fontFamily: "Inter_400Regular", fontSize: 15, lineHeight: 22 },
  promptToolbar: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 5 },
  promptToolButton: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  promptSelector: { flex: 1, minWidth: 0, minHeight: 34, paddingHorizontal: 7, flexDirection: "row", alignItems: "center", gap: 4 },
  promptSelectorText: { flexShrink: 1, fontFamily: "Inter_600SemiBold", fontSize: 10 },
  promptSend: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  taskOptions: { width: "100%", marginTop: 9, flexDirection: "row", justifyContent: "flex-end", gap: 6 },
  taskOption: { minHeight: 32, borderRadius: 16, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 6 },
  taskOptionText: { fontFamily: "Inter_600SemiBold", fontSize: 10 },
  quickActions: { marginTop: 13, flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 7 },
  quickAction: { minHeight: 31, borderRadius: 16, borderWidth: 1, paddingHorizontal: 11, alignItems: "center", justifyContent: "center" },
  quickActionText: { fontFamily: "Inter_500Medium", fontSize: 10 },
  pullRow: {
    minHeight: 54,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 15,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  pullText: { flex: 1, fontFamily: "Inter_600SemiBold", fontSize: 13 },
  threadHeading: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginTop: 10,
    paddingHorizontal: 2,
  },
  sectionTitle: { fontFamily: "Inter_700Bold", fontSize: 18, letterSpacing: -0.4 },
  count: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
  threadSearch: { height: 42, borderRadius: 8, borderWidth: 1, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", gap: 8 },
  threadSearchInput: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 12 },
  filters: { borderRadius: 8, padding: 3, flexDirection: "row", gap: 3 },
  filter: { flex: 1, minHeight: 33, borderRadius: 6, borderWidth: 1, borderColor: "transparent", alignItems: "center", justifyContent: "center" },
  filterText: { fontFamily: "Inter_600SemiBold", fontSize: 10 },
  emptyWrap: { minHeight: 330 },
  filteredEmpty: { minHeight: 160, alignItems: "center", justifyContent: "center", padding: 24 },
  filteredEmptyTitle: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
  filteredEmptyBody: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 6 },
  threadList: { borderRadius: 10, borderWidth: 1, overflow: "hidden" },
  threadRow: { minHeight: 76, padding: 13, flexDirection: "row", alignItems: "center", gap: 9 },
  threadCopy: { flex: 1, minWidth: 0 },
  threadTitleLine: { flexDirection: "row", alignItems: "center", gap: 7 },
  threadTitle: { flexShrink: 1, fontFamily: "Inter_600SemiBold", fontSize: 14 },
  threadMeta: { fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 7 },
  threadMenu: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  liveDot: { width: 7, height: 7, borderRadius: 999 },
});
