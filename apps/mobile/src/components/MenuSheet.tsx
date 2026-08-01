import { Check } from "lucide-react-native";
import { memo, useCallback } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppTheme } from "../hooks/useAppTheme";

export type MenuOption = {
  id: string;
  label: string;
  /** Second line, for options that need a word of explanation. */
  description?: string;
  /** Short right-aligned token, e.g. a context window. */
  trailing?: string;
  selected: boolean;
};

const MenuRow = memo(function MenuRow({
  option,
  first,
  onSelect,
}: {
  option: MenuOption;
  first: boolean;
  onSelect: (id: string) => void;
}) {
  const theme = useAppTheme();
  const select = useCallback(() => onSelect(option.id), [onSelect, option.id]);

  return (
    <View>
      {first ? null : <View style={[styles.divider, { backgroundColor: theme.line }]} />}
      <Pressable
        accessibilityLabel={option.label}
        accessibilityRole="radio"
        accessibilityState={{ checked: option.selected }}
        onPress={select}
        style={({ pressed }) => [
          styles.row,
          { backgroundColor: pressed ? theme.surfaceSoft : "transparent" },
        ]}
      >
        <View style={styles.rowCopy}>
          <Text numberOfLines={1} style={[styles.rowLabel, { color: theme.ink }]}>
            {option.label}
          </Text>
          {option.description ? (
            <Text numberOfLines={2} style={[styles.rowDescription, { color: theme.muted }]}>
              {option.description}
            </Text>
          ) : null}
        </View>
        {option.trailing ? (
          <Text style={[styles.rowTrailing, { color: theme.faint }]}>{option.trailing}</Text>
        ) : null}
        <View style={styles.rowCheck}>
          {option.selected ? <Check color={theme.accentOn} size={17} strokeWidth={2.6} /> : null}
        </View>
      </Pressable>
    </View>
  );
});

/**
 * A menu of mutually exclusive options, presented above the composer.
 *
 * Deliberately plain, in the shape of a native iOS menu: a label per row and a
 * checkmark on the current one. An earlier version framed every row with its own
 * icon tile and an accent band, which made a list of near-identical model names
 * read as five competing cards.
 */
export function MenuSheet({
  visible,
  title,
  options,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: readonly MenuOption[];
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();

  const select = useCallback((id: string) => {
    onSelect(id);
    onClose();
  }, [onClose, onSelect]);

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View style={[styles.modal, { paddingBottom: Math.max(insets.bottom, 10) + 74 }]}>
        <Pressable
          accessibilityLabel={`Close ${title.toLowerCase()} menu`}
          onPress={onClose}
          style={styles.backdrop}
        />
        <View
          accessibilityRole="radiogroup"
          style={[
            styles.card,
            {
              backgroundColor: theme.surfaceRaised,
              borderColor: theme.line,
              boxShadow: theme.mode === "dark"
                ? "0 16px 34px rgba(0,0,0,0.5)"
                : "0 16px 34px rgba(0,0,0,0.16)",
            },
          ]}
        >
          <Text style={[styles.title, { color: theme.faint }]}>{title}</Text>
          <ScrollView
            bounces={false}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            style={styles.scroll}
          >
            {options.map((option, index) => (
              <MenuRow first={index === 0} key={option.id} onSelect={select} option={option} />
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal: { flex: 1, justifyContent: "flex-end", alignItems: "center", paddingHorizontal: 14 },
  backdrop: { position: "absolute", inset: 0, backgroundColor: "rgba(0,0,0,0.28)" },
  card: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingBottom: 4,
    overflow: "hidden",
  },
  title: {
    fontFamily: "DMSans_700Bold",
    fontSize: 10,
    letterSpacing: 1.1,
    textTransform: "uppercase",
    paddingHorizontal: 16,
    paddingTop: 13,
    paddingBottom: 6,
  },
  scroll: { maxHeight: 372 },
  list: { paddingBottom: 2 },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 16 },
  row: {
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  rowCopy: { flex: 1, minWidth: 0 },
  rowLabel: { fontFamily: "DMSans_500Medium", fontSize: 15, letterSpacing: -0.2 },
  rowDescription: { fontFamily: "DMSans_400Regular", fontSize: 12, lineHeight: 16, marginTop: 2 },
  rowTrailing: { fontFamily: "DMSans_400Regular", fontSize: 12, fontVariant: ["tabular-nums"] },
  rowCheck: { width: 18, alignItems: "center", justifyContent: "center" },
});
