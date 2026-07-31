import { Brain, Check, X } from "lucide-react-native";
import { memo, useCallback } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useAppTheme } from "../hooks/useAppTheme";
import {
  describeReasoningEffort,
  formatCodexContextLimit,
  formatCodexModelLabel,
  formatReasoningEffort,
  getCodexReasoningEfforts,
  type CodexReasoningEffort,
} from "../lib/codexModels";
import { OpenAIIcon } from "./OpenAIIcon";

export type ModelPickerProps = {
  models: readonly string[];
  selectedModel: string | undefined;
  reasoningEfforts: readonly CodexReasoningEffort[];
  selectedReasoningEffort: CodexReasoningEffort;
  onSelectModel: (model: string) => void;
  onSelectReasoningEffort: (effort: CodexReasoningEffort) => void;
};

function compactEffortLabel(effort: CodexReasoningEffort) {
  if (effort === "medium") return "Med";
  if (effort === "xhigh") return "X-high";
  return formatReasoningEffort(effort);
}

const ModelRow = memo(function ModelRow({
  model,
  selected,
  isLast,
  onSelect,
}: {
  model: string;
  selected: boolean;
  isLast: boolean;
  onSelect: (model: string) => void;
}) {
  const theme = useAppTheme();
  const select = useCallback(() => onSelect(model), [model, onSelect]);
  const contextLimit = formatCodexContextLimit(model);
  const levels = getCodexReasoningEfforts(model).length;

  return (
    <Pressable
      accessibilityLabel={`${formatCodexModelLabel(model)}, ${contextLimit ?? "context unknown"}`}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={select}
      style={({ pressed }) => [
        styles.modelRow,
        {
          backgroundColor: selected
            ? theme.accentSoft
            : pressed
              ? theme.surfaceSoft
              : theme.surface,
          borderBottomColor: theme.line,
          borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
        },
      ]}
    >
      <View
        style={[
          styles.modelMark,
          { backgroundColor: selected ? theme.surfaceRaised : theme.surfaceSoft },
        ]}
      >
        <OpenAIIcon size={15} />
      </View>
      <View style={styles.modelCopy}>
        <Text numberOfLines={1} style={[styles.modelName, { color: theme.ink }]}>
          {formatCodexModelLabel(model)}
        </Text>
        <Text numberOfLines={1} style={[styles.modelMeta, { color: theme.muted }]}>
          {[contextLimit, `${levels} effort levels`].filter(Boolean).join("  ·  ")}
        </Text>
      </View>
      {selected ? (
        <View style={[styles.check, { backgroundColor: theme.accent }]}>
          <Check color={theme.accentInk} size={13} strokeWidth={3} />
        </View>
      ) : null}
    </Pressable>
  );
});

/**
 * A compact, menu-like model and reasoning chooser. It deliberately avoids
 * bottom-sheet chrome so callers can present it as an anchored floating card.
 */
