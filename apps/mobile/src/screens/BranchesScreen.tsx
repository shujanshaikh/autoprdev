import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Check, GitBranch, LockKeyhole, Search } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { webRequest } from "../api/web";
import { EmptyState, ErrorNotice, LoadingState } from "../components/ui";
import { useAppTheme } from "../hooks/useAppTheme";
import { useWebMutation, useWebQuery } from "../hooks/useWebQuery";
import type { GitHubBranch, RootStackParamList } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "Branches">;
type BranchesResponse = { branches: Array<GitHubBranch & { sha: string }> };

export function BranchesScreen({ navigation, route }: Props) {
  const { projectId, owner, repo, currentBranch } = route.params;
  const theme = useAppTheme();
  const [search, setSearch] = useState("");
  const branches = useWebQuery<BranchesResponse>(
    ["github-branches", owner, repo],
    `/api/github/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`,
    { retry: false },
  );
  const switchBranch = useWebMutation(
    async (branch: string, token) => await webRequest<{ branch: string; status: "ready" }>(
      `/api/project/${encodeURIComponent(projectId)}/branch`,
      token,
      {
        method: "POST",
        body: JSON.stringify({ branch }),
      },
    ),
    {
      invalidateQueryKeys: [["git-status", projectId]],
      onSuccess: () => navigation.goBack(),
    },
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (branches.data?.branches ?? []).filter((branch) =>
      !query || branch.name.toLowerCase().includes(query));
  }, [branches.data?.branches, search]);

  if (branches.isLoading) return <LoadingState label="Loading branches…" />;

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.content, { backgroundColor: theme.screen }]}
    >
      <View style={[styles.search, { backgroundColor: theme.surface, borderColor: theme.line }]}>
        <Search color={theme.faint} size={17} />
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          value={search}
          onChangeText={setSearch}
          placeholder="Find a branch"
          placeholderTextColor={theme.faint}
          style={[styles.input, { color: theme.ink }]}
        />
      </View>

      {branches.error ? <ErrorNotice message={branches.error.message} /> : null}
      {switchBranch.error ? <ErrorNotice message={switchBranch.error.message} /> : null}

      {filtered.length === 0 ? (
        <View style={styles.empty}>
          <EmptyState
            icon={GitBranch}
            title={search ? "No matching branches" : "No branches found"}
            body={search ? "Try a different branch name." : "GitHub did not return any branches for this repository."}
          />
        </View>
      ) : (
        <View style={[styles.list, { backgroundColor: theme.surface, borderColor: theme.line }]}>
          {filtered.map((branch, index) => {
            const selected = branch.name === currentBranch;
            const busy = switchBranch.isPending && switchBranch.variables === branch.name;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected, disabled: switchBranch.isPending || selected }}
                key={branch.sha}
                disabled={switchBranch.isPending || selected}
                onPress={() => switchBranch.mutate(branch.name)}
                style={({ pressed }) => [
                  styles.row,
                  index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line },
                  {
                    backgroundColor: selected
                      ? theme.accentSoft
                      : pressed
                        ? theme.surfaceSoft
                        : theme.surface,
                    opacity: switchBranch.isPending && !busy ? 0.5 : 1,
                  },
                ]}
              >
                <View style={[styles.branchMark, { backgroundColor: selected ? theme.surface : theme.surfaceSoft }]}>
                  {selected
                    ? <Check color={theme.accentOn} size={17} strokeWidth={2.5} />
                    : <GitBranch color={theme.muted} size={17} />}
                </View>
                <View style={styles.copy}>
                  <Text numberOfLines={1} style={[styles.name, { color: theme.ink }]}>{branch.name}</Text>
                  <Text style={[styles.sha, { color: theme.faint }]}>
                    {busy ? "Switching workspace…" : branch.sha.slice(0, 7)}
                  </Text>
                </View>
                {branch.protected ? <LockKeyhole color={theme.faint} size={15} /> : null}
                {selected ? <Text style={[styles.current, { color: theme.ink }]}>CURRENT</Text> : null}
              </Pressable>
            );
          })}
        </View>
      )}

      <Text style={[styles.hint, { color: theme.faint }]}>
        Switching updates the project sandbox. Branches with uncommitted changes cannot be switched.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, padding: 16, paddingBottom: 36, gap: 12 },
  search: {
    height: 47,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  input: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 14 },
  empty: { minHeight: 420 },
  list: { borderRadius: 10, borderWidth: 1, overflow: "hidden" },
  row: { minHeight: 67, padding: 11, flexDirection: "row", alignItems: "center", gap: 10 },
  branchMark: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, minWidth: 0 },
  name: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  sha: { fontFamily: "Inter_500Medium", fontSize: 10, marginTop: 5 },
  current: { fontFamily: "Inter_700Bold", fontSize: 9, letterSpacing: 0.8 },
  hint: { fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 16, paddingHorizontal: 4 },
});
