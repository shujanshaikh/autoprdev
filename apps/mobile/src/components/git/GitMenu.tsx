import { CircleArrowDown, CircleArrowOutUpRight, CircleArrowUp, CircleCheckBig, GitBranch, MessageSquareText, MoreHorizontal, type LucideIcon } from "lucide-react-native";
import { useCallback, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppTheme } from "../../hooks/useAppTheme";
import { useThreadGit } from "../../hooks/useThreadGit";
import { gitStatusSummary, type ThreadGitAction } from "../../lib/gitActions";
import { openExternalUrl } from "../../lib/openUrl";

const actionIcons = {
  commit: CircleCheckBig,
  commit_push: CircleArrowOutUpRight,
  commit_push_create_pr: CircleArrowOutUpRight,
  push: CircleArrowUp,
  push_create_pr: CircleArrowOutUpRight,
  create_pr: CircleArrowOutUpRight,
  pull: CircleArrowDown,
  view_pr: CircleArrowOutUpRight,
} satisfies Record<ThreadGitAction, LucideIcon>;

function MenuRow({
  icon: Icon,
  title,
  subtitle,
  disabled = false,
  first = false,
  onPress,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  disabled?: boolean;
  first?: boolean;
  onPress: () => void;
}) {
  const theme = useAppTheme();
  return (
    <View>
      {first ? null : <View style={[styles.divider, { backgroundColor: theme.line }]} />}
      <Pressable
        accessibilityLabel={title}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.row,
          { backgroundColor: pressed ? theme.surfaceSoft : "transparent", opacity: disabled ? 0.5 : 1 },
        ]}
      >
        <View style={styles.rowIcon}>
          <Icon color={theme.muted} size={19} />
        </View>
        <View style={styles.rowCopy}>
          <Text numberOfLines={1} style={[styles.rowTitle, { color: theme.ink }]}>{title}</Text>
          {subtitle ? (
            <Text numberOfLines={2} style={[styles.rowSubtitle, { color: theme.muted }]}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}

type GitMenuProps = {
  projectId: string;
  threadId: string;
  title?: string;
  visible: boolean;
  onClose: () => void;
  onOpenOverview: () => void;
  onOpenCommit: () => void;
  onOpenReview: () => void;
};

/**
 * The compact Git menu anchored under the thread header, mirroring the T3 Code
 * mobile popover: branch state, the one action the branch actually needs, and a
 * way through to review and the full Git sheet.
 *
 * The body is a separate component so opening the menu is what starts polling
 * Git status, not merely being on the thread.
 */
export function GitMenu(props: GitMenuProps) {
  return (
    <Modal
      animationType="fade"
      onRequestClose={props.onClose}
      transparent
      visible={props.visible}
    >
      {props.visible ? <GitMenuBody {...props} /> : null}
    </Modal>
  );
}

function GitMenuBody({
  projectId,
  threadId,
  title,
  onClose,
  onOpenOverview,
  onOpenCommit,
  onOpenReview,
}: GitMenuProps) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const git = useThreadGit(projectId, threadId);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { status, resolution, blockedReason, run } = git;
  const primaryAction = resolution.primaryAction;
  const availability = primaryAction
    ? resolution.actions[primaryAction]
    : { enabled: false, reason: resolution.primaryReason };
  const PrimaryIcon = primaryAction ? actionIcons[primaryAction] : CircleCheckBig;

  const runPrimary = useCallback(async () => {
    if (!primaryAction || pending) return;

    if (primaryAction === "view_pr") {
      const url = status?.pullRequest?.url;
      onClose();
      if (url) await openExternalUrl(url);
      return;
    }

    // Anything that commits goes through the commit sheet so the message can be
    // written first; the rest runs straight away, as it does on the web.
    if (primaryAction.startsWith("commit")) {
      onClose();
      onOpenCommit();
      return;
    }

    // The menu stays open while the action runs: these requests hold open for
    // the whole push/PR run, and closing first would leave a transport failure
    // with nowhere to surface. The backdrop still dismisses it mid-flight.
    setPending(true);
    setActionError(null);
    try {
      await run({ action: primaryAction });
      onClose();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "The Git action could not be completed.");
    } finally {
      setPending(false);
    }
  }, [onClose, onOpenCommit, pending, primaryAction, run, status]);

  return (
    <>
      <Pressable accessibilityLabel="Close Git menu" onPress={onClose} style={styles.backdrop} />
      <View style={[styles.anchor, { top: insets.top + 52 }]} pointerEvents="box-none">
        <View style={[styles.card, { backgroundColor: theme.surfaceRaised, borderColor: theme.line }]}>
          <Text style={[styles.heading, { color: theme.muted }]}>Git</Text>

          <MenuRow
            first
            icon={GitBranch}
            onPress={() => {
              onClose();
              onOpenOverview();
            }}
            subtitle={gitStatusSummary(status)}
            title={status?.currentBranch ?? title ?? "Detached HEAD"}
          />

          <MenuRow
            disabled={pending || Boolean(blockedReason) || !availability.enabled}
            icon={PrimaryIcon}
            onPress={() => void runPrimary()}
            subtitle={pending
              ? "Working…"
              : blockedReason ?? availability.reason ?? "Ready to run"}
            title={resolution.primaryLabel}
          />

          <MenuRow
            icon={MessageSquareText}
            onPress={() => {
              onClose();
              onOpenReview();
            }}
            subtitle="Turn diffs and worktree changes"
            title="Review changes"
          />

          <MenuRow
            icon={MoreHorizontal}
            onPress={() => {
              onClose();
              onOpenOverview();
            }}
            subtitle="Commit, push, PR, branches"
            title="More"
          />

          {actionError ? (
            <Text style={[styles.error, { color: theme.danger }]}>{actionError}</Text>
          ) : null}
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.25)" },
  anchor: { position: "absolute", right: 12, left: 60 },
  card: {
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
    boxShadow: "0 18px 44px rgba(0,0,0,0.32)",
  },
  heading: { fontFamily: "DMSans_500Medium", fontSize: 14, paddingHorizontal: 4, paddingBottom: 8 },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 44 },
  row: { minHeight: 62, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 12 },
  rowIcon: { width: 32, alignItems: "center", justifyContent: "center" },
  rowCopy: { flex: 1, minWidth: 0, gap: 3 },
  rowTitle: { fontFamily: "DMSans_500Medium", fontSize: 19, letterSpacing: -0.4 },
  rowSubtitle: { fontFamily: "DMSans_400Regular", fontSize: 14, lineHeight: 19 },
  error: { fontFamily: "DMSans_400Regular", fontSize: 12, lineHeight: 17, paddingHorizontal: 4, paddingBottom: 6 },
});
