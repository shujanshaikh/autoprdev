import { api } from "@autopr/backend/convex/_generated/api";
import { isThreadCompatibleWithGithubPullRequest } from "@autopr/backend/convex/lib/githubPullRequest";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "convex/react";
import { Check, ChevronRight, GitFork, GitPullRequest, Search } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { webRequest } from "../api/web";
import { EmptyState, ErrorNotice, LoadingState, PrimaryButton, StatusPill } from "../components/ui";
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

type Filter = "all" | "open" | "draft" | "closed";

type PullRequestPreview = {
  number: number;
  title: string;
  author: string;
  state: "open" | "closed" | "merged";
  draft: boolean;
  htmlUrl: string;
  head: {
    repositoryFullName: string;
    branch: string;
    sha: string;
    branchAvailable: boolean;
    canPush: boolean;
  };
  base: { repositoryFullName: string; branch: string };
  isFork: boolean;
};

export function PullRequestsScreen({ navigation, route }: Props) {
  const { projectId } = route.params;
  const theme = useAppTheme();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [reference, setReference] = useState("");
  const [preview, setPreview] = useState<PullRequestPreview>();
  const [mode, setMode] = useState<"create" | "attach">("create");
  const [selectedThreadId, setSelectedThreadId] = useState("");
  const threads = useQuery(api.threads.listByProject, { projectId });
  const pulls = useWebQuery<PullsResponse>(
    ["pulls", projectId],
    `/api/project/${encodeURIComponent(projectId)}/pulls`,
    { retry: false },
  );
  const openListedPull = useWebMutation(
    async (pull: PullRequest, token) => await webRequest<{ threadId: string }>(
      `/api/project/${encodeURIComponent(projectId)}/pulls`,
      token,
      {
        method: "POST",
        body: JSON.stringify({ action: "create", reference: String(pull.number) }),
      },
    ),
    {
      invalidateQueryKeys: [["pulls", projectId]],
      onSuccess: (result, pull) => navigation.navigate("Thread", {
        projectId,
        threadId: result.threadId,
        title: pull.title,
      }),
    },
  );
  const resolveReference = useWebMutation(
    async (_: void, token) => await webRequest<{ pullRequest: PullRequestPreview }>(
      `/api/project/${encodeURIComponent(projectId)}/pulls`,
      token,
      {
        method: "POST",
        body: JSON.stringify({ action: "resolve", reference }),
      },
    ),
    {
      onSuccess: (result) => {
        setPreview(result.pullRequest);
        setMode("create");
        setSelectedThreadId("");
      },
    },
  );
  const openResolved = useWebMutation(
    async (_: void, token) => {
      if (!preview) throw new Error("Preview a pull request first.");
      if (mode === "attach" && !selectedThreadId) throw new Error("Choose a conversation to attach.");
      return await webRequest<{ threadId: string }>(
        `/api/project/${encodeURIComponent(projectId)}/pulls`,
        token,
        {
          method: "POST",
          body: JSON.stringify({
            action: mode,
            reference,
            ...(mode === "attach" ? { threadId: selectedThreadId } : {}),
          }),
        },
      );
    },
    {
      invalidateQueryKeys: [["pulls", projectId]],
      onSuccess: (result) => navigation.navigate("Thread", {
        projectId,
        threadId: result.threadId,
        title: preview?.title,
      }),
    },
  );

  const compatibleThreads = useMemo(
    () => (threads ?? []).filter(isThreadCompatibleWithGithubPullRequest),
    [threads],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (pulls.data?.pulls ?? []).filter((pull) => {
      const variant = pull.draft ? "draft" : pull.state;
      if (filter !== "all" && filter !== variant) return false;
      return !query
        || pull.title.toLowerCase().includes(query)
        || pull.user.toLowerCase().includes(query)
        || String(pull.number).includes(query)
        || pull.headRef.toLowerCase().includes(query);
    });
  }, [filter, pulls.data?.pulls, search]);

  const previewUnavailable = preview && preview.state !== "open"
    ? `This pull request is ${preview.state}. Only open pull requests can be opened.`
    : preview && !preview.head.branchAvailable
      ? "The pull request source branch is unavailable."
      : null;

  if (pulls.isLoading) return <LoadingState label="Loading pull requests…" />;

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.content, { backgroundColor: theme.screen }]}
    >
      {pulls.error ? <ErrorNotice message={pulls.error.message} /> : null}
      <View style={[styles.openCard, { backgroundColor: theme.surface, borderColor: theme.line }]}>
        <View style={styles.openHeading}>
          <View style={[styles.openIcon, { backgroundColor: theme.accentSoft }]}>
            <GitPullRequest color={theme.accentOn} size={18} />
          </View>
          <View style={styles.openCopy}>
            <Text style={[styles.openTitle, { color: theme.ink }]}>Open any GitHub PR</Text>
            <Text style={[styles.openBody, { color: theme.muted }]}>Paste a PR URL, number, or gh pr checkout command.</Text>
          </View>
        </View>
        <View style={styles.referenceRow}>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={(value) => {
              setReference(value);
              setPreview(undefined);
            }}
            onSubmitEditing={() => {
              if (reference.trim()) resolveReference.mutate();
            }}
            placeholder="PR URL or #123"
            placeholderTextColor={theme.faint}
            returnKeyType="search"
            value={reference}
            style={[styles.referenceInput, { color: theme.ink, borderColor: theme.line }]}
          />
          <Pressable
            disabled={!reference.trim() || resolveReference.isPending}
            onPress={() => resolveReference.mutate()}
            style={[
              styles.previewButton,
              { backgroundColor: theme.accent, opacity: !reference.trim() || resolveReference.isPending ? 0.4 : 1 },
            ]}
          >
            <Text style={[styles.previewButtonText, { color: theme.accentInk }]}>
              {resolveReference.isPending ? "Checking…" : "Preview"}
            </Text>
          </Pressable>
        </View>
        {resolveReference.error ? <ErrorNotice message={resolveReference.error.message} /> : null}
        {preview ? (
          <View style={[styles.preview, { backgroundColor: theme.surfaceSoft, borderColor: theme.line }]}>
            <View style={styles.previewHeading}>
              {preview.isFork
                ? <GitFork color={theme.muted} size={17} />
                : <GitPullRequest color={theme.success} size={17} />}
              <View style={styles.previewCopy}>
                <Text numberOfLines={2} style={[styles.previewTitle, { color: theme.ink }]}>#{preview.number} {preview.title}</Text>
                <Text numberOfLines={1} style={[styles.previewMeta, { color: theme.muted }]}>
                  {preview.head.repositoryFullName}:{preview.head.branch} → {preview.base.branch}
                </Text>
              </View>
              <StatusPill label={preview.draft ? "draft" : preview.state} tone={preview.state === "open" ? "success" : "neutral"} />
            </View>
            {previewUnavailable ? <ErrorNotice message={previewUnavailable} /> : (
              <>
                <View style={styles.modeRow}>
                  {(["create", "attach"] as const).map((value) => {
                    const selected = mode === value;
                    return (
                      <Pressable
                        disabled={value === "attach" && compatibleThreads.length === 0}
                        key={value}
                        onPress={() => setMode(value)}
                        style={[
                          styles.modeButton,
                          {
                            backgroundColor: selected ? theme.accentSoft : theme.surface,
                            borderColor: selected ? theme.accentOn : theme.line,
                            opacity: value === "attach" && compatibleThreads.length === 0 ? 0.4 : 1,
                          },
                        ]}
                      >
                        <Text style={[styles.modeText, { color: selected ? theme.ink : theme.muted }]}>
                          {value === "create" ? "New conversation" : "Attach existing"}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {mode === "attach" ? (
                  <View style={styles.threadChoices}>
                    {compatibleThreads.map((thread) => (
                      <Pressable
                        key={thread.threadId}
                        onPress={() => setSelectedThreadId(thread.threadId)}
                        style={[
                          styles.threadChoice,
                          {
                            backgroundColor: selectedThreadId === thread.threadId ? theme.accentSoft : theme.surface,
                            borderColor: selectedThreadId === thread.threadId ? theme.accentOn : theme.line,
                          },
                        ]}
                      >
                        <Text numberOfLines={1} style={[styles.threadChoiceText, { color: theme.ink }]}>{thread.title}</Text>
                        {selectedThreadId === thread.threadId ? <Check color={theme.accentOn} size={15} /> : null}
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                {openResolved.error ? <ErrorNotice message={openResolved.error.message} /> : null}
                <PrimaryButton
                  icon={GitPullRequest}
                  label={openResolved.isPending
                    ? "Preparing workspace…"
                    : mode === "attach" ? "Attach pull request" : "Create review conversation"}
                  loading={openResolved.isPending}
                  disabled={mode === "attach" && !selectedThreadId}
                  onPress={() => openResolved.mutate()}
                />
              </>
            )}
          </View>
        ) : null}
      </View>
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
      <View style={[styles.filters, { backgroundColor: theme.surfaceSoft }]}>
        {(["all", "open", "draft", "closed"] as const).map((value) => (
          <Pressable
            accessibilityState={{ selected: filter === value }}
            key={value}
            onPress={() => setFilter(value)}
            style={[
              styles.filter,
              filter === value && { backgroundColor: theme.surfaceRaised, borderColor: theme.line },
            ]}
          >
            <Text style={[styles.filterText, { color: filter === value ? theme.ink : theme.muted }]}>{value}</Text>
          </Pressable>
        ))}
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
              disabled={openListedPull.isPending}
              onPress={() => {
                if (pull.state === "open") openListedPull.mutate(pull);
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
      {openListedPull.error ? <ErrorNotice message={openListedPull.error.message} /> : null}
      <Text style={[styles.hint, { color: theme.faint }]}>
        Tap an open pull request to create a review thread. Long-press to open it on GitHub.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, padding: 16, paddingBottom: 36 },
  openCard: { borderRadius: 12, borderWidth: 1, padding: 12, gap: 11, marginBottom: 14 },
  openHeading: { flexDirection: "row", alignItems: "center", gap: 10 },
  openIcon: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  openCopy: { flex: 1, minWidth: 0 },
  openTitle: { fontFamily: "DMSans_700Bold", fontSize: 13 },
  openBody: { fontFamily: "DMSans_400Regular", fontSize: 10, lineHeight: 15, marginTop: 3 },
  referenceRow: { flexDirection: "row", gap: 8 },
  referenceInput: { flex: 1, height: 43, borderWidth: 1, borderRadius: 9, paddingHorizontal: 11, fontFamily: "monospace", fontSize: 11 },
  previewButton: { height: 43, borderRadius: 9, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" },
  previewButtonText: { fontFamily: "DMSans_700Bold", fontSize: 10 },
  preview: { borderWidth: 1, borderRadius: 10, padding: 11, gap: 10 },
  previewHeading: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  previewCopy: { flex: 1, minWidth: 0 },
  previewTitle: { fontFamily: "DMSans_500Medium", fontSize: 12, lineHeight: 17 },
  previewMeta: { fontFamily: "monospace", fontSize: 9, marginTop: 5 },
  modeRow: { flexDirection: "row", gap: 7 },
  modeButton: { flex: 1, minHeight: 38, borderRadius: 9, borderWidth: 1, paddingHorizontal: 8, alignItems: "center", justifyContent: "center" },
  modeText: { fontFamily: "DMSans_500Medium", fontSize: 10 },
  threadChoices: { gap: 6 },
  threadChoice: { minHeight: 42, borderWidth: 1, borderRadius: 9, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 8 },
  threadChoiceText: { flex: 1, fontFamily: "DMSans_500Medium", fontSize: 10 },
  search: {
    height: 47,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginBottom: 9,
  },
  filters: { alignSelf: "flex-start", borderRadius: 9, padding: 3, flexDirection: "row", gap: 2, marginBottom: 14 },
  filter: { minHeight: 30, borderRadius: 7, borderWidth: 1, borderColor: "transparent", paddingHorizontal: 10, alignItems: "center", justifyContent: "center" },
  filterText: { fontFamily: "DMSans_500Medium", fontSize: 9, textTransform: "capitalize" },
  input: { flex: 1, fontFamily: "DMSans_400Regular", fontSize: 14 },
  empty: { minHeight: 420 },
  list: { borderRadius: 10, borderWidth: 1, overflow: "hidden" },
  row: { minHeight: 84, padding: 12, flexDirection: "row", alignItems: "center", gap: 9 },
  numberColumn: { width: 42, alignItems: "center", gap: 5 },
  number: { fontFamily: "DMSans_500Medium", fontSize: 10 },
  copy: { flex: 1, minWidth: 0 },
  title: { fontFamily: "DMSans_500Medium", fontSize: 13, lineHeight: 18 },
  meta: { fontFamily: "DMSans_400Regular", fontSize: 10, marginTop: 6 },
  hint: { fontFamily: "DMSans_400Regular", fontSize: 11, lineHeight: 16, marginTop: 13, paddingHorizontal: 4 },
});
