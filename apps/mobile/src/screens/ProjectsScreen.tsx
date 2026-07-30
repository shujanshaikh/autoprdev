import { api } from "@autopr/backend/convex/_generated/api";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "convex/react";
import { ChevronRight, FolderGit2, Plus, Search, Settings2 } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { EmptyState, LoadingState, PrimaryButton, SectionLabel, StatusPill } from "../components/ui";
import { useAppTheme } from "../hooks/useAppTheme";
import type { RootStackParamList } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "Projects">;

function relativeTime(timestamp: number | undefined) {
  if (!timestamp) return "Not opened yet";
  const minutes = Math.floor((Date.now() - timestamp) / 60_000);
  if (minutes < 1) return "Opened just now";
  if (minutes < 60) return `Opened ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Opened ${hours}h ago`;
  return `Opened ${Math.floor(hours / 24)}d ago`;
}

export function ProjectsScreen({ navigation }: Props) {
  const theme = useAppTheme();
  const projects = useQuery(api.projects.list, {});
  const [search, setSearch] = useState("");
  const filteredProjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return projects ?? [];
    return (projects ?? []).filter((project) => [
      project.repoFullName,
      project.currentBranch,
      project.repoBranch,
      project.defaultBranch,
    ].some((value) => value?.toLowerCase().includes(query)));
  }, [projects, search]);

  if (projects === undefined) return <LoadingState label="Loading workspaces…" />;

  return (
    <SafeAreaView edges={["bottom"]} style={[styles.screen, { backgroundColor: theme.screen }]}>
      <View style={styles.hero}>
        <View>
          <Text style={[styles.kicker, { color: theme.accent }]}>AUTOPR</Text>
          <Text style={[styles.title, { color: theme.ink }]}>Projects</Text>
        </View>
        <View style={styles.heroActions}>
          <Pressable
            accessibilityLabel="Add project"
            accessibilityRole="button"
            onPress={() => navigation.navigate("AddProject")}
            style={({ pressed }) => [
              styles.iconButton,
              { backgroundColor: theme.accent, borderColor: theme.accent, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Plus color={theme.accentInk} size={19} />
          </Pressable>
          <Pressable
            accessibilityLabel="Open settings"
            accessibilityRole="button"
            onPress={() => navigation.navigate("Settings")}
            style={({ pressed }) => [
              styles.iconButton,
              { backgroundColor: theme.surface, borderColor: theme.line, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <Settings2 color={theme.ink} size={19} />
          </Pressable>
        </View>
      </View>

      {projects.length === 0 ? (
        <EmptyState
          icon={FolderGit2}
          title="No projects yet"
          body="Connect a GitHub repository to create an isolated workspace and start your first task."
          action={
            <PrimaryButton
              icon={Plus}
              label="Add GitHub project"
              onPress={() => navigation.navigate("AddProject")}
            />
          }
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={false} tintColor={theme.accent} />}
        >
          <View style={[styles.search, { backgroundColor: theme.surfaceSoft, borderColor: theme.line }]}>
            <Search color={theme.faint} size={16} />
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              value={search}
              onChangeText={setSearch}
              placeholder="Search projects and branches"
              placeholderTextColor={theme.faint}
              style={[styles.searchInput, { color: theme.ink }]}
            />
          </View>
          <View style={styles.section}>
            <SectionLabel>Recent projects</SectionLabel>
            <View style={[styles.list, { backgroundColor: theme.surface, borderColor: theme.line }]}>
              {filteredProjects.map((project, index) => {
                const branch = project.currentBranch ?? project.repoBranch ?? project.defaultBranch;
                return (
                  <Pressable
                    key={project.projectId}
                    accessibilityRole="button"
                    onPress={() => navigation.navigate("Project", {
                      projectId: project.projectId,
                      title: project.repoName,
                    })}
                    style={({ pressed }) => [
                      styles.row,
                      index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line },
                      { backgroundColor: pressed ? theme.surfaceSoft : theme.surface },
                    ]}
                  >
                    <View style={[styles.repoIcon, { backgroundColor: theme.surfaceSoft }]}>
                      <FolderGit2 color={theme.accent} size={20} />
                    </View>
                    <View style={styles.rowCopy}>
                      <View style={styles.rowTitleLine}>
                        <Text numberOfLines={1} style={[styles.rowTitle, { color: theme.ink }]}>
                          {project.repoFullName}
                        </Text>
                        <StatusPill
                          label={project.sandboxStatus}
                          tone={project.sandboxStatus === "ready"
                            ? "success"
                            : project.sandboxStatus === "failed" ? "danger" : "warning"}
                        />
                      </View>
                      <Text numberOfLines={1} style={[styles.rowMeta, { color: theme.muted }]}>
                        {branch} · {relativeTime(project.lastOpenedAt ?? project.updatedAt)}
                      </Text>
                    </View>
                    <ChevronRight color={theme.faint} size={18} />
                  </Pressable>
                );
              })}
            </View>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  hero: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 17,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  heroActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  kicker: { fontFamily: "Inter_700Bold", fontSize: 10, letterSpacing: 1.2, marginBottom: 5 },
  title: { fontFamily: "Inter_700Bold", fontSize: 25, letterSpacing: -0.8 },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { padding: 16, paddingBottom: 36 },
  search: { height: 44, borderRadius: 8, borderWidth: 1, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  searchInput: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 13 },
  section: { marginTop: 22 },
  list: { borderRadius: 10, borderWidth: 1, overflow: "hidden" },
  row: { minHeight: 82, padding: 13, flexDirection: "row", alignItems: "center", gap: 12 },
  repoIcon: { width: 43, height: 43, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitleLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowTitle: { flex: 1, fontFamily: "Inter_600SemiBold", fontSize: 14 },
  rowMeta: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 7 },
});
