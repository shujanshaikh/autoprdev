import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ChevronRight, GitPullRequest, Search } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { webRequest } from "../api/web";
import { EmptyState, ErrorNotice, LoadingState, StatusPill } from "../components/ui";
import { useAppTheme } from "../hooks/useAppTheme";
import { useWebMutation, useWebQuery } from "../hooks/useWebQuery";
import type { RootStackParamList } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "PullRequests">;

type PullRequest = {
  id: number;
  number: number;
  title: string;
  state: "open" | "closed";
  htmlUrl: string;
  user: string;
  updatedAt: string;
  draft: boolean;
  headRef: string;
  baseRef: string;
};

type PullsResponse = {
  project: { projectId: string; repoFullName: string; githubUrl: string };
  pulls: PullRequest[];
};

export function PullRequestsScreen({ navigation, route }: Props) {
  const { projectId } = route.params;
  const theme = useAppTheme();
  const [search, setSearch] = useState("");
  const pulls = useWebQuery<PullsResponse>(
    ["pulls", projectId],
    `/api/project/${encodeURIComponent(projectId)}/pulls`,
    { retry: false },
  );
  const openPull = useWebMutation(
    async (pull: PullRequest, token) => await webRequest<{ threadId: string }>(
      `/api/project/${encodeURIComponent(projectId)}/pulls`,
      token,
      {
        method: "POST",
        body: JSON.stringify({ action: "create", reference: String(pull.number) }),
      },
    ),
    {
      onSuccess: (result, pull) => navigation.navigate("Thread", {
        projectId,
        threadId: result.threadId,
        title: pull.title,
      }),
    },
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (pulls.data?.pulls ?? []).filter((pull) =>
      !query ||
      pull.title.toLowerCase().includes(query) ||
      String(pull.number).includes(query) ||
      pull.headRef.toLowerCase().includes(query));
  }, [pulls.data?.pulls, search]);

  if (pulls.isLoading) return <LoadingState label="Loading pull requests…" />;

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.content, { backgroundColor: theme.screen }]}
    >
      {pulls.error ? <ErrorNotice message={pulls.error.message} /> : null}
      <View style={[styles.search, { backgroundColor: theme.surface, borderColor: theme.line }]}>
        <Search color={theme.faint} size={17} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search pull requests"
          placeholderTextColor={theme.faint}
          style={[styles.input, { color: theme.ink }]}
        />
      </View>

      {filtered.length === 0 ? (
        <View style={styles.empty}>
          <EmptyState
            icon={GitPullRequest}
            title="No pull requests"
            body="Open pull requests for this repository will appear here."
          />
        </View>
      ) : (
        <View style={[styles.list, { backgroundColor: theme.surface, borderColor: theme.line }]}>
          {filtered.map((pull, index) => (
            <Pressable
              key={pull.id}
              disabled={openPull.isPending}
              onPress={() => {
                if (pull.state === "open") openPull.mutate(pull);
                else void Linking.openURL(pull.htmlUrl);
              }}
              onLongPress={() => void Linking.openURL(pull.htmlUrl)}
              style={({ pressed }) => [
                styles.row,
                index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line },
                { backgroundColor: pressed ? theme.surfaceSoft : theme.surface },
              ]}
            >
              <View style={styles.numberColumn}>
                <GitPullRequest
                  color={pull.state === "open" ? theme.success : theme.faint}
                  size={18}
                />
                <Text style={[styles.number, { color: theme.muted }]}>#{pull.number}</Text>
              </View>
              <View style={styles.copy}>
                <Text numberOfLines={2} style={[styles.title, { color: theme.ink }]}>{pull.title}</Text>
                <Text numberOfLines={1} style={[styles.meta, { color: theme.muted }]}>
                  {pull.headRef} → {pull.baseRef} · {pull.user}
                </Text>
              </View>
              <StatusPill
                label={pull.draft ? "draft" : pull.state}
                tone={pull.state === "open" && !pull.draft ? "success" : "neutral"}
              />
              <ChevronRight color={theme.faint} size={17} />
            </Pressable>
          ))}
        </View>
      )}
      {openPull.error ? <ErrorNotice message={openPull.error.message} /> : null}
      <Text style={[styles.hint, { color: theme.faint }]}>
        Tap an open pull request to create a review thread. Long-press to open it on GitHub.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, padding: 16, paddingBottom: 36 },
  search: {
    height: 47,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginBottom: 14,
  },
  input: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 14 },
  empty: { minHeight: 420 },
  list: { borderRadius: 10, borderWidth: 1, overflow: "hidden" },
  row: { minHeight: 84, padding: 12, flexDirection: "row", alignItems: "center", gap: 9 },
  numberColumn: { width: 42, alignItems: "center", gap: 5 },
  number: { fontFamily: "Inter_600SemiBold", fontSize: 10 },
  copy: { flex: 1, minWidth: 0 },
  title: { fontFamily: "Inter_600SemiBold", fontSize: 13, lineHeight: 18 },
  meta: { fontFamily: "Inter_400Regular", fontSize: 10, marginTop: 6 },
  hint: { fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 16, marginTop: 13, paddingHorizontal: 4 },
});
