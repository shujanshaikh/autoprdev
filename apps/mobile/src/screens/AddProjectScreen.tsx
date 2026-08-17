import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as WebBrowser from "expo-web-browser";
import { Check, GitBranch, GitFork, Lock, Search, X } from "lucide-react-native";
import { memo, useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { webRequest } from "../api/web";
import { ErrorNotice, LoadingState, PrimaryButton, SecondaryButton } from "../components/ui";
import { mobileConfig } from "../config";
import { useAppTheme } from "../hooks/useAppTheme";
import { useWebMutation, useWebQuery } from "../hooks/useWebQuery";
import type { GitHubBranch, GitHubRepository, RootStackParamList } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "AddProject">;

const repositoryKey = (repository: GitHubRepository) => String(repository.id);

/**
 * Reads like a row in the thread list: the owner sits above the name it
 * qualifies, and the branch trails underneath in the same monospace the rest of
 * the app uses for refs.
 */
const RepositoryRow = memo(function RepositoryRow({
  repository,
  selected,
  onSelect,
}: {
  repository: GitHubRepository;
  selected: boolean;
  onSelect: (repository: GitHubRepository) => void;
}) {
  const theme = useAppTheme();
  const select = useCallback(() => onSelect(repository), [onSelect, repository]);

  return (
    <Pressable
      accessibilityHint="Selects this repository"
      accessibilityLabel={repository.fullName}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={select}
      style={({ pressed }) => [
        styles.repoRow,
        { backgroundColor: pressed ? theme.surfaceSoft : theme.screen },
      ]}
    >
      <View style={styles.repoOwnerLine}>
        <GitFork color={theme.faint} size={13} />
        <Text numberOfLines={1} style={[styles.repoOwner, { color: theme.muted }]}>
          {repository.owner}
        </Text>
        {repository.private ? <Lock color={theme.faint} size={12} /> : null}
      </View>
      <View style={styles.repoNameLine}>
        <Text numberOfLines={1} style={[styles.repoName, { color: theme.ink }]}>
          {repository.name}
        </Text>
        {selected ? (
          <View style={[styles.selectedMark, { backgroundColor: theme.accent }]}>
            <Check color={theme.accentInk} size={13} strokeWidth={3} />
          </View>
        ) : null}
      </View>
      <View style={styles.repoFooter}>
        <GitBranch color={theme.faint} size={13} />
        <Text numberOfLines={1} style={[styles.repoBranch, { color: theme.muted }]}>
          {repository.defaultBranch}
        </Text>
      </View>
      <View style={[styles.separator, { backgroundColor: theme.line }]} />
    </Pressable>
  );
});

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

  const selectRepository = useCallback((next: GitHubRepository) => {
    setRepository(next);
    setBranch(next.defaultBranch);
  }, []);
  const renderRepository = useCallback(({ item }: { item: GitHubRepository }) => (
    <RepositoryRow
      onSelect={selectRepository}
      repository={item}
      selected={repository?.id === item.id}
    />
  ), [repository?.id, selectRepository]);

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

  const branchOptions = branches.data?.branches ?? [];
  return (
    <SafeAreaView edges={["bottom"]} style={[styles.screen, { backgroundColor: theme.screen }]}>
      <View style={styles.searchWrap}>
        <View style={[styles.search, { backgroundColor: theme.surfaceRaised, borderColor: theme.line }]}>
          <Search color={theme.muted} size={19} />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setSearch}
            placeholder="Search repositories"
            placeholderTextColor={theme.faint}
            returnKeyType="search"
            style={[styles.searchInput, { color: theme.ink }]}
            value={search}
          />
          {search ? (
            <Pressable accessibilityLabel="Clear search" hitSlop={8} onPress={() => setSearch("")}>
              <X color={theme.faint} size={17} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {repositories.error ? (
        <View style={styles.notice}><ErrorNotice message={repositories.error.message} /></View>
      ) : null}

      <FlatList
        contentContainerStyle={[
          styles.list,
          filtered.length === 0 && styles.emptyList,
          repository ? styles.listWithFooter : null,
        ]}
        data={filtered}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        keyExtractor={repositoryKey}
        ListEmptyComponent={(
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: theme.ink }]}>No matching repositories</Text>
            <Text style={[styles.emptyBody, { color: theme.muted }]}>
              Try another owner or name, or connect more repositories on GitHub.
            </Text>
          </View>
        )}
        renderItem={renderRepository}
        showsVerticalScrollIndicator={false}
      />

      {repository ? (
        <View style={[styles.footer, { backgroundColor: theme.surfaceRaised, borderTopColor: theme.line }]}>
          <View style={styles.footerHeading}>
            <Text numberOfLines={1} style={[styles.footerTitle, { color: theme.ink }]}>
              {repository.fullName}
            </Text>
            <Pressable
              accessibilityLabel="Clear selected repository"
              hitSlop={8}
              onPress={() => {
                setRepository(null);
                setBranch(null);
              }}
            >
              <X color={theme.faint} size={17} />
            </Pressable>
          </View>

          {branches.isLoading ? (
            <Text style={[styles.branchStatus, { color: theme.muted }]}>Loading branches…</Text>
          ) : branches.error ? (
            <Text style={[styles.branchStatus, { color: theme.danger }]}>{branches.error.message}</Text>
          ) : (
            <ScrollView
              contentContainerStyle={styles.branchRow}
              horizontal
              showsHorizontalScrollIndicator={false}
            >
              {branchOptions.map((entry) => {
                const active = branch === entry.name;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    key={entry.name}
                    onPress={() => setBranch(entry.name)}
                    style={[
                      styles.branchChip,
                      {
                        backgroundColor: active ? theme.accent : theme.surfaceSoft,
                        borderColor: active ? theme.accent : theme.line,
                      },
                    ]}
                  >
                    <Text
                      numberOfLines={1}
                      style={[styles.branchText, { color: active ? theme.accentInk : theme.muted }]}
                    >
                      {entry.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          {create.error ? <ErrorNotice message={create.error.message} /> : null}
          <PrimaryButton
            disabled={!branch}
            label="Create workspace"
            loading={create.isPending}
            onPress={() => create.mutate()}
          />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
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
  searchWrap: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 },
  search: {
    height: 50,
    borderRadius: 25,
    borderWidth: 1,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  searchInput: { flex: 1, fontFamily: "DMSans_400Regular", fontSize: 16, paddingVertical: 0 },
  notice: { paddingHorizontal: 16, paddingBottom: 6 },
  list: { paddingHorizontal: 20 },
  listWithFooter: { paddingBottom: 12 },
  emptyList: { flexGrow: 1 },
  repoRow: { minHeight: 96, paddingTop: 11, paddingBottom: 12 },
  repoOwnerLine: { flexDirection: "row", alignItems: "center", gap: 7 },
  repoOwner: { flexShrink: 1, fontFamily: "DMSans_500Medium", fontSize: 13 },
  repoNameLine: { marginTop: 5, flexDirection: "row", alignItems: "center", gap: 10 },
  repoName: {
    flex: 1,
    fontFamily: "DMSans_500Medium",
    fontSize: 17,
    lineHeight: 23,
    letterSpacing: -0.2,
  },
  selectedMark: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  repoFooter: { minHeight: 20, marginTop: 5, flexDirection: "row", alignItems: "center", gap: 7 },
  repoBranch: { flex: 1, fontFamily: "monospace", fontSize: 12 },
  separator: { position: "absolute", height: StyleSheet.hairlineWidth, left: 0, right: 0, bottom: 0 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  emptyTitle: { fontFamily: "DMSans_700Bold", fontSize: 17 },
  emptyBody: { marginTop: 7, fontFamily: "DMSans_400Regular", fontSize: 14, textAlign: "center" },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 10,
  },
  footerHeading: { flexDirection: "row", alignItems: "center", gap: 10 },
  footerTitle: { flex: 1, fontFamily: "DMSans_700Bold", fontSize: 14, letterSpacing: -0.3 },
  branchStatus: { fontFamily: "DMSans_400Regular", fontSize: 12 },
  branchRow: { gap: 7, paddingRight: 4 },
  branchChip: {
    maxWidth: 220,
    minHeight: 34,
    borderRadius: 17,
    borderWidth: 1,
    paddingHorizontal: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  branchText: { fontFamily: "DMSans_500Medium", fontSize: 12 },
});
