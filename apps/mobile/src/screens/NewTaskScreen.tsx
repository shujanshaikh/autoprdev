import { api } from "@autopr/backend/convex/_generated/api";
import type { Doc } from "@autopr/backend/convex/_generated/dataModel";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "convex/react";
import { ChevronRight, Folder, Plus } from "lucide-react-native";
import { memo, useCallback, useLayoutEffect } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { EmptyState, LoadingState, PrimaryButton } from "../components/ui";
import { useAppTheme } from "../hooks/useAppTheme";
import type { RootStackParamList } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "NewTask">;

const projectKey = (project: Doc<"projects">) => project.projectId;

const ProjectChoiceRow = memo(function ProjectChoiceRow({
  project,
  onOpen,
}: {
  project: Doc<"projects">;
  onOpen: (projectId: string, title: string) => void;
}) {
  const theme = useAppTheme();
  const ready = project.sandboxStatus === "ready";
  const branch = project.currentBranch ?? project.repoBranch ?? project.defaultBranch;
  const open = useCallback(
    () => onOpen(project.projectId, project.repoName),
    [onOpen, project.projectId, project.repoName],
  );

  return (
    <Pressable
      accessibilityHint={ready ? "Opens a new task composer" : "This project is not ready"}
      accessibilityLabel={project.repoName}
      accessibilityRole="button"
      disabled={!ready}
      onPress={open}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? theme.surfaceSoft : theme.surface,
          opacity: ready ? 1 : 0.58,
        },
      ]}
    >
      <View style={styles.icon}>
        <Folder color={theme.faint} fill={theme.faint} size={18} strokeWidth={1.5} />
      </View>
      <View style={styles.copy}>
        <Text numberOfLines={1} style={[styles.repo, { color: theme.ink }]}>
          {project.repoName}
        </Text>
        <Text numberOfLines={1} style={[styles.branch, { color: theme.muted }]}>
          {ready ? branch ?? "Default branch" : project.sandboxStatus}
        </Text>
      </View>
      <ChevronRight color={theme.faint} size={18} />
    </Pressable>
  );
});

export function NewTaskScreen({ navigation }: Props) {
  const theme = useAppTheme();
  const projects = useQuery(api.projects.list, {});

  useLayoutEffect(() => {
    navigation.setOptions({
      title: "Choose project",
      headerRight: () => (
        <Pressable
          accessibilityLabel="Add project"
          onPress={() => navigation.navigate("AddProject")}
          style={({ pressed }) => [
            styles.headerAdd,
            {
              backgroundColor: pressed ? theme.surfaceSoft : theme.surface,
              borderColor: theme.line,
            },
          ]}
        >
          <Plus color={theme.ink} size={25} strokeWidth={1.9} />
        </Pressable>
      ),
    });
  }, [navigation, theme]);

  const openProject = useCallback((projectId: string, title: string) => {
    navigation.replace("Project", { projectId, title, focusComposer: true });
  }, [navigation]);
  const renderProject = useCallback(
    ({ item }: { item: Doc<"projects"> }) => (
      <ProjectChoiceRow onOpen={openProject} project={item} />
    ),
    [openProject],
  );

  if (projects === undefined) return <LoadingState label="Loading projects…" />;

  return (
    <SafeAreaView edges={["bottom"]} style={[styles.screen, { backgroundColor: theme.screen }]}>
      {projects.length === 0 ? (
        <EmptyState
          icon={Folder}
          title="No projects yet"
          body="Connect a GitHub repository before starting a task."
          action={(
            <PrimaryButton
              icon={Plus}
              label="Add project"
              onPress={() => navigation.navigate("AddProject")}
            />
          )}
        />
      ) : (
        <View style={[styles.projectGroup, { backgroundColor: theme.surface, borderColor: theme.line }]}>
          <FlatList
            data={projects}
            ItemSeparatorComponent={() => (
              <View style={[styles.separator, { backgroundColor: theme.line }]} />
            )}
            keyExtractor={projectKey}
            renderItem={renderProject}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 20, paddingTop: 10 },
  headerAdd: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  projectGroup: { overflow: "hidden", borderRadius: 22, borderWidth: 1 },
  row: {
    minHeight: 72,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 58 },
  icon: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, minWidth: 0 },
  repo: { fontFamily: "DMSans_700Bold", fontSize: 16 },
  branch: { fontFamily: "DMSans_400Regular", fontSize: 12, marginTop: 3 },
});
