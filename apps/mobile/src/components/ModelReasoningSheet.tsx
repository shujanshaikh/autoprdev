import { Check, ChevronRight, X } from "lucide-react-native";
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
        { backgroundColor: pressed ? theme.surfaceSoft : theme.surface },
      ]}
    >
      <View style={[styles.providerMark, { backgroundColor: theme.surfaceSoft }]}>
        <OpenAIIcon size={17} />
      </View>
      <View style={styles.modelCopy}>
        <Text numberOfLines={1} style={[styles.modelName, { color: theme.ink }]}>
          {formatCodexModelLabel(model)}
        </Text>
        <Text style={[styles.providerName, { color: theme.muted }]}>Codex</Text>
      </View>
      {selected
        ? <Check color={theme.accentOn} size={19} strokeWidth={2.5} />
        : <ChevronRight color={theme.faint} size={16} />}
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
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      transparent
      visible={visible}
    >
      <View style={styles.modal}>
        <Pressable
          accessibilityLabel="Close model picker"
          onPress={onClose}
          style={styles.backdrop}
        />
        <SafeAreaView
          edges={["bottom"]}
          style={[styles.sheet, { backgroundColor: theme.surfaceRaised, borderColor: theme.line }]}
        >
          <View style={styles.handleWrap}>
            <View style={[styles.handle, { backgroundColor: theme.strongLine }]} />
          </View>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={[styles.title, { color: theme.ink }]}>Model</Text>
              <Text style={[styles.subtitle, { color: theme.muted }]}>
                Choose the model and how deeply it should reason.
              </Text>
            </View>
            <Pressable
              accessibilityLabel="Close"
              onPress={onClose}
              style={[styles.close, { backgroundColor: theme.surfaceSoft }]}
            >
              <X color={theme.ink} size={17} />
            </Pressable>
          </View>

          <FlatList
            contentContainerStyle={styles.content}
            data={models}
            ItemSeparatorComponent={() => (
              <View style={[styles.separator, { backgroundColor: theme.line }]} />
            )}
            keyExtractor={modelKey}
            ListEmptyComponent={(
              <View style={styles.modelRow}>
                <View style={[styles.providerMark, { backgroundColor: theme.surfaceSoft }]}>
                  <OpenAIIcon size={17} />
                </View>
                <View style={styles.modelCopy}>
                  <Text style={[styles.modelName, { color: theme.ink }]}>Auto model</Text>
                  <Text style={[styles.providerName, { color: theme.muted }]}>
                    Codex will select an available model.
                  </Text>
                </View>
              </View>
            )}
            ListFooterComponent={(
              <View style={styles.reasoningSection}>
                <Text style={[styles.sectionLabel, { color: theme.muted }]}>Reasoning effort</Text>
                <View
                  accessibilityRole="radiogroup"
                  style={[styles.reasoningControl, { backgroundColor: theme.surfaceSoft }]}
                >
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
                          selected && {
                            backgroundColor: theme.surfaceRaised,
                            borderColor: theme.line,
                          },
                        ]}
                      >
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.reasoningName,
                            { color: selected ? theme.ink : theme.muted },
                          ]}
                        >
                          {formatReasoningEffort(effort)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}
            ListHeaderComponent={(
              <Text style={[styles.sectionLabel, { color: theme.muted }]}>Available models</Text>
            )}
            renderItem={renderModel}
            showsVerticalScrollIndicator={false}
            style={[styles.modelList, { backgroundColor: theme.surface, borderColor: theme.line }]}
          />
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal: { flex: 1, justifyContent: "flex-end" },
  backdrop: { position: "absolute", inset: 0, backgroundColor: "rgba(0,0,0,0.38)" },
  sheet: {
    maxHeight: "78%",
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 1,
    overflow: "hidden",
  },
  handleWrap: { height: 23, alignItems: "center", justifyContent: "center" },
  handle: { width: 38, height: 4, borderRadius: 2 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  headerCopy: { flex: 1 },
  title: { fontFamily: "DMSans_700Bold", fontSize: 21, letterSpacing: -0.45 },
  subtitle: { fontFamily: "DMSans_400Regular", fontSize: 13, lineHeight: 18, marginTop: 3 },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  modelList: {
    marginHorizontal: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderRadius: 18,
  },
  content: { paddingTop: 12, paddingBottom: 16 },
  sectionLabel: {
    fontFamily: "DMSans_500Medium",
    fontSize: 12,
    letterSpacing: 0.2,
    marginHorizontal: 14,
    marginBottom: 8,
  },
  modelRow: {
    minHeight: 58,
    paddingHorizontal: 14,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 58 },
  providerMark: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  modelCopy: { flex: 1, minWidth: 0 },
  modelName: { fontFamily: "DMSans_500Medium", fontSize: 15 },
  providerName: { fontFamily: "DMSans_400Regular", fontSize: 11, marginTop: 2 },
  reasoningSection: { paddingTop: 22 },
  reasoningControl: { marginHorizontal: 10, borderRadius: 12, padding: 3, flexDirection: "row" },
  reasoningOption: {
    flex: 1,
    minHeight: 34,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "transparent",
    paddingHorizontal: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  reasoningName: { fontFamily: "DMSans_500Medium", fontSize: 11 },
});