export function ModelPickerPanel({
  models,
  selectedModel,
  reasoningEfforts,
  selectedReasoningEffort,
  onSelectModel,
  onSelectReasoningEffort,
  onClose,
}: ModelPickerProps & { onClose: () => void }) {
  const theme = useAppTheme();

  return (
    <View
      style={[
        styles.panel,
        {
          backgroundColor: theme.surfaceRaised,
          borderColor: theme.line,
          boxShadow:
            theme.mode === "dark"
              ? "0 14px 28px rgba(0,0,0,0.48)"
              : "0 14px 28px rgba(0,0,0,0.18)",
        },
      ]}
    >
      <View style={styles.header}>
        <View style={[styles.headerMark, { backgroundColor: theme.surfaceSoft }]}>
          <OpenAIIcon size={17} />
        </View>
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: theme.ink }]}>Model</Text>
          <Text numberOfLines={1} style={[styles.subtitle, { color: theme.muted }]}>
            {formatCodexModelLabel(selectedModel)} · {formatReasoningEffort(selectedReasoningEffort)}
          </Text>
        </View>
        <Pressable
          accessibilityLabel="Close model picker"
          accessibilityRole="button"
          hitSlop={8}
          onPress={onClose}
          style={({ pressed }) => [
            styles.close,
            { backgroundColor: theme.surfaceSoft, opacity: pressed ? 0.55 : 1 },
          ]}
        >
          <X color={theme.muted} size={16} strokeWidth={2.2} />
        </Pressable>
      </View>

      <View style={styles.sectionHeading}>
        <Text style={[styles.sectionLabel, { color: theme.faint }]}>AVAILABLE MODELS</Text>
        {models.length > 0 ? (
          <Text style={[styles.sectionCount, { color: theme.faint }]}>{models.length}</Text>
        ) : null}
      </View>
      <ScrollView
        accessibilityRole="radiogroup"
        bounces={false}
        contentContainerStyle={styles.modelList}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        style={[
          styles.modelScroll,
          { backgroundColor: theme.surface, borderColor: theme.line },
        ]}
      >
        {models.length === 0 ? (
          <View style={[styles.modelRow, { backgroundColor: theme.surface }]}>
            <View style={[styles.modelMark, { backgroundColor: theme.surfaceSoft }]}>
              <OpenAIIcon size={15} />
            </View>
            <View style={styles.modelCopy}>
              <Text style={[styles.modelName, { color: theme.ink }]}>Auto model</Text>
              <Text style={[styles.modelMeta, { color: theme.muted }]}>
                Codex will choose an available model.
              </Text>
            </View>
          </View>
        ) : (
          models.map((model, index) => (
            <ModelRow
              isLast={index === models.length - 1}
              key={model}
              model={model}
              onSelect={onSelectModel}
              selected={model === selectedModel}
            />
          ))
        )}
      </ScrollView>

      <View
        style={[
          styles.reasoning,
          { backgroundColor: theme.surface, borderColor: theme.line },
        ]}
      >
        <View style={styles.reasoningHeading}>
          <View style={[styles.reasoningMark, { backgroundColor: theme.surfaceSoft }]}>
            <Brain color={theme.muted} size={15} strokeWidth={2} />
          </View>
          <View style={styles.reasoningCopy}>
            <Text style={[styles.reasoningTitle, { color: theme.ink }]}>Reasoning</Text>
            <Text style={[styles.reasoningValue, { color: theme.muted }]}>
              {formatReasoningEffort(selectedReasoningEffort)} effort
            </Text>
          </View>
        </View>

        <View
          accessibilityLabel="Reasoning effort"
          accessibilityRole="radiogroup"
          style={[styles.effortTrack, { backgroundColor: theme.surfaceSoft }]}
        >
          {reasoningEfforts.map((effort) => {
            const selected = effort === selectedReasoningEffort;
            return (
              <Pressable
                accessibilityLabel={`${formatReasoningEffort(effort)} reasoning effort`}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                key={effort}
                onPress={() => onSelectReasoningEffort(effort)}
                style={({ pressed }) => [
                  styles.effort,
                  {
                    backgroundColor: selected ? theme.accent : "transparent",
                    opacity: pressed ? 0.62 : 1,
                  },
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.effortText,
                    { color: selected ? theme.accentInk : theme.muted },
                  ]}
                >
                  {compactEffortLabel(effort)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={[styles.effortDescription, { color: theme.muted }]}>
          {describeReasoningEffort(selectedReasoningEffort)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    width: "100%",
    borderRadius: 20,
    borderWidth: 1,
    padding: 12,
  },
  header: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 13,
  },
  headerMark: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { fontFamily: "DMSans_700Bold", fontSize: 16, letterSpacing: -0.3 },
  subtitle: { fontFamily: "DMSans_400Regular", fontSize: 11, marginTop: 1 },
  close: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  sectionHeading: {
    height: 22,
    paddingHorizontal: 3,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  sectionLabel: { fontFamily: "DMSans_700Bold", fontSize: 9, letterSpacing: 1.25 },
  sectionCount: { fontFamily: "DMSans_500Medium", fontSize: 10 },
  modelScroll: { maxHeight: 260, borderRadius: 14, borderWidth: 1 },
  modelList: { overflow: "hidden" },
  modelRow: {
    minHeight: 54,
    paddingHorizontal: 11,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  modelMark: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  modelCopy: { flex: 1, minWidth: 0 },
  modelName: { fontFamily: "DMSans_500Medium", fontSize: 13 },
  modelMeta: { fontFamily: "DMSans_400Regular", fontSize: 10, marginTop: 2 },
  check: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  reasoning: { borderRadius: 14, borderWidth: 1, padding: 11, marginTop: 10 },
  reasoningHeading: { flexDirection: "row", alignItems: "center", gap: 9 },
  reasoningMark: { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  reasoningCopy: { flex: 1, minWidth: 0 },
  reasoningTitle: { fontFamily: "DMSans_500Medium", fontSize: 12 },
  reasoningValue: { fontFamily: "DMSans_400Regular", fontSize: 10, marginTop: 1 },
  effortTrack: {
    minHeight: 40,
    borderRadius: 11,
    padding: 3,
    marginTop: 10,
    flexDirection: "row",
    alignItems: "stretch",
    gap: 2,
  },
  effort: { flex: 1, minWidth: 0, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  effortText: { fontFamily: "DMSans_700Bold", fontSize: 9 },
  effortDescription: { fontFamily: "DMSans_400Regular", fontSize: 10, lineHeight: 14, marginTop: 8 },
});
