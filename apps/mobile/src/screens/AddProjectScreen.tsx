import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as WebBrowser from "expo-web-browser";
import { Check, ChevronRight, GitFork, Search } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { webRequest } from "../api/web";
import { ErrorNotice, LoadingState, PrimaryButton, SecondaryButton, SectionLabel } from "../components/ui";
import { mobileConfig } from "../config";
import { useAppTheme } from "../hooks/useAppTheme";
import { useWebMutation, useWebQuery } from "../hooks/useWebQuery";
import type { GitHubBranch, GitHubRepository, RootStackParamList } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "AddProject">;

export function AddProjectScreen({ navigation }: Props) {
  const theme = useAppTheme();
  const [search, setSearch] = useState("");
  const [repository, setRepository] = useState<GitHubRepository | null>(null);
  const [branch, setBranch] = useState<string | null>(null);

  const repositories = useWebQuery<{ repositories: GitHubRepository[] }>(
    ["github", "repositories"],
    "/api/github/repositories",
    { retry: false },
  );
  const branches = useWebQuery<{ branches: GitHubBranch[] }>(
    ["github", "branches", repository?.owner, repository?.name],
    repository
      ? `/api/github/repositories/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}/branches`
      : "/api/github/repositories/_/_/branches",
    { enabled: Boolean(repository), retry: false },
  );
  const create = useWebMutation(
    async (_: void, token) => {
      if (!repository || !branch) throw new Error("Choose a repository and branch.");
      return await webRequest<{
        projectId: string;
        sandboxStatus: string;
        error?: string;
      }>("/api/projects/from-github", token, {
        method: "POST",
        body: JSON.stringify({ repository, branch }),
      });
    },
    {
      onSuccess: (result) => navigation.replace("Project", {
        projectId: result.projectId,
        title: repository?.name,
      }),
    },
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (repositories.data?.repositories ?? []).filter((repo) =>
      !query || repo.fullName.toLowerCase().includes(query));
  }, [repositories.data?.repositories, search]);

  const connectGithub = async () => {
    await WebBrowser.openBrowserAsync(
      `${mobileConfig.webUrl}/api/auth/sign-in?returnTo=${encodeURIComponent("/github-connect")}`,
    );
    await repositories.refetch();
  };

  if (repositories.isLoading) return <LoadingState label="Loading GitHub repositories…" />;

  const connectionError = repositories.error?.message;
  if (repositories.isError && connectionError?.toLowerCase().includes("connect")) {
    return (
      <View style={[styles.connectScreen, { backgroundColor: theme.screen }]}>
        <View style={[styles.githubMark, { backgroundColor: theme.surfaceSoft }]}>
          <GitFork color={theme.ink} size={28} />
        </View>
        <Text style={[styles.connectTitle, { color: theme.ink }]}>Connect GitHub</Text>
        <Text style={[styles.connectBody, { color: theme.muted }]}>
          Authorize GitHub in the secure web flow, then return here to choose a repository.
        </Text>
        <PrimaryButton icon={GitFork} label="Connect GitHub" onPress={() => void connectGithub()} />
        <SecondaryButton label="I’ve connected it" onPress={() => void repositories.refetch()} />
      </View>
    );
  }

  return (
    <SafeAreaView edges={["bottom"]} style={[styles.screen, { backgroundColor: theme.screen }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {repositories.error ? <ErrorNotice message={repositories.error.message} /> : null}
        <SectionLabel>Repository</SectionLabel>
        <View style={[styles.search, { backgroundColor: theme.surface, borderColor: theme.line }]}>
          <Search color={theme.faint} size={18} />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setSearch}
            placeholder="Search repositories"
            placeholderTextColor={theme.faint}
            style={[styles.searchInput, { color: theme.ink }]}
            value={search}
          />
        </View>
        <View style={[styles.list, { borderColor: theme.line, backgroundColor: theme.surface }]}>
          {filtered.map((repo, index) => (
            <Pressable
              accessibilityLabel={repo.fullName}
              accessibilityRole="button"
              key={repo.id}
              onPress={() => {
                setRepository(repo);
                setBranch(repo.defaultBranch);
              }}
              style={({ pressed }) => [
                styles.row,
                index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line },
                { backgroundColor: pressed || repository?.id === repo.id ? theme.surfaceSoft : theme.surface },
              ]}
            >
              <GitFork color={theme.muted} size={17} />
              <View style={styles.rowCopy}>
                <Text numberOfLines={1} style={[styles.rowTitle, { color: theme.ink }]}>{repo.fullName}</Text>
                <Text style={[styles.rowMeta, { color: theme.muted }]}>
                  {repo.private ? "Private" : "Public"} · default {repo.defaultBranch}
                </Text>
              </View>
              {repository?.id === repo.id
                ? <Check color={theme.accentOn} size={18} />
                : <ChevronRight color={theme.faint} size={17} />}
            </Pressable>
          ))}
        </View>

        {repository ? (
          <View style={styles.branchSection}>
            <SectionLabel>Branch</SectionLabel>
            {branches.isLoading ? <LoadingState label="Loading branches…" /> : null}
            {branches.error ? <ErrorNotice message={branches.error.message} /> : null}
            <View style={styles.branchGrid}>
              {(branches.data?.branches ?? []).map((entry) => (
                <Pressable
                  key={entry.name}
                  onPress={() => setBranch(entry.name)}
                  style={[
                    styles.branchChip,
                    {
                      backgroundColor: branch === entry.name ? theme.accentSoft : theme.surface,
                      borderColor: branch === entry.name ? theme.accentOn : theme.line,
                    },
                  ]}
                >
                  <Text style={[
                    styles.branchText,
                    { color: branch === entry.name ? theme.accentOn : theme.ink },
                  ]}>{entry.name}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: theme.screen, borderTopColor: theme.line }]}>
        {create.error ? <ErrorNotice message={create.error.message} /> : null}
        <PrimaryButton
          disabled={!repository || !branch}
          label="Create workspace"
          loading={create.isPending}
          onPress={() => create.mutate()}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, paddingBottom: 24 },
  connectScreen: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 12 },
  githubMark: { width: 62, height: 62, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  connectTitle: { fontFamily: "DMSans_700Bold", fontSize: 22, marginTop: 5 },
  connectBody: {
    maxWidth: 330,
    fontFamily: "DMSans_400Regular",
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    marginBottom: 8,
  },
  search: {
    height: 48,
    borderWidth: 1,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 13,
    gap: 10,
    marginBottom: 12,
  },
  searchInput: { flex: 1, fontFamily: "DMSans_400Regular", fontSize: 14 },
  list: { borderWidth: 1, borderRadius: 10, overflow: "hidden" },
  row: { minHeight: 67, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: "DMSans_500Medium", fontSize: 13 },
  rowMeta: { fontFamily: "DMSans_400Regular", fontSize: 11, marginTop: 5 },
  branchSection: { marginTop: 24, marginBottom: 22 },
  branchGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  branchChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 9 },
  branchText: { fontFamily: "DMSans_500Medium", fontSize: 12 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, gap: 10 },
});
