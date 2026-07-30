import { api } from "@autopr/backend/convex/_generated/api";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "convex/react";
import { ChevronRight, FolderGit2, Plus } from "lucide-react-native";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { EmptyState, LoadingState, PrimaryButton, StatusPill } from "../components/ui";
import { useAppTheme } from "../hooks/useAppTheme";
import type { RootStackParamList } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "NewTask">;

export function NewTaskScreen({ navigation }: Props) {
  const theme = useAppTheme();
  const projects = useQuery(api.projects.list, {});

  if (projects === undefined) return <LoadingState label="Loading projects…" />;

  return (
    <SafeAreaView edges={["bottom"]} style={[styles.screen, { backgroundColor: theme.screen }]}>
      <View style={styles.intro}>
        <Text style={[styles.title, { color: theme.ink }]}>Choose a project</Text>
        <Text style={[styles.body, { color: theme.muted }]}>
          The task composer will open with this repository and its current branch selected.
        </Text>
      </View>
      {projects.length === 0 ? (
        <EmptyState
          icon={FolderGit2}
          title="No projects yet"
          body="Connect a GitHub repository before starting a task."
          action={<PrimaryButton icon={Plus} label="Add project" onPress={() => navigation.replace("AddProject")} />}
        />
      ) : (
        <FlatList
          data={projects}
          keyExtractor={(project) => project.projectId}
          contentContainerStyle={styles.list}
          renderItem={({ item: project }) => {
            const ready = project.sandboxStatus === "ready";
            const branch = project.currentBranch ?? project.repoBranch ?? project.defaultBranch;
            return (
              <Pressable
                accessibilityRole="button"
                disabled={!ready}
                onPress={() => navigation.replace("Project", {
                  projectId: project.projectId,
                  title: project.repoName,
                  focusComposer: true,
                })}
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: pressed ? theme.surfaceSoft : theme.surface,
                    borderColor: theme.line,
                    opacity: ready ? 1 : 0.58,
                  },
                ]}
              >
                <View style={[styles.icon, { backgroundColor: theme.accentSoft }]}>
                  <FolderGit2 color={theme.accent} size={20} />
                </View>
                <View style={styles.copy}>
                  <Text numberOfLines={1} style={[styles.repo, { color: theme.ink }]}>
                    {project.repoFullName}
                  </Text>
                  <Text numberOfLines={1} style={[styles.branch, { color: theme.muted }]}>
                    {branch ?? "Default branch"}
                  </Text>
                </View>
                <StatusPill
                  label={ready ? "Ready" : project.sandboxStatus}
                  tone={ready ? "success" : project.sandboxStatus === "failed" ? "danger" : "warning"}
                />
                <ChevronRight color={theme.faint} size={17} />
              </Pressable>
            );
          }}
        />
      )}
      <Pressable
        accessibilityRole="button"
        onPress={() => navigation.replace("AddProject")}
        style={styles.add}
      >
        <Plus color={theme.muted} size={16} />
        <Text style={[styles.addText, { color: theme.muted }]}>Add another project</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  intro: { paddingHorizontal: 18, paddingTop: 5, paddingBottom: 15 },
  title: { fontFamily: "Inter_700Bold", fontSize: 21, letterSpacing: -0.5 },
  body: { fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19, marginTop: 7 },
  list: { paddingHorizontal: 14, gap: 8, paddingBottom: 18 },
  row: { minHeight: 76, borderRadius: 13, borderWidth: 1, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  icon: { width: 42, height: 42, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, minWidth: 0 },
  repo: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  branch: { fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 5 },
  add: { minHeight: 48, marginHorizontal: 18, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  addText: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
});
