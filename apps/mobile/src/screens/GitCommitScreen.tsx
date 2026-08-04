import type { GitChangedFile } from "@autopr/backend/convex/lib/gitStatus";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { CircleCheckBig } from "lucide-react-native";
import { useCallback, useLayoutEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { GitHubIcon } from "../components/GitHubIcon";
import { SheetActionButton, SheetInlineMeta } from "../components/SheetList";
import { KeyboardAvoidingScreen } from "../components/KeyboardAvoidingScreen";
import { ErrorNotice, LoadingState } from "../components/ui";
import { useAppTheme } from "../hooks/useAppTheme";
import { useThreadGit } from "../hooks/useThreadGit";
import { changedFileTotals, threadGitActionLabels, type ThreadGitAction } from "../lib/gitActions";
import type { RootStackParamList } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "GitCommit">;

const FILE_PREVIEW_COUNT = 3;
const COMMIT_MESSAGE_LIMIT = 500;

function FileRow({ file }: { file: GitChangedFile }) {
  const theme = useAppTheme();
  return (
    <View style={styles.fileRow}>
      <Text numberOfLines={1} style={[styles.filePath, { color: theme.ink }]}>{file.path}</Text>
      <Text style={[styles.fileStat, { color: theme.add }]}>+{file.additions ?? 0}</Text>
      <Text style={[styles.fileStat, { color: theme.delete }]}>−{file.deletions ?? 0}</Text>
    </View>
  );
}

export function GitCommitScreen({ navigation, route }: Props) {
  const { projectId, threadId } = route.params;
  const theme = useAppTheme();
  const git = useThreadGit(projectId, threadId);
  const [commitMessage, setCommitMessage] = useState("");
  const [pendingAction, setPendingAction] = useState<ThreadGitAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { status, resolution, blockedReason, run } = git;
  const files = status?.changedFiles ?? [];
  const totals = changedFileTotals(status);
  const previewFiles = files.slice(0, FILE_PREVIEW_COUNT);
  const hiddenFileCount = files.length - previewFiles.length;

  useLayoutEffect(() => {
    navigation.setOptions({ title: "Commit changes" });
  }, [navigation]);

  // The web pairs a plain commit with whichever combined action fits the branch:
  // "commit & push" once a PR exists, otherwise the full commit/push/PR run.
  const shipAction: ThreadGitAction = resolution.actions.commit_push_create_pr.enabled
    ? "commit_push_create_pr"
    : "commit_push";
  const commitAvailability = resolution.actions.commit;
  const shipAvailability = resolution.actions[shipAction];

  const runCommit = useCallback(async (action: ThreadGitAction) => {
    if (pendingAction || action === "view_pr") return;
    const message = commitMessage.trim();
    setPendingAction(action);
    setActionError(null);
    try {
      await run({
        action,
        ...(message ? { commitMessage: message } : {}),
      });
      navigation.goBack();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The commit could not be completed.");
      setPendingAction(null);
    }
  }, [commitMessage, navigation, pendingAction, run]);

  if (git.isLoading && !status) return <LoadingState label="Checking Git status…" />;

  const disabledReason = blockedReason ?? commitAvailability.reason;
  return (
    <SafeAreaView edges={["bottom"]} style={[styles.screen, { backgroundColor: theme.screen }]}>
      <KeyboardAvoidingScreen style={styles.screen}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {actionError ? <ErrorNotice message={actionError} /> : null}
          {disabledReason ? <ErrorNotice message={disabledReason} /> : null}

          <SheetInlineMeta label="Branch" value={status?.currentBranch ?? "Detached HEAD"} />

          <View style={[styles.filesCard, { backgroundColor: theme.surface, borderColor: theme.line }]}>
            <View style={styles.filesHeading}>
              <View style={styles.filesCopy}>
                <Text style={[styles.filesTitle, { color: theme.ink }]}>Files</Text>
                <Text style={[styles.filesMeta, { color: theme.muted }]}>
                  {files.length === 0
                    ? "No working-tree changes"
                    : `${files.length} file${files.length === 1 ? "" : "s"} · +${totals.additions} / −${totals.deletions}`}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => navigation.replace("Changes", {
                  projectId,
                  threadId,
                  title: route.params.title,
                })}
                style={({ pressed }) => [
                  styles.reviewChip,
                  { backgroundColor: theme.surfaceSoft, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <Text style={[styles.reviewChipText, { color: theme.ink }]}>Review</Text>
              </Pressable>
            </View>

            {files.length === 0 ? (
              <Text style={[styles.filesEmpty, { color: theme.muted }]}>
                There is nothing staged for this commit yet.
              </Text>
            ) : (
              <View style={styles.fileList}>
                {previewFiles.map((file) => <FileRow file={file} key={file.path} />)}
                {hiddenFileCount > 0 ? (
                  <Text style={[styles.moreFiles, { color: theme.muted }]}>
                    +{hiddenFileCount} more file{hiddenFileCount === 1 ? "" : "s"}
                  </Text>
                ) : null}
              </View>
            )}
            {status?.changedFilesTruncated ? (
              <Text style={[styles.moreFiles, { color: theme.faint }]}>
                The changed-file list was truncated by Git.
              </Text>
            ) : null}
          </View>

          <View style={styles.messageSection}>
            <Text style={[styles.messageLabel, { color: theme.ink }]}>Commit message</Text>
            <TextInput
              accessibilityLabel="Commit message"
              maxLength={COMMIT_MESSAGE_LIMIT}
              multiline
              onChangeText={setCommitMessage}
              placeholder="Leave empty to auto-generate"
              placeholderTextColor={theme.faint}
              style={[
                styles.messageInput,
                { backgroundColor: theme.surface, borderColor: theme.line, color: theme.ink },
              ]}
              textAlignVertical="top"
              value={commitMessage}
            />
            <Text style={[styles.messageHint, { color: theme.faint }]}>
              {commitMessage.length}/{COMMIT_MESSAGE_LIMIT}
            </Text>
          </View>

          <View style={styles.actions}>
            <SheetActionButton
              disabled={Boolean(blockedReason) || !commitAvailability.enabled || pendingAction !== null}
              icon={CircleCheckBig}
              label={threadGitActionLabels.commit}
              loading={pendingAction === "commit"}
              onPress={() => void runCommit("commit")}
            />
            <SheetActionButton
              disabled={Boolean(blockedReason) || !shipAvailability.enabled || pendingAction !== null}
              iconNode={<GitHubIcon color={theme.accentInk} size={15} />}
              label={threadGitActionLabels[shipAction]}
              loading={pendingAction === shipAction}
              onPress={() => void runCommit(shipAction)}
              tone="primary"
            />
          </View>
          {!shipAvailability.enabled && shipAvailability.reason ? (
            <Text style={[styles.actionReason, { color: theme.faint }]}>
              {threadGitActionLabels[shipAction]}: {shipAvailability.reason}
            </Text>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingScreen>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 28, gap: 14 },
  filesCard: { borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingVertical: 15, gap: 12 },
  filesHeading: { flexDirection: "row", alignItems: "center", gap: 12 },
  filesCopy: { flex: 1, minWidth: 0, gap: 3 },
  filesTitle: { fontFamily: "DMSans_700Bold", fontSize: 16, letterSpacing: -0.3 },
  filesMeta: { fontFamily: "DMSans_400Regular", fontSize: 12 },
  reviewChip: { minHeight: 32, borderRadius: 16, paddingHorizontal: 13, alignItems: "center", justifyContent: "center" },
  reviewChipText: { fontFamily: "DMSans_700Bold", fontSize: 10, letterSpacing: 0.8, textTransform: "uppercase" },
  filesEmpty: { fontFamily: "DMSans_400Regular", fontSize: 13, lineHeight: 19 },
  fileList: { gap: 8 },
  fileRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  filePath: { flex: 1, fontFamily: "DMSans_500Medium", fontSize: 13 },
  fileStat: { fontFamily: "DMSans_700Bold", fontSize: 11, fontVariant: ["tabular-nums"] },
  moreFiles: { fontFamily: "DMSans_400Regular", fontSize: 12 },
  messageSection: { gap: 8 },
  messageLabel: { fontFamily: "DMSans_700Bold", fontSize: 13 },
  messageInput: {
    minHeight: 128,
    maxHeight: 220,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: "DMSans_400Regular",
    fontSize: 15,
    lineHeight: 21,
  },
  messageHint: { alignSelf: "flex-end", fontFamily: "DMSans_400Regular", fontSize: 10 },
  actions: { flexDirection: "row", gap: 12, marginTop: 2 },
  actionReason: { fontFamily: "DMSans_400Regular", fontSize: 11, lineHeight: 16, paddingHorizontal: 4 },
});
