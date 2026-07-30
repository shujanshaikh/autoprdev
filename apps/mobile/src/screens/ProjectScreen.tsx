import { api } from "@autopr/backend/convex/_generated/api";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Archive,
  ChevronRight,
  GitBranch,
  GitPullRequest,
  MessageSquare,
  Play,
  Plus,
  Search,
  Square,
  Trash2,
} from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { EmptyState, ErrorNotice, LoadingState, PrimaryButton, SecondaryButton, StatusPill } from "../components/ui";
import { useAppTheme } from "../hooks/useAppTheme";
import type { RootStackParamList } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "Project">;

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
  const markOpened = useMutation(api.projects.markOpened);
  const startSandbox = useAction(api.projectActions.startSandbox);
  const stopSandbox = useAction(api.projectActions.stopSandbox);
  const removeProject = useAction(api.projectActions.removeWithSandbox);
  const removeThread = useAction(api.projectActions.removeThreadWithWorktree);
  const [creating, setCreating] = useState(false);
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [threadFilter, setThreadFilter] = useState<"active" | "archived" | "all">("active");

  useEffect(() => {
    if (project?.projectId) void markOpened({ projectId: project.projectId });
  }, [markOpened, project?.projectId]);

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

  const newThread = async () => {
    setCreating(true);
    setError(null);
    try {
      const threadId = await createThread({ projectId, workspaceMode: "worktree" });
      navigation.navigate("Thread", { projectId, threadId, title: "New thread" });
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

  return (
    <SafeAreaView edges={["bottom"]} style={[styles.screen, { backgroundColor: theme.screen }]}>
      <ScrollView contentContainerStyle={styles.content}>
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
                <ChevronRight color={theme.faint} size={17} />
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
  liveDot: { width: 7, height: 7, borderRadius: 999 },
});
