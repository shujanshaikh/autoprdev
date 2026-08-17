import type { Doc } from "@autopr/backend/convex/_generated/dataModel";
import type { GitWorkflowPhase } from "@autopr/backend/convex/lib/gitWorkflow";
import { phasesForGitWorkflowAction } from "@autopr/backend/convex/lib/gitWorkflow";
import { AlertTriangle, Check, Circle, RotateCcw } from "lucide-react-native";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";

import { useAppTheme } from "../../hooks/useAppTheme";
import { SheetActionButton } from "../SheetList";

type GitOperation = Doc<"gitOperations">;

const phaseLabels = {
  branch: "Created branch",
  validate: "Running validation/hooks",
  commit: "Committed files",
  push: "Pushed to GitHub",
  pull_request: "Created pull request",
} satisfies Record<GitWorkflowPhase, string>;

/**
 * The per-phase checklist the web thread shows while a Git workflow runs,
 * including the retry the backend offers for a recoverable failure.
 */
export function GitOperationProgress({
  operation,
  retrying = false,
  onRetry,
}: {
  operation: GitOperation;
  retrying?: boolean;
  onRetry?: () => void;
}) {
  const theme = useAppTheme();
  const results = new Map(operation.phaseResults.map((result) => [result.phase, result]));
  const phases = phasesForGitWorkflowAction(operation.requestedAction);

  return (
    <View accessibilityLiveRegion="polite" style={styles.progress}>
      {phases.map((phase) => {
        const result = results.get(phase);
        const running = operation.status === "running" && operation.currentPhase === phase;
        const failed = result?.status === "failed";
        const complete = result?.status === "succeeded" || result?.status === "skipped";
        const color = failed
          ? theme.danger
          : complete || running ? theme.ink : theme.faint;

        return (
          <View key={phase} style={styles.phase}>
            <View style={styles.phaseIcon}>
              {running ? (
                <ActivityIndicator color={theme.accentOn} size="small" />
              ) : failed ? (
                <AlertTriangle color={theme.danger} size={14} />
              ) : complete ? (
                <Check color={theme.success} size={14} strokeWidth={3} />
              ) : (
                <Circle color={theme.faint} size={11} />
              )}
            </View>
            <View style={styles.phaseCopy}>
              <Text style={[styles.phaseLabel, { color }]}>
                {result?.summary ?? phaseLabels[phase]}
              </Text>
              {failed && result.failure?.diagnostics ? (
                <ScrollView
                  nestedScrollEnabled
                  style={[styles.diagnostics, { backgroundColor: theme.dangerSoft }]}
                >
                  <Text style={[styles.diagnosticsText, { color: theme.danger }]}>
                    {result.failure.diagnostics}
                  </Text>
                </ScrollView>
              ) : null}
            </View>
          </View>
        );
      })}

      {operation.status === "failed" && operation.failure ? (
        <View style={[styles.failure, { backgroundColor: theme.dangerSoft, borderColor: theme.danger }]}>
          <Text style={[styles.failureMessage, { color: theme.danger }]}>
            {operation.failure.message}
          </Text>
          {operation.failure.recoveryAction ? (
            <Text style={[styles.failureRecovery, { color: theme.muted }]}>
              {operation.failure.recoveryAction}
            </Text>
          ) : null}
          {operation.failure.retryable && onRetry ? (
            <View style={styles.retryRow}>
              <SheetActionButton
                icon={RotateCcw}
                label={`Retry from ${operation.failure.phase.replace("_", " ")}`}
                loading={retrying}
                onPress={onRetry}
              />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  progress: { gap: 9 },
  phase: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  phaseIcon: { width: 18, minHeight: 18, alignItems: "center", justifyContent: "center" },
  phaseCopy: { flex: 1, minWidth: 0 },
  phaseLabel: { fontFamily: "DMSans_400Regular", fontSize: 13, lineHeight: 18 },
  diagnostics: { maxHeight: 110, borderRadius: 8, padding: 8, marginTop: 6 },
  diagnosticsText: { fontFamily: "monospace", fontSize: 10, lineHeight: 15 },
  failure: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 12, gap: 6, marginTop: 3 },
  failureMessage: { fontFamily: "DMSans_500Medium", fontSize: 13, lineHeight: 18 },
  failureRecovery: { fontFamily: "DMSans_400Regular", fontSize: 12, lineHeight: 17 },
  retryRow: { flexDirection: "row", marginTop: 4 },
});
