import { Check, ChevronDown } from "lucide-react-native";
import { memo, useCallback } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAppTheme } from "../hooks/useAppTheme";
import { GlassSurface } from "./GlassSurface";

/** Where the control that opened the menu sits, in window coordinates. */
export type MenuAnchor = { x: number; y: number; width: number; height: number };

export type MenuOption = {
  id: string;
  label: string;
  selected: boolean;
};

const CARD_MIN_WIDTH = 232;
const CARD_MAX_WIDTH = 320;
const SCREEN_MARGIN = 12;
const ANCHOR_GAP = 10;

const MenuRow = memo(function MenuRow({
  option,
  onSelect,
}: {
  option: MenuOption;
  onSelect: (id: string) => void;
}) {
  const theme = useAppTheme();
  const select = useCallback(() => onSelect(option.id), [onSelect, option.id]);

  return (
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
      <View style={styles.rowCheck}>
        {option.selected ? <Check color={theme.ink} size={16} strokeWidth={2.6} /> : null}
      </View>
      <Text numberOfLines={1} style={[styles.rowLabel, { color: theme.ink }]}>
        {option.label}
      </Text>
    </Pressable>
  );
});

/**
 * A menu of mutually exclusive options, presented over the control that opened
 * it in the shape of a native iOS menu: a titled header, a hairline, then plain
 * rows with a checkmark against the current one.
 *
 * The surface is glass rather than a flat fill, so the thread stays legible
 * behind it instead of the menu reading as an opaque panel dropped on top.
 */
export function MenuSheet({
  visible,
  title,
  options,
  anchor,
  onSelect,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: readonly MenuOption[];
  anchor?: MenuAnchor | null;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();

  const select = useCallback((id: string) => {
    onSelect(id);
    onClose();
  }, [onClose, onSelect]);

  const maxWidth = Math.min(CARD_MAX_WIDTH, windowWidth - SCREEN_MARGIN * 2);
  const width = Math.max(Math.min(anchor?.width ?? 0, maxWidth), CARD_MIN_WIDTH);
  const position = anchor
    ? {
        // Sits above the control, aligned to its leading edge but never past the
        // screen margins.
        bottom: Math.max(windowHeight - anchor.y + ANCHOR_GAP, insets.bottom + SCREEN_MARGIN),
        left: Math.min(
          Math.max(anchor.x, SCREEN_MARGIN),
          Math.max(windowWidth - width - SCREEN_MARGIN, SCREEN_MARGIN),
        ),
        maxHeight: anchor.y - insets.top - SCREEN_MARGIN * 2,
        width,
      }
    : {
        bottom: insets.bottom + 84,
        left: SCREEN_MARGIN,
        maxHeight: windowHeight * 0.6,
        width: Math.min(maxWidth, windowWidth - SCREEN_MARGIN * 2),
      };

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <Pressable
        accessibilityLabel={`Close ${title.toLowerCase()} menu`}
        onPress={onClose}
        style={styles.backdrop}
      />
      <View pointerEvents="box-none" style={[styles.anchorLayer, position]}>
        <GlassSurface accessibilityRole="radiogroup" radius={18} style={styles.card} translucent>
          <Pressable
            accessibilityHint="Closes this menu"
            accessibilityRole="button"
            onPress={onClose}
            style={styles.header}
          >
            <Text numberOfLines={1} style={[styles.title, { color: theme.ink }]}>{title}</Text>
            <ChevronDown color={theme.ink} size={17} strokeWidth={2.4} />
          </Pressable>
          <View style={[styles.divider, { backgroundColor: theme.line }]} />
          <ScrollView
            bounces={false}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
          >
            {options.map((option) => (
              <MenuRow key={option.id} onSelect={select} option={option} />
            ))}
          </ScrollView>
        </GlassSurface>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: "absolute", inset: 0, backgroundColor: "rgba(0,0,0,0.12)" },
  anchorLayer: { position: "absolute", boxShadow: "0 18px 40px rgba(0,0,0,0.34)" },
  card: { paddingBottom: 6 },
  header: {
    minHeight: 46,
    paddingHorizontal: 16,
    paddingTop: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  title: { flexShrink: 1, fontFamily: "DMSans_700Bold", fontSize: 17, letterSpacing: -0.3 },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 16, marginBottom: 4 },
  list: { paddingVertical: 2 },
  row: {
    minHeight: 44,
    paddingRight: 16,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  rowCheck: { width: 40, alignItems: "center", justifyContent: "center" },
  rowLabel: { flexShrink: 1, fontFamily: "DMSans_400Regular", fontSize: 17, letterSpacing: -0.2 },
});
