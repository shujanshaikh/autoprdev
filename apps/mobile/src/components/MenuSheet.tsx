import { Check, ChevronDown } from "lucide-react-native";
import { memo, useCallback, useEffect, useState } from "react";
import { useRef } from "react";
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useAppTheme } from "../hooks/useAppTheme";
import { GlassSurface } from "./GlassSurface";

/** Where the control that opened the menu sits, in window coordinates. */
export type MenuAnchor = { x: number; y: number; width: number; height: number };

export type MenuOption = {
  id: string;
  label: string;
  selected: boolean;
};

type Frame = { x: number; y: number; width: number; height: number };

const MENU_WIDTH = 250;
const MENU_RADIUS = 14;
const SCREEN_MARGIN = 12;
const ANCHOR_GAP = 6;
const MAX_MENU_HEIGHT = 480;
/** Below this, opening downward is too cramped to bother with. */
const MIN_DOWNWARD_SPACE = 280;

/**
 * The keyboard stays up while this menu is open, so the space it covers is not
 * usable. Without accounting for it the composer pills' menus open down into
 * the keyboard and cannot be tapped.
 */
function useKeyboardHeight() {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const shown = Keyboard.addListener("keyboardDidShow", (event) => {
      setHeight(event.endCoordinates.height);
    });
    const hidden = Keyboard.addListener("keyboardDidHide", () => setHeight(0));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  return height;
}

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
 * A menu of mutually exclusive options, anchored to the control that opened it
 * in the shape of a native iOS menu: a titled header, a hairline, then plain
 * rows with a checkmark against the current one.
 *
 * Rendered in-place rather than in a Modal. A modal takes focus, which dismisses
 * the keyboard and drops the composer — leaving the menu pinned to coordinates
 * that no longer describe where its pill is.
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
  const keyboardHeight = useKeyboardHeight();
  const overlayRef = useRef<View>(null);
  const [overlay, setOverlay] = useState<Frame | null>(null);

  const measureOverlay = useCallback(() => {
    overlayRef.current?.measureInWindow((x, y, width, height) => {
      setOverlay({ x, y, width, height });
    });
  }, []);

  const select = useCallback((id: string) => {
    onSelect(id);
    onClose();
  }, [onClose, onSelect]);

  if (!visible) return null;

  // Anchor in overlay-local coordinates — both were measured in window space.
  const local = anchor && overlay
    ? { x: anchor.x - overlay.x, y: anchor.y - overlay.y, width: anchor.width, height: anchor.height }
    : null;

  // Hug whichever side of the anchor leaves the menu on screen.
  const preferredLeft = local && overlay
    ? local.x + local.width / 2 <= overlay.width / 2
      ? local.x
      : local.x + local.width - MENU_WIDTH
    : 0;
  const left = overlay
    ? Math.min(
        Math.max(preferredLeft, SCREEN_MARGIN),
        Math.max(overlay.width - MENU_WIDTH - SCREEN_MARGIN, SCREEN_MARGIN),
      )
    : SCREEN_MARGIN;

  const usableBottom = overlay ? overlay.height - keyboardHeight : 0;
  const spaceBelow = local
    ? usableBottom - (local.y + local.height) - ANCHOR_GAP - SCREEN_MARGIN
    : 0;
  const spaceAbove = local ? local.y - ANCHOR_GAP - SCREEN_MARGIN : 0;
  const opensDown = spaceBelow >= MIN_DOWNWARD_SPACE || spaceBelow >= spaceAbove;
  const maxHeight = Math.min(opensDown ? spaceBelow : spaceAbove, MAX_MENU_HEIGHT);

  // The overlay frame is needed before the menu can be placed. It stays
  // unmounted for that first frame so it never flashes at the wrong spot.
  const placeable = local !== null && overlay !== null;

  return (
    <View
      onLayout={measureOverlay}
      ref={overlayRef}
      style={styles.overlay}
    >
      <Pressable
        accessibilityLabel={`Close ${title.toLowerCase()} menu`}
        onPress={onClose}
        style={styles.backdrop}
      />
      {placeable && local ? (
        <View
          style={[
            styles.card,
            {
              left,
              maxHeight,
              ...(opensDown
                ? { top: local.y + local.height + ANCHOR_GAP }
                : { bottom: overlay.height - local.y + ANCHOR_GAP }),
            },
          ]}
        >
          <GlassSurface accessibilityRole="radiogroup" radius={MENU_RADIUS} style={styles.surface}>
            <Pressable
              accessibilityHint="Closes this menu"
              accessibilityRole="button"
              onPress={onClose}
              style={styles.header}
            >
              <Text numberOfLines={1} style={[styles.title, { color: theme.ink }]}>{title}</Text>
              <ChevronDown color={theme.muted} size={16} strokeWidth={2.4} />
            </Pressable>
            <View style={[styles.divider, { backgroundColor: theme.line }]} />
            <ScrollView
              bounces={false}
              contentContainerStyle={styles.list}
              keyboardShouldPersistTaps="always"
              showsVerticalScrollIndicator={false}
            >
              {options.map((option) => (
                <MenuRow key={option.id} onSelect={select} option={option} />
              ))}
            </ScrollView>
          </GlassSurface>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: "absolute", inset: 0 },
  backdrop: { position: "absolute", inset: 0 },
  card: {
    position: "absolute",
    width: MENU_WIDTH,
    borderRadius: MENU_RADIUS,
    boxShadow: "0 14px 32px rgba(0,0,0,0.3)",
  },
  // Shrinkable so the list scrolls against the card's maxHeight instead of
  // overflowing it.
  surface: { flexShrink: 1, paddingBottom: 5 },
  header: {
    minHeight: 42,
    paddingHorizontal: 14,
    paddingTop: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  title: { flexShrink: 1, fontFamily: "DMSans_700Bold", fontSize: 16, letterSpacing: -0.3 },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 14, marginBottom: 3 },
  list: { paddingVertical: 2 },
  row: {
    minHeight: 42,
    paddingRight: 14,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
  },
  rowCheck: { width: 36, alignItems: "center", justifyContent: "center" },
  rowLabel: { flexShrink: 1, fontFamily: "DMSans_400Regular", fontSize: 16, letterSpacing: -0.2 },
});
