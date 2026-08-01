import { ChevronDown, type LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useAppTheme } from "../hooks/useAppTheme";

export const TOOLBAR_CONTROL_HEIGHT = 44;

/**
 * The composer toolbar: a scrolling run of pill controls with a control pinned
 * to the trailing edge, following the T3 Code mobile composer.
 */
export function ComposerToolbarRow({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

/**
 * Scrolls the pills when they overflow.
 *
 * An earlier version faded the overflowing edges with
 * `experimental_backgroundImage`. RN 0.85 rendered those gradients as a dark
 * smear regardless of the colour passed, so the fades are gone rather than
 * shipping a grey block over the reasoning pill.
 */
export function ComposerToolbarScroller({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      contentContainerStyle={styles.scrollerContent}
      horizontal
      keyboardShouldPersistTaps="always"
      showsHorizontalScrollIndicator={false}
      style={styles.scroller}
    >
      {children}
    </ScrollView>
  );
}

export function ComposerToolbarButton({
  icon: Icon,
  iconNode,
  label,
  accessibilityLabel,
  chevron = false,
  variant = "default",
  disabled = false,
  loading = false,
  onPress,
}: {
  icon?: LucideIcon;
  iconNode?: ReactNode;
  label?: string;
  accessibilityLabel?: string;
  chevron?: boolean;
  variant?: "default" | "primary" | "danger";
  disabled?: boolean;
  loading?: boolean;
  onPress: () => void;
}) {
  const theme = useAppTheme();
  const isCircle = !label;
  const background = variant === "primary"
    ? theme.accent
    : variant === "danger" ? theme.dangerSoft : theme.surfaceSoft;
  const foreground = variant === "primary"
    ? theme.accentInk
    : variant === "danger" ? theme.danger : theme.ink;

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        isCircle ? styles.buttonCircle : styles.buttonPill,
        {
          backgroundColor: background,
          borderColor: theme.mode === "dark" ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.06)",
          opacity: disabled ? 0.42 : pressed ? 0.72 : 1,
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={foreground} size="small" />
      ) : iconNode ? (
        <View style={styles.buttonIcon}>{iconNode}</View>
      ) : Icon ? (
        <Icon color={foreground} size={17} strokeWidth={2.1} />
      ) : null}
      {label ? (
        <Text numberOfLines={1} style={[styles.buttonLabel, { color: foreground }]}>
          {label}
        </Text>
      ) : null}
      {chevron ? <ChevronDown color={theme.faint} size={12} strokeWidth={2.4} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 7, paddingTop: 8 },
  scroller: { flex: 1, minWidth: 0 },
  scrollerContent: { alignItems: "center", gap: 7, paddingRight: 2 },
  button: {
    height: TOOLBAR_CONTROL_HEIGHT,
    maxWidth: 190,
    borderRadius: TOOLBAR_CONTROL_HEIGHT / 2,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  buttonCircle: { width: TOOLBAR_CONTROL_HEIGHT },
  buttonPill: { paddingHorizontal: 14, gap: 7 },
  buttonIcon: { width: 17, height: 17, alignItems: "center", justifyContent: "center" },
  buttonLabel: { flexShrink: 1, fontFamily: "DMSans_700Bold", fontSize: 14, letterSpacing: -0.2 },
});
