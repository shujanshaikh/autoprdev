import { api } from "@autopr/backend/convex/_generated/api";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQuery } from "convex/react";
import {
  CircleArrowDown,
  CircleArrowOutUpRight,
  CircleArrowUp,
  CircleCheckBig,
  GitBranch,
  MessageSquareText,
  RefreshCw,
} from "lucide-react-native";
import { useCallback, useLayoutEffect, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { GitOperationProgress } from "../components/git/GitOperationProgress";
import { SheetCard, SheetMetaCard, SheetRow, SheetSectionTitle } from "../components/SheetList";
import { ErrorNotice, LoadingState } from "../components/ui";
import { useAppTheme } from "../hooks/useAppTheme";
import { useThreadGit } from "../hooks/useThreadGit";
import {
  gitStatusSummary,
  rowAction,
  rowDetail,
  rowLabel,
  type GitOverviewRow,
} from "../lib/gitActions";
import { openExternalUrl } from "../lib/openUrl";
import type { RootStackParamList } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "GitActions">;

const rowIcons = {
  commit: CircleCheckBig,
  push: CircleArrowUp,
  pr: CircleArrowOutUpRight,
  pull: CircleArrowDown,
} as const;

export function GitActionsScreen({ navigation, route }: Props) {
  const { projectId, threadId } = route.params;
  const theme = useAppTheme();
  const project = useQuery(api.projects.get, { projectId });
  const git = useThreadGit(projectId, threadId);
  const [pendingRow, setPendingRow] = useState<GitOverviewRow | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const { status, resolution, latestOperation, busy, blockedReason, refresh, run } = git;
  const branchLabel = status?.currentBranch ?? "Detached HEAD";

  useLayoutEffect(() => {
    navigation.setOptions({
      title: branchLabel,
      headerTitle: () => (
        <View style={styles.headerTitle}>
          <Text numberOfLines={1} style={[styles.headerBranch, { color: theme.ink }]}>
            {branchLabel}
          </Text>
          <Text numberOfLines={1} style={[styles.headerSummary, { color: theme.muted }]}>
            {gitStatusSummary(status)}
          </Text>
        </View>
      ),
      headerRight: () => (
        <Pressable
          accessibilityLabel="Refresh Git status"
          disabled={busy}
          onPress={() => void refresh()}
          style={({ pressed }) => [
            styles.headerButton,
            { backgroundColor: theme.surfaceSoft, opacity: pressed || busy ? 0.5 : 1 },
          ]}
        >
          <RefreshCw color={theme.ink} size={16} />
        </Pressable>
      ),
    });
  }, [branchLabel, busy, navigation, refresh, status, theme]);

  const pullRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  const pressRow = useCallback(async (row: GitOverviewRow) => {
    if (pendingRow) return;
    const action = rowAction(row, resolution);
    setActionError(null);

    if (action === "view_pr") {
      const url = status?.pullRequest?.url;
      if (url) await openExternalUrl(url);
      return;
    }

    if (row === "commit") {
      navigation.navigate("GitCommit", { projectId, threadId, title: route.params.title });
      return;
    }

    setPendingRow(row);
    try {
      await run({ action });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The Git action could not be completed.");
    } finally {
      setPendingRow(null);
    }
  }, [navigation, pendingRow, projectId, resolution, route.params.title, run, status, threadId]);

  const retryOperation = useCallback(async () => {
    if (!latestOperation || latestOperation.status !== "failed" || pendingRow) return;
    setPendingRow("commit");
    setActionError(null);
    try {
      await run({
        action: latestOperation.requestedAction,
        operationId: latestOperation.operationId,
        commitMessage: latestOperation.commitMessage,
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The Git action could not be retried.");
    } finally {
      setPendingRow(null);
    }
  }, [latestOperation, pendingRow, run]);

  if (git.isLoading && !status) return <LoadingState label="Checking Git status…" />;

  const rows: GitOverviewRow[] = [
    "commit",
    "push",
    "pr",
    ...((status?.behindCount ?? 0) > 0 ? ["pull" as const] : []),
  ];
  const showProgress = latestOperation
    && (latestOperation.status === "running" || latestOperation.status === "failed");

  return (
    <SafeAreaView edges={["bottom"]} style={[styles.screen, { backgroundColor: theme.screen }]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void pullRefresh()} />}
        showsVerticalScrollIndicator={false}
      >
        {git.error ? <ErrorNotice message={git.error.message} /> : null}
        {actionError ? <ErrorNotice message={actionError} /> : null}

        <SheetCard>
          {rows.map((row, index) => {
            const action = rowAction(row, resolution);
            const availability = resolution.actions[action];
            const pending = pendingRow === row;
            const rowBlocked = Boolean(blockedReason) && action !== "view_pr";
            return (
              <SheetRow
                disabled={rowBlocked || !availability.enabled || Boolean(pendingRow)}
                first={index === 0}
                icon={rowIcons[row]}
                key={row}
                onPress={() => void pressRow(row)}
                subtitle={pending
                  ? "Working…"
                  : rowBlocked
                    ? blockedReason
                    : availability.reason ?? rowDetail(row, status)}
                title={rowLabel(row, resolution)}
              />
            );
          })}
          <SheetRow
            icon={MessageSquareText}
            onPress={() => navigation.replace("Changes", {
              projectId,
              threadId,
              title: route.params.title,
            })}
            subtitle="Inspect the diff this thread produced before shipping it"
            title="Review changes"
          />
          <SheetRow
            disabled={!status?.isRepo || !project}
            icon={GitBranch}
            onPress={() => {
              if (!project) return;
              navigation.navigate("Branches", {
                projectId,
                owner: project.repoOwner,
                repo: project.repoName,
                currentBranch: branchLabel,
              });
            }}
            subtitle="Switch the branch this workspace is checked out on"
            title="Branches"
          />
        </SheetCard>

        {showProgress && latestOperation ? (
          <View style={styles.progressSection}>
            <SheetSectionTitle>
              {latestOperation.status === "failed" ? "Failed operation" : "In progress"}
            </SheetSectionTitle>
            <View style={[styles.progressCard, { backgroundColor: theme.surface, borderColor: theme.line }]}>
              <GitOperationProgress
                operation={latestOperation}
                retrying={pendingRow !== null}
                onRetry={() => void retryOperation()}
              />
            </View>
          </View>
        ) : null}

        {status ? (
          <View style={styles.metaSection}>
            <SheetMetaCard label="Base branch" value={status.baseBranch} />
            {status.pullRequest ? (
              <Pressable
                accessibilityRole="link"
                onPress={() => void openExternalUrl(status.pullRequest?.url ?? "")}
              >
                <SheetMetaCard
                  label={`Pull request · ${status.pullRequest.state}`}
                  value={`#${status.pullRequest.number} ${status.pullRequest.title}`}
                />
              </Pressable>
            ) : null}
            {status.remoteError ? (
              <SheetMetaCard label="Remote" tone="warning" value={status.remoteError.message} />
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 30, gap: 14 },
  headerTitle: { alignItems: "center", maxWidth: 240 },
  headerBranch: { fontFamily: "DMSans_700Bold", fontSize: 17, letterSpacing: -0.4 },
  headerSummary: { fontFamily: "DMSans_400Regular", fontSize: 11, marginTop: 2 },
  headerButton: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  progressSection: { gap: 8 },
  progressCard: { borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, padding: 16 },
  metaSection: { gap: 10 },
});
