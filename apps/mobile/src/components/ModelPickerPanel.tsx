import { Check, X } from "lucide-react-native";
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

const ModelCard = memo(function ModelCard({
  model,
  selected,
  onSelect,
}: {
  model: string;
  selected: boolean;
  onSelect: (model: string) => void;
}) {
  const theme = useAppTheme();
  const select = useCallback(() => onSelect(model), [model, onSelect]);
  const contextLimit = formatCodexContextLimit(model);
  const levels = getCodexReasoningEfforts(model).length;

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={select}
      style={({ pressed }) => [
        styles.modelCard,
        {
          backgroundColor: selected ? theme.accentSoft : pressed ? theme.surfaceSoft : theme.surface,
          borderColor: selected ? theme.accent : theme.line,
        },
      ]}
    >
      <View style={[styles.modelMark, { backgroundColor: selected ? theme.surface : theme.surfaceSoft }]}>
        <OpenAIIcon size={16} />
      </View>
      <View style={styles.modelCopy}>
        <Text numberOfLines={1} style={[styles.modelName, { color: theme.ink }]}>
          {formatCodexModelLabel(model)}
        </Text>
        <Text numberOfLines={1} style={[styles.modelMeta, { color: theme.muted }]}>
          {[contextLimit, `${levels} reasoning levels`].filter(Boolean).join(" · ")}
        </Text>
      </View>
      {selected ? <Check color={theme.accentOn} size={18} strokeWidth={2.6} /> : null}
    </Pressable>
  );
});

/**
 * Model + reasoning chooser body. Rendered inside a modal sheet on the project
 * and thread screens, and as an in-place overlay inside the composer sheet
 * (nesting a second modal on top of a full-screen one is unreliable on iOS).
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
    <View style={[styles.panel, { backgroundColor: theme.surfaceRaised, borderColor: theme.line }]}>
      <View style={styles.handleWrap}>
        <View style={[styles.handle, { backgroundColor: theme.strongLine }]} />
      </View>

      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: theme.ink }]}>Model</Text>
          <Text style={[styles.subtitle, { color: theme.muted }]}>
            Pick the model and how hard it should think.
          </Text>
        </View>
        <Pressable
          accessibilityLabel="Close model picker"
          accessibilityRole="button"
          onPress={onClose}
          style={({ pressed }) => [
            styles.close,
            { backgroundColor: theme.surfaceSoft, opacity: pressed ? 0.6 : 1 },
          ]}
        >
          <X color={theme.ink} size={17} />
        </Pressable>
      </View>

      <Text style={[styles.sectionLabel, { color: theme.faint }]}>MODEL</Text>
      <ScrollView
        accessibilityRole="radiogroup"
        contentContainerStyle={styles.modelList}
        showsVerticalScrollIndicator={false}
        style={styles.modelScroll}
      >
        {models.length === 0 ? (
          <View style={[styles.modelCard, { backgroundColor: theme.surface, borderColor: theme.line }]}>
            <View style={[styles.modelMark, { backgroundColor: theme.surfaceSoft }]}>
              <OpenAIIcon size={16} />
            </View>
            <View style={styles.modelCopy}>
              <Text style={[styles.modelName, { color: theme.ink }]}>Auto model</Text>
              <Text style={[styles.modelMeta, { color: theme.muted }]}>
                Codex will select an available model.
              </Text>
            </View>
          </View>
        ) : (
          models.map((model) => (
            <ModelCard
              key={model}
              model={model}
              onSelect={onSelectModel}
              selected={model === selectedModel}
            />
          ))
        )}
      </ScrollView>

      <View style={[styles.reasoning, { borderTopColor: theme.line }]}>
        <View style={styles.reasoningHeading}>
          <Text style={[styles.sectionLabel, { color: theme.faint }]}>REASONING EFFORT</Text>
          <Text style={[styles.reasoningValue, { color: theme.ink }]}>
            {formatReasoningEffort(selectedReasoningEffort)}
          </Text>
        </View>
        <View accessibilityRole="radiogroup" style={styles.effortGrid}>
          {reasoningEfforts.map((effort) => {
            const selected = effort === selectedReasoningEffort;
            return (
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                key={effort}
                onPress={() => onSelectReasoningEffort(effort)}
                style={({ pressed }) => [
                  styles.effort,
                  {
                    backgroundColor: selected
                      ? theme.accentSoft
                      : pressed ? theme.surfaceSoft : theme.surface,
                    borderColor: selected ? theme.accent : theme.line,
                  },
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[styles.effortText, { color: selected ? theme.accentOn : theme.muted }]}
                >
                  {formatReasoningEffort(effort)}
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
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 1,
    overflow: "hidden",
  },
  handleWrap: { height: 22, alignItems: "center", justifyContent: "center" },
  handle: { width: 38, height: 4, borderRadius: 2 },
  header: {
    paddingHorizontal: 18,
    paddingBottom: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { fontFamily: "DMSans_700Bold", fontSize: 20, letterSpacing: -0.45 },
  subtitle: { fontFamily: "DMSans_400Regular", fontSize: 12, lineHeight: 17, marginTop: 2 },
  close: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  sectionLabel: { fontFamily: "DMSans_700Bold", fontSize: 9, letterSpacing: 1.4 },
  modelScroll: { maxHeight: 268, marginTop: 8, paddingHorizontal: 14 },
  modelList: { paddingBottom: 14, gap: 8 },
  modelCard: {
    minHeight: 58,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  modelMark: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  modelCopy: { flex: 1, minWidth: 0 },
  modelName: { fontFamily: "DMSans_500Medium", fontSize: 14 },
  modelMeta: { fontFamily: "DMSans_400Regular", fontSize: 11, marginTop: 3 },
  reasoning: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 18, paddingTop: 14 },
  reasoningHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  reasoningValue: { fontFamily: "DMSans_500Medium", fontSize: 12 },
  effortGrid: { marginTop: 10, flexDirection: "row", flexWrap: "wrap", gap: 7 },
  effort: {
    minHeight: 36,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  effortText: { fontFamily: "DMSans_500Medium", fontSize: 12 },
  effortDescription: { fontFamily: "DMSans_400Regular", fontSize: 11, lineHeight: 16, marginTop: 10 },
});
