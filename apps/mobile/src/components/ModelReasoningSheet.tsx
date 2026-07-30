import { Check, X } from "lucide-react-native";
import { memo, useCallback } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAppTheme } from "../hooks/useAppTheme";
import {
  formatCodexModelLabel,
  formatReasoningEffort,
  type CodexReasoningEffort,
} from "../lib/codexModels";
import { OpenAIIcon } from "./OpenAIIcon";

type Props = {
  visible: boolean;
  models: readonly string[];
  selectedModel: string | undefined;
  reasoningEfforts: readonly CodexReasoningEffort[];
  selectedReasoningEffort: CodexReasoningEffort;
  onSelectModel: (model: string) => void;
  onSelectReasoningEffort: (effort: CodexReasoningEffort) => void;
  onClose: () => void;
};

const reasoningDescriptions: Record<CodexReasoningEffort, string> = {
  low: "Fast",
  medium: "Balanced",
  high: "Thorough",
  xhigh: "Deep",
  max: "Maximum",
  ultra: "Exhaustive",
};

const modelKey = (model: string) => model;

const ModelRow = memo(function ModelRow({
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
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={select}
      style={({ pressed }) => [
        styles.modelRow,
        {
          backgroundColor: selected ? theme.accentSoft : pressed ? theme.surfaceSoft : theme.surface,
          borderColor: selected ? theme.accent : theme.line,
        },
      ]}
    >
      <View style={[styles.providerMark, { backgroundColor: theme.surfaceRaised, borderColor: theme.line }]}>
        <OpenAIIcon size={19} />
      </View>
      <View style={styles.modelCopy}>
        <Text style={[styles.modelName, { color: theme.ink }]}>{formatCodexModelLabel(model)}</Text>
        <Text style={[styles.providerName, { color: theme.muted }]}>OpenAI · Codex</Text>
      </View>
      {selected ? (
        <View style={[styles.check, { backgroundColor: theme.accent }]}>
          <Check color={theme.accentInk} size={13} strokeWidth={3} />
        </View>
      ) : null}
    </Pressable>
  );
});

export function ModelReasoningSheet({
  visible,
  models,
  selectedModel,
  reasoningEfforts,
  selectedReasoningEffort,
  onSelectModel,
  onSelectReasoningEffort,
  onClose,
}: Props) {
  const theme = useAppTheme();
  const renderModel = useCallback(
    ({ item }: { item: string }) => (
      <ModelRow model={item} selected={item === selectedModel} onSelect={onSelectModel} />
    ),
    [onSelectModel, selectedModel],
  );

  return (
    <Modal
      animationType="slide"
      transparent
      presentationStyle="overFullScreen"
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.modal}>
        <Pressable accessibilityLabel="Close model picker" onPress={onClose} style={styles.backdrop} />
        <SafeAreaView edges={["bottom"]} style={[styles.sheet, { backgroundColor: theme.surfaceRaised, borderColor: theme.line }]}>
          <View style={styles.handleWrap}>
            <View style={[styles.handle, { backgroundColor: theme.strongLine }]} />
          </View>
          <View style={styles.header}>
            <View>
              <Text style={[styles.title, { color: theme.ink }]}>Model and reasoning</Text>
              <Text style={[styles.subtitle, { color: theme.muted }]}>Choose how Codex handles this task.</Text>
            </View>
            <Pressable accessibilityLabel="Close" onPress={onClose} style={[styles.close, { backgroundColor: theme.surfaceSoft }]}>
              <X color={theme.ink} size={18} />
            </Pressable>
          </View>

          <FlatList
            data={models}
            keyExtractor={modelKey}
            renderItem={renderModel}
            contentContainerStyle={styles.models}
            ListHeaderComponent={<Text style={[styles.sectionLabel, { color: theme.faint }]}>MODEL</Text>}
            ListEmptyComponent={(
              <View style={[styles.autoModel, { backgroundColor: theme.surface, borderColor: theme.line }]}>
                <View style={[styles.providerMark, { backgroundColor: theme.surfaceRaised, borderColor: theme.line }]}>
                  <OpenAIIcon size={19} />
                </View>
                <View style={styles.modelCopy}>
                  <Text style={[styles.modelName, { color: theme.ink }]}>Auto model</Text>
                  <Text style={[styles.providerName, { color: theme.muted }]}>Codex will select the available model.</Text>
                </View>
              </View>
            )}
            ListFooterComponent={(
              <View style={styles.reasoningSection}>
                <Text style={[styles.sectionLabel, { color: theme.faint }]}>REASONING</Text>
                <View style={styles.reasoningGrid}>
                  {reasoningEfforts.map((effort) => {
                    const selected = effort === selectedReasoningEffort;
                    return (
                      <Pressable
                        accessibilityRole="radio"
                        accessibilityState={{ checked: selected }}
                        key={effort}
                        onPress={() => onSelectReasoningEffort(effort)}
                        style={[
                          styles.reasoningOption,
                          {
                            backgroundColor: selected ? theme.accentSoft : theme.surface,
                            borderColor: selected ? theme.accent : theme.line,
                          },
                        ]}
                      >
                        <Text style={[styles.reasoningName, { color: theme.ink }]}>{formatReasoningEffort(effort)}</Text>
                        <Text style={[styles.reasoningDescription, { color: theme.muted }]}>{reasoningDescriptions[effort]}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}
          />
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [styles.done, { backgroundColor: theme.accent, opacity: pressed ? 0.78 : 1 }]}
          >
            <Text style={[styles.doneText, { color: theme.accentInk }]}>Done</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal: { flex: 1, justifyContent: "flex-end" },
  backdrop: { position: "absolute", inset: 0, backgroundColor: "rgba(0,0,0,0.38)" },
  sheet: { maxHeight: "82%", borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, overflow: "hidden" },
  handleWrap: { height: 22, alignItems: "center", justifyContent: "center" },
  handle: { width: 38, height: 4, borderRadius: 2 },
  header: { paddingHorizontal: 18, paddingBottom: 15, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontFamily: "Inter_700Bold", fontSize: 19, letterSpacing: -0.45 },
  subtitle: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 4 },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  models: { paddingHorizontal: 14, paddingBottom: 12, gap: 7 },
  sectionLabel: { fontFamily: "Inter_700Bold", fontSize: 9, letterSpacing: 1.2, marginBottom: 3, marginLeft: 4 },
  modelRow: { minHeight: 68, borderRadius: 14, borderWidth: 1, padding: 10, flexDirection: "row", alignItems: "center", gap: 11 },
  autoModel: { minHeight: 68, borderRadius: 14, borderWidth: 1, padding: 10, flexDirection: "row", alignItems: "center", gap: 11 },
  providerMark: { width: 42, height: 42, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  modelCopy: { flex: 1, minWidth: 0 },
  modelName: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  providerName: { fontFamily: "Inter_400Regular", fontSize: 10, marginTop: 4 },
  check: { width: 23, height: 23, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  reasoningSection: { paddingTop: 18 },
  reasoningGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 4 },
  reasoningOption: { minWidth: "30%", flexGrow: 1, borderRadius: 12, borderWidth: 1, paddingHorizontal: 11, paddingVertical: 10 },
  reasoningName: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
  reasoningDescription: { fontFamily: "Inter_400Regular", fontSize: 9, marginTop: 3 },
  done: { minHeight: 48, borderRadius: 14, marginHorizontal: 14, marginTop: 4, marginBottom: 8, alignItems: "center", justifyContent: "center" },
  doneText: { fontFamily: "Inter_700Bold", fontSize: 13 },
});
