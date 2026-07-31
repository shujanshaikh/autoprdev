import { api } from "@autopr/backend/convex/_generated/api";
import type { Doc } from "@autopr/backend/convex/_generated/dataModel";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "convex/react";
import {
  Archive,
  ChevronRight,
  FolderGit2,
  GitBranch,
  MessageSquare,
  Plus,
  Search,
  Settings2,
} from "lucide-react-native";
import { memo, useCallback, useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { EmptyState, LoadingState, PrimaryButton, StatusPill } from "../components/ui";
import { useAppTheme } from "../hooks/useAppTheme";
import type { RootStackParamList } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "Projects">;
type ThreadFilter = "active" | "archived";

function relativeTime(timestamp: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

const projectKey = (project: Doc<"projects">) => project.projectId;
const threadKey = (thread: Doc<"threads">) => thread.threadId;

const ProjectCard = memo(function ProjectCard({
  project,
  onOpen,
}: {
  project: Doc<"projects">;
  onOpen: (projectId: string, title: string) => void;
}) {
  const theme = useAppTheme();
  const open = useCallback(
    () => onOpen(project.projectId, project.repoName),
    [onOpen, project.projectId, project.repoName],
  );
  return (
    <Pressable
      accessibilityRole="button"
      onPress={open}
      style={({ pressed }) => [
        styles.projectCard,
        {
          backgroundColor: pressed ? theme.surfaceSoft : theme.surface,
          borderColor: theme.line,
        },
      ]}
    >
      <View style={[styles.projectIcon, { backgroundColor: theme.accentSoft }]}>
        <FolderGit2 color={theme.accentOn} size={18} />
      </View>
      <Text numberOfLines={1} style={[styles.projectName, { color: theme.ink }]}>
        {project.repoName}
      </Text>
      <Text numberOfLines={1} style={[styles.projectOwner, { color: theme.muted }]}>
        {project.repoOwner}
      </Text>
      <View style={[
        styles.projectStatus,
        { backgroundColor: project.sandboxStatus === "ready" ? theme.success : theme.warning },
      ]} />
    </Pressable>
  );
});

const ThreadActivityRow = memo(function ThreadActivityRow({
  thread,
  projectName,
  onOpen,
}: {
  thread: Doc<"threads">;
  projectName: string;
  onOpen: (projectId: string, threadId: string, title: string) => void;
}) {
  const theme = useAppTheme();
  const open = useCallback(
    () => onOpen(thread.projectId, thread.threadId, thread.title),
    [onOpen, thread.projectId, thread.threadId, thread.title],
  );
  const archived = thread.settledOverride === "settled";
  const activityColor = thread.isLive ? theme.success : archived ? theme.faint : theme.accent;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={open}
      style={({ pressed }) => [
        styles.threadRow,
        {
          backgroundColor: pressed ? theme.surfaceSoft : theme.surface,
          borderColor: theme.line,
        },
      ]}
    >
      <View style={styles.activityRail}>
        <View style={[styles.activityDot, { backgroundColor: activityColor }]} />
        <View style={[styles.activityLine, { backgroundColor: theme.line }]} />
      </View>
      <View style={styles.threadCopy}>
        <View style={styles.threadTitleLine}>
          <Text numberOfLines={1} style={[styles.threadTitle, { color: theme.ink }]}>
            {thread.title}
          </Text>
          {archived ? <Archive color={theme.faint} size={13} /> : null}
        </View>
        <View style={styles.threadMetaLine}>
          <Text numberOfLines={1} style={[styles.threadMeta, { color: theme.muted }]}>
            {projectName}
          </Text>
          <Text style={[styles.metaDot, { color: theme.faint }]}>·</Text>
          <GitBranch color={theme.faint} size={11} />
          <Text numberOfLines={1} style={[styles.branch, { color: theme.muted }]}>
            {thread.featureBranch ?? thread.baseBranch ?? "branch"}
          </Text>
        </View>
        <Text style={[styles.updated, { color: theme.faint }]}>
          Updated {relativeTime(thread.updatedAt)} ago
        </Text>
      </View>
      {thread.isLive ? (
        <StatusPill label="Working" tone="success" />
      ) : thread.pullRequestNumber ? (
        <StatusPill label={`PR #${thread.pullRequestNumber}`} tone="accent" />
      ) : null}
      <ChevronRight color={theme.faint} size={17} />
    </Pressable>
  );
});

export function ProjectsScreen({ navigation }: Props) {
  const theme = useAppTheme();
  const projects = useQuery(api.projects.list, {});
  const threads = useQuery(api.threads.listForSidebar, {});
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ThreadFilter>("active");

  const projectById = useMemo(
    () => new Map((projects ?? []).map((project) => [project.projectId, project])),
    [projects],
  );
  const visibleThreads = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (threads ?? []).filter((thread) => {
      const archived = thread.settledOverride === "settled";
      if ((filter === "archived") !== archived) return false;
      if (!query) return true;
      const project = projectById.get(thread.projectId);
      return [
        thread.title,
        thread.featureBranch,
        thread.baseBranch,
        project?.repoFullName,
      ].some((value) => value?.toLowerCase().includes(query));
    });
  }, [filter, projectById, search, threads]);

  const openProject = useCallback((projectId: string, title: string) => {
    navigation.navigate("Project", { projectId, title });
  }, [navigation]);
  const openThread = useCallback((projectId: string, threadId: string, title: string) => {
    navigation.navigate("Thread", {
      projectId,
      threadId,
      title,
    });
  }, [navigation]);
  const renderProject = useCallback(
    ({ item }: { item: Doc<"projects"> }) => <ProjectCard project={item} onOpen={openProject} />,
    [openProject],
  );
  const renderThread = useCallback(
    ({ item }: { item: Doc<"threads"> }) => (
      <ThreadActivityRow
        thread={item}
        projectName={projectById.get(item.projectId)?.repoFullName ?? "Project"}
        onOpen={openThread}
      />
    ),
    [openThread, projectById],
  );

  if (projects === undefined || threads === undefined) {
    return <LoadingState label="Loading your work…" />;
  }

  if (projects.length === 0) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: theme.screen }]}>
        <View style={styles.emptyHeader}>
          <Text style={[styles.wordmark, { color: theme.ink }]}>AutoPR</Text>
          <Pressable
            accessibilityLabel="Open settings"
            onPress={() => navigation.navigate("Settings")}
            style={styles.headerButton}
          >
            <Settings2 color={theme.ink} size={20} />
          </Pressable>
        </View>
        <EmptyState
          icon={FolderGit2}
          title="Connect your first project"
          body="Add a GitHub repository, then start a task from the mobile composer."
          action={
            <PrimaryButton
              icon={Plus}
              label="Add GitHub project"
              onPress={() => navigation.navigate("AddProject")}
            />
          }
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} style={[styles.screen, { backgroundColor: theme.screen }]}>
      <View style={styles.header}>
        <View>
          <Text style={[styles.kicker, { color: theme.accentOn }]}>AUTOPR</Text>
          <Text style={[styles.title, { color: theme.ink }]}>Threads</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            accessibilityLabel="New task"
            onPress={() => navigation.navigate("NewTask")}
            style={({ pressed }) => [
              styles.newTaskButton,
              { backgroundColor: theme.accent, opacity: pressed ? 0.75 : 1 },
            ]}
          >
            <Plus color={theme.accentInk} size={18} strokeWidth={2.4} />
            <Text style={[styles.newTaskText, { color: theme.accentInk }]}>New</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Open settings"
            onPress={() => navigation.navigate("Settings")}
            style={({ pressed }) => [
              styles.headerButton,
              { backgroundColor: pressed ? theme.surfaceSoft : theme.surface, borderColor: theme.line },
            ]}
          >
            <Settings2 color={theme.ink} size={19} />
          </Pressable>
        </View>
      </View>

      <View style={styles.searchWrap}>
        <View style={[styles.search, { backgroundColor: theme.surfaceSoft, borderColor: theme.line }]}>
          <Search color={theme.faint} size={16} />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            value={search}
            onChangeText={setSearch}
            placeholder="Search threads, repositories, branches"
            placeholderTextColor={theme.faint}
            style={[styles.searchInput, { color: theme.ink }]}
          />
        </View>
        <View style={[styles.filters, { backgroundColor: theme.surfaceSoft }]}>
          {(["active", "archived"] as const).map((value) => {
            const selected = filter === value;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                key={value}
                onPress={() => setFilter(value)}
                style={[
                  styles.filter,
                  selected && { backgroundColor: theme.surfaceRaised, borderColor: theme.line },
                ]}
              >
                <Text style={[styles.filterText, { color: selected ? theme.ink : theme.muted }]}>
                  {value === "active" ? "Active" : "Archived"}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <FlatList
        data={visibleThreads}
        keyExtractor={threadKey}
        keyboardDismissMode="on-drag"
        contentContainerStyle={visibleThreads.length === 0 ? styles.emptyList : styles.list}
        ListHeaderComponent={(
          <View style={styles.projectsSection}>
            <View style={styles.sectionHeading}>
              <Text style={[styles.sectionTitle, { color: theme.ink }]}>Projects</Text>
              <Pressable
                accessibilityLabel="Add project"
                onPress={() => navigation.navigate("AddProject")}
                hitSlop={8}
              >
                <Plus color={theme.muted} size={18} />
              </Pressable>
            </View>
            <FlatList
              horizontal
              data={projects}
              keyExtractor={projectKey}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.projectRail}
              renderItem={renderProject}
            />
            <View style={styles.threadHeading}>
              <Text style={[styles.sectionTitle, { color: theme.ink }]}>
                {filter === "active" ? "Recent work" : "Archived"}
              </Text>
              <Text style={[styles.count, { color: theme.faint }]}>
                {String(visibleThreads.length).padStart(2, "0")}
              </Text>
            </View>
          </View>
        )}
        ListEmptyComponent={(
          <View style={styles.threadEmpty}>
            <MessageSquare color={theme.faint} size={23} />
            <Text style={[styles.emptyTitle, { color: theme.ink }]}>
              {search ? "No matching threads" : filter === "active" ? "No active work yet" : "Nothing archived"}
            </Text>
            <Text style={[styles.emptyBody, { color: theme.muted }]}>
              {search ? "Try another title, repository, or branch." : filter === "active"
                ? "Start a task and its live progress will appear here."
                : "Archived threads stay available here."}
            </Text>
            {!search && filter === "active" ? (
              <PrimaryButton icon={Plus} label="Start a task" onPress={() => navigation.navigate("NewTask")} />
            ) : null}
          </View>
        )}
        renderItem={renderThread}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  emptyHeader: { paddingHorizontal: 18, paddingTop: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  wordmark: { fontFamily: "Inter_700Bold", fontSize: 20, letterSpacing: -0.6 },
  header: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  kicker: { fontFamily: "Inter_700Bold", fontSize: 9, letterSpacing: 1.3, marginBottom: 4 },
  title: { fontFamily: "Inter_700Bold", fontSize: 27, letterSpacing: -0.9 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  newTaskButton: { height: 42, borderRadius: 21, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 5 },
  newTaskText: { fontFamily: "Inter_700Bold", fontSize: 12 },
  headerButton: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  searchWrap: { paddingHorizontal: 16, gap: 9, paddingBottom: 4 },
  search: { height: 44, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  searchInput: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 13 },
  filters: { alignSelf: "flex-start", borderRadius: 10, padding: 3, flexDirection: "row", gap: 2 },
  filter: { minHeight: 31, borderRadius: 8, borderWidth: 1, borderColor: "transparent", paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  filterText: { fontFamily: "Inter_600SemiBold", fontSize: 10 },
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  emptyList: { flexGrow: 1, paddingHorizontal: 16, paddingBottom: 32 },
  projectsSection: { paddingTop: 19 },
  sectionHeading: { paddingHorizontal: 2, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitle: { fontFamily: "Inter_700Bold", fontSize: 15, letterSpacing: -0.3 },
  projectRail: { gap: 9, paddingTop: 10, paddingBottom: 3 },
  projectCard: { width: 130, minHeight: 105, borderRadius: 13, borderWidth: 1, padding: 11 },
  projectIcon: { width: 34, height: 34, borderRadius: 9, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  projectName: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  projectOwner: { fontFamily: "Inter_400Regular", fontSize: 10, marginTop: 3 },
  projectStatus: { position: "absolute", top: 12, right: 12, width: 6, height: 6, borderRadius: 3 },
  threadHeading: { marginTop: 24, marginBottom: 10, paddingHorizontal: 2, flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  count: { fontFamily: "Inter_600SemiBold", fontSize: 10 },
  threadRow: { minHeight: 92, borderRadius: 13, borderWidth: 1, padding: 13, marginBottom: 8, flexDirection: "row", alignItems: "center", gap: 9, overflow: "hidden" },
  activityRail: { alignSelf: "stretch", width: 8, alignItems: "center" },
  activityDot: { width: 8, height: 8, borderRadius: 4, marginTop: 7 },
  activityLine: { width: StyleSheet.hairlineWidth, flex: 1, marginTop: 4 },
  threadCopy: { flex: 1, minWidth: 0 },
  threadTitleLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  threadTitle: { flexShrink: 1, fontFamily: "Inter_600SemiBold", fontSize: 14 },
  threadMetaLine: { marginTop: 7, flexDirection: "row", alignItems: "center", gap: 4 },
  threadMeta: { maxWidth: "48%", fontFamily: "Inter_400Regular", fontSize: 10 },
  metaDot: { fontFamily: "Inter_700Bold", fontSize: 9 },
  branch: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 10 },
  updated: { fontFamily: "Inter_400Regular", fontSize: 9, marginTop: 5 },
  threadEmpty: { flex: 1, minHeight: 270, alignItems: "center", justifyContent: "center", paddingHorizontal: 28, gap: 9 },
  emptyTitle: { fontFamily: "Inter_600SemiBold", fontSize: 15, marginTop: 2 },
  emptyBody: { maxWidth: 290, fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18, textAlign: "center", marginBottom: 7 },
});
