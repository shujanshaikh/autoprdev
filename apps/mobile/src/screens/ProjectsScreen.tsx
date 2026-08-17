import { api } from "@autopr/backend/convex/_generated/api";
import type { Doc } from "@autopr/backend/convex/_generated/dataModel";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "convex/react";
import { Archive, Folder, MoreHorizontal, Search, SquarePen } from "lucide-react-native";
import { memo, useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { OpenAIIcon } from "../components/OpenAIIcon";
import { EmptyState, LoadingState, PrimaryButton } from "../components/ui";
import { useAppTheme } from "../hooks/useAppTheme";
import type { RootStackParamList } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "Projects">;
type ThreadFilter = "all" | "archived";

function relativeTime(timestamp: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

const threadKey = (thread: Doc<"threads">) => thread.threadId;

const ThreadRow = memo(function ThreadRow({
  thread,
  project,
  onOpen,
}: {
  thread: Doc<"threads">;
  project: Doc<"projects"> | undefined;
  onOpen: (projectId: string, threadId: string, title: string) => void;
}) {
  const theme = useAppTheme();
  const open = useCallback(
    () => onOpen(thread.projectId, thread.threadId, thread.title),
    [onOpen, thread.projectId, thread.threadId, thread.title],
  );
  const archived = thread.settledOverride === "settled";
  const branch = thread.featureBranch ?? thread.baseBranch ?? project?.defaultBranch ?? "branch";

  return (
    <Pressable
      accessibilityHint="Opens this thread"
      accessibilityLabel={thread.title}
      accessibilityRole="button"
      onPress={open}
      style={({ pressed }) => [
        styles.threadRow,
        { backgroundColor: pressed ? theme.surfaceSoft : theme.screen },
      ]}
    >
      <View style={styles.projectLine}>
        <Folder color={theme.faint} fill={theme.faint} size={14} strokeWidth={1.5} />
        <Text numberOfLines={1} style={[styles.projectName, { color: theme.muted }]}>
          {project?.repoFullName ?? project?.repoName ?? "Project"}
        </Text>
        {thread.isLive ? (
          <Text style={[styles.liveLabel, { color: theme.success }]}>Working</Text>
        ) : (
          <Text style={[styles.time, { color: theme.faint }]}>{relativeTime(thread.updatedAt)}</Text>
        )}
      </View>
      <Text
        numberOfLines={2}
        style={[styles.threadTitle, { color: archived ? theme.muted : theme.ink }]}
      >
        {thread.title}
      </Text>
      <View style={styles.threadFooter}>
        <Text numberOfLines={1} style={[styles.branch, { color: theme.muted }]}>
          {branch}
        </Text>
        {archived ? <Archive color={theme.faint} size={14} /> : <OpenAIIcon size={15} />}
      </View>
      <View style={[styles.separator, { backgroundColor: theme.line }]} />
    </Pressable>
  );
});

export function ProjectsScreen({ navigation }: Props) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const projects = useQuery(api.projects.list, {});
  const threads = useQuery(api.threads.listForSidebar, {});
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ThreadFilter>("all");

  const projectById = useMemo(
    () => new Map((projects ?? []).map((project) => [project.projectId, project])),
    [projects],
  );
  const visibleThreads = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (threads ?? []).filter((thread) => {
      const archived = thread.settledOverride === "settled";
      if (filter === "archived" && !archived) return false;
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

  const openThread = useCallback((projectId: string, threadId: string, title: string) => {
    navigation.navigate("Thread", { projectId, threadId, title });
  }, [navigation]);
  const renderThread = useCallback(
    ({ item }: { item: Doc<"threads"> }) => (
      <ThreadRow
        onOpen={openThread}
        project={projectById.get(item.projectId)}
        thread={item}
      />
    ),
    [openThread, projectById],
  );

  if (projects === undefined || threads === undefined) {
    return <LoadingState label="Loading threads…" />;
  }

  if (projects.length === 0) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: theme.screen }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.ink }]}>Threads</Text>
          <Pressable
            accessibilityLabel="Open settings"
            onPress={() => navigation.navigate("Settings")}
            style={({ pressed }) => [
              styles.roundButton,
              {
                backgroundColor: pressed ? theme.surfaceSoft : theme.surface,
                borderColor: theme.line,
              },
            ]}
          >
            <MoreHorizontal color={theme.ink} size={22} />
          </Pressable>
        </View>
        <EmptyState
          icon={Folder}
          title="Connect your first project"
          body="Add a GitHub repository, then start a task from the mobile composer."
          action={(
            <PrimaryButton
              icon={SquarePen}
              label="Add GitHub project"
              onPress={() => navigation.navigate("AddProject")}
            />
          )}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} style={[styles.screen, { backgroundColor: theme.screen }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: theme.ink }]}>Threads</Text>
        <Pressable
          accessibilityLabel="Open settings"
          onPress={() => navigation.navigate("Settings")}
          style={({ pressed }) => [
            styles.roundButton,
            {
              backgroundColor: pressed ? theme.surfaceSoft : theme.surface,
              borderColor: theme.line,
            },
          ]}
        >
          <MoreHorizontal color={theme.ink} size={23} />
        </Pressable>
      </View>

      <FlatList
        contentContainerStyle={[
          styles.list,
          visibleThreads.length === 0 && styles.emptyList,
          { paddingBottom: Math.max(insets.bottom, 14) + 92 },
        ]}
        data={visibleThreads}
        keyboardDismissMode="on-drag"
        keyExtractor={threadKey}
        ListEmptyComponent={(
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: theme.ink }]}>
              {search ? "No matching threads" : "No archived threads"}
            </Text>
            <Text style={[styles.emptyBody, { color: theme.muted }]}>
              {search
                ? "Try another title, project, or branch."
                : "Threads you archive will appear here."}
            </Text>
          </View>
        )}
        renderItem={renderThread}
        showsVerticalScrollIndicator={false}
      />

      <View style={[styles.dock, { bottom: Math.max(insets.bottom, 12) }]}>
        <Pressable
          accessibilityLabel={filter === "all" ? "Show archived threads" : "Show all threads"}
          accessibilityRole="button"
          accessibilityState={{ selected: filter === "archived" }}
          onPress={() => setFilter((value) => value === "all" ? "archived" : "all")}
          style={({ pressed }) => [
            styles.dockButton,
            {
              backgroundColor: filter === "archived"
                ? theme.accentSoft
                : pressed ? theme.surfaceSoft : theme.surfaceRaised,
              borderColor: filter === "archived" ? theme.accentOn : theme.line,
            },
          ]}
        >
          <Archive color={filter === "archived" ? theme.accentOn : theme.ink} size={20} />
        </Pressable>
        <View style={[styles.search, { backgroundColor: theme.surfaceRaised, borderColor: theme.line }]}>
          <Search color={theme.muted} size={20} />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setSearch}
            placeholder="Search"
            placeholderTextColor={theme.faint}
            returnKeyType="search"
            style={[styles.searchInput, { color: theme.ink }]}
            value={search}
          />
        </View>
        <Pressable
          accessibilityLabel="Start a new task"
          onPress={() => navigation.navigate("NewTask")}
          style={({ pressed }) => [
            styles.dockButton,
            {
              backgroundColor: pressed ? theme.surfaceSoft : theme.surfaceRaised,
              borderColor: theme.line,
            },
          ]}
        >
          <SquarePen color={theme.ink} size={21} />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { fontFamily: "DMSans_700Bold", fontSize: 30, letterSpacing: -1.05 },
  roundButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  list: { paddingHorizontal: 20 },
  emptyList: { flexGrow: 1 },
  threadRow: { minHeight: 104, paddingTop: 11, paddingBottom: 12 },
  projectLine: { flexDirection: "row", alignItems: "center", gap: 7 },
  projectName: { flex: 1, fontFamily: "DMSans_500Medium", fontSize: 14 },
  time: { fontFamily: "DMSans_400Regular", fontSize: 13, fontVariant: ["tabular-nums"] },
  liveLabel: { fontFamily: "DMSans_500Medium", fontSize: 12 },
  threadTitle: {
    fontFamily: "DMSans_500Medium",
    fontSize: 17,
    lineHeight: 23,
    letterSpacing: -0.2,
    marginTop: 7,
  },
  threadFooter: { minHeight: 20, marginTop: 5, flexDirection: "row", alignItems: "center", gap: 8 },
  branch: { flex: 1, fontFamily: "monospace", fontSize: 12 },
  separator: { position: "absolute", height: StyleSheet.hairlineWidth, left: 0, right: 0, bottom: 0 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  emptyTitle: { fontFamily: "DMSans_700Bold", fontSize: 17 },
  emptyBody: { marginTop: 7, fontFamily: "DMSans_400Regular", fontSize: 14, textAlign: "center" },
  dock: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  dockButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 6px 18px rgba(0,0,0,0.15)",
  },
  search: {
    flex: 1,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    boxShadow: "0 6px 18px rgba(0,0,0,0.15)",
  },
  searchInput: { flex: 1, fontFamily: "DMSans_400Regular", fontSize: 17, paddingVertical: 0 },
});
