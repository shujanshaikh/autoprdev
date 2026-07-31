import { api } from "@autopr/backend/convex/_generated/api";
import type { Doc } from "@autopr/backend/convex/_generated/dataModel";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "convex/react";
import { ChevronRight, Folder, Plus, Search } from "lucide-react-native";
import { memo, useCallback, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { EmptyState, LoadingState, PrimaryButton } from "../components/ui";
import { useAppTheme } from "../hooks/useAppTheme";
import type { RootStackParamList } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "NewTask">;

/** Projects worth searching through; below this a search field is just noise. */
const SEARCH_THRESHOLD = 6;

function SectionTitle({ children }: { children: string }) {
  const theme = useAppTheme();
  return <Text style={[styles.sectionTitle, { color: theme.muted }]}>{children}</Text>;
}

function ListGroup({ children }: { children: ReactNode }) {
  const theme = useAppTheme();
  return <View style={[styles.group, { backgroundColor: theme.surface }]}>{children}</View>;
}

/**
 * One grouped-list row: a circular icon slot, a title with the detail it needs
 * underneath, and a chevron only where the row actually leads somewhere.
 */
function ListRow({
  title,
  subtitle,
  icon,
  disabled = false,
  first = false,
  onPress,
}: {
  title: string;
  subtitle?: string;
  icon: ReactNode;
  disabled?: boolean;
  first?: boolean;
  onPress: () => void;
}) {
  const theme = useAppTheme();
  return (
    <Pressable
      accessibilityLabel={title}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line },
        {
          backgroundColor: pressed ? theme.surfaceSoft : theme.surface,
          opacity: disabled ? 0.45 : 1,
        },
      ]}
    >
      <View style={styles.rowIcon}>{icon}</View>
      <View style={styles.rowCopy}>
        <Text numberOfLines={1} style={[styles.rowTitle, { color: theme.ink }]}>{title}</Text>
        {subtitle ? (
          <Text numberOfLines={1} style={[styles.rowSubtitle, { color: theme.muted }]}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {disabled ? null : <ChevronRight color={theme.faint} size={16} />}
    </Pressable>
  );
}

const ProjectRow = memo(function ProjectRow({
  project,
  first,
  onOpen,
}: {
  project: Doc<"projects">;
  first: boolean;
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
    <ListRow
      disabled={!ready}
      first={first}
      icon={(
        <View style={[styles.projectMark, { backgroundColor: ready ? theme.accentSoft : theme.surfaceSoft }]}>
          <Folder color={ready ? theme.accentOn : theme.faint} size={15} />
        </View>
      )}
      onPress={open}
      subtitle={ready
        ? [project.repoOwner, branch].filter(Boolean).join(" · ")
        : project.sandboxStatus === "failed" ? "Sandbox failed" : "Preparing sandbox…"}
      title={project.repoName}
    />
  );
});

export function NewTaskScreen({ navigation }: Props) {
  const theme = useAppTheme();
  const projects = useQuery(api.projects.list, {});
  const [search, setSearch] = useState("");

  useLayoutEffect(() => {
    navigation.setOptions({ title: "Choose project" });
  }, [navigation]);

  const openProject = useCallback((projectId: string, title: string) => {
    navigation.replace("Project", { projectId, title, focusComposer: true });
  }, [navigation]);
  const addProject = useCallback(() => navigation.navigate("AddProject"), [navigation]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (projects ?? []).filter((project) => !query || [
      project.repoName,
      project.repoFullName,
      project.repoOwner,
    ].some((value) => value?.toLowerCase().includes(query)));
  }, [projects, search]);

  if (projects === undefined) return <LoadingState label="Loading projects…" />;

  if (projects.length === 0) {
    return (
      <SafeAreaView edges={["bottom"]} style={[styles.screen, { backgroundColor: theme.screen }]}>
        <EmptyState
          icon={Folder}
          title="No projects yet"
          body="Connect a GitHub repository before starting a task."
          action={<PrimaryButton icon={Plus} label="Add project" onPress={addProject} />}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["bottom"]} style={[styles.screen, { backgroundColor: theme.screen }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {projects.length > SEARCH_THRESHOLD ? (
          <View style={[styles.search, { backgroundColor: theme.surface, borderColor: theme.line }]}>
            <Search color={theme.faint} size={17} />
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setSearch}
              placeholder="Search projects"
              placeholderTextColor={theme.faint}
              returnKeyType="search"
              style={[styles.searchInput, { color: theme.ink }]}
              value={search}
            />
          </View>
        ) : null}

        <SectionTitle>Projects</SectionTitle>
        {filtered.length === 0 ? (
          <ListGroup>
            <View style={styles.noMatch}>
              <Text style={[styles.noMatchText, { color: theme.muted }]}>
                No project matches “{search.trim()}”.
              </Text>
            </View>
          </ListGroup>
        ) : (
          <ListGroup>
            {filtered.map((project, index) => (
              <ProjectRow
                first={index === 0}
                key={project.projectId}
                onOpen={openProject}
                project={project}
              />
            ))}
          </ListGroup>
        )}

        <View style={styles.addSpacing} />
        <ListGroup>
          <ListRow
            first
            icon={(
              <View style={[styles.projectMark, { backgroundColor: theme.surfaceSoft }]}>
                <Plus color={theme.ink} size={16} strokeWidth={2.2} />
              </View>
            )}
            onPress={addProject}
            subtitle="Connect another GitHub repository"
            title="Add project"
          />
        </ListGroup>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 28, gap: 10 },
  search: {
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginBottom: 4,
  },
  searchInput: { flex: 1, fontFamily: "DMSans_400Regular", fontSize: 14, paddingVertical: 0 },
  sectionTitle: {
    paddingHorizontal: 4,
    fontFamily: "DMSans_700Bold",
    fontSize: 10,
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  group: { borderRadius: 24, overflow: "hidden" },
  row: {
    minHeight: 62,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rowIcon: { width: 28, height: 28, alignItems: "center", justifyContent: "center" },
  projectMark: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  rowCopy: { flex: 1, minWidth: 0, gap: 2 },
  rowTitle: { fontFamily: "DMSans_700Bold", fontSize: 16, letterSpacing: -0.3 },
  rowSubtitle: { fontFamily: "DMSans_400Regular", fontSize: 13 },
  noMatch: { minHeight: 62, alignItems: "center", justifyContent: "center", paddingHorizontal: 18 },
  noMatchText: { fontFamily: "DMSans_400Regular", fontSize: 13, textAlign: "center" },
  addSpacing: { height: 4 },
});
