import { ChevronDown, type LucideIcon } from "lucide-react-native";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";

import { useAppTheme } from "../hooks/useAppTheme";

export const TOOLBAR_CONTROL_HEIGHT = 44;

const FADE_WIDTH = 20;
const SCROLL_EPSILON = 4;

/**
 * The composer toolbar: a scrolling run of pill controls with a control pinned
 * to the trailing edge, following the T3 Code mobile composer.
 */
export function ComposerToolbarRow({ children }: { children: ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

/**
 * Scrolls the pills when they overflow, fading whichever edge has more to show
 * so a clipped pill never reads as a rendering glitch.
 */
export function ComposerToolbarScroller({
  children,
  fadeColor,
}: {
  children: ReactNode;
  fadeColor: string;
}) {
  const [metrics, setMetrics] = useState({ contentWidth: 0, offsetX: 0, viewportWidth: 0 });

  const edges = useMemo(() => {
    const maxOffset = Math.max(0, metrics.contentWidth - metrics.viewportWidth);
    return {
      left: metrics.offsetX > SCROLL_EPSILON,
      right: metrics.offsetX < maxOffset - SCROLL_EPSILON,
    };
  }, [metrics]);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const viewportWidth = event.nativeEvent.layout.width;
    setMetrics((current) => current.viewportWidth === viewportWidth
      ? current
      : { ...current, viewportWidth });
  }, []);

  const onContentSizeChange = useCallback((contentWidth: number) => {
    setMetrics((current) => current.contentWidth === contentWidth
      ? current
      : { ...current, contentWidth });
  }, []);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = event.nativeEvent.contentOffset.x;
    setMetrics((current) => Math.abs(current.offsetX - offsetX) < 1
      ? current
      : { ...current, offsetX });
  }, []);

  const transparent = "rgba(0,0,0,0)";
  return (
    <View style={styles.scrollerWrap}>
      <ScrollView
        contentContainerStyle={styles.scrollerContent}
        horizontal
        keyboardShouldPersistTaps="always"
        onContentSizeChange={onContentSizeChange}
        onLayout={onLayout}
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsHorizontalScrollIndicator={false}
      >
        {children}
      </ScrollView>
      {edges.left ? (
        <View
          pointerEvents="none"
          style={[
            styles.fade,
            styles.fadeLeft,
            { experimental_backgroundImage: `linear-gradient(to right, ${fadeColor}, ${transparent})` },
          ]}
        />
      ) : null}
      {edges.right ? (
        <View
          pointerEvents="none"
          style={[
            styles.fade,
            styles.fadeRight,
            { experimental_backgroundImage: `linear-gradient(to right, ${transparent}, ${fadeColor})` },
          ]}
        />
      ) : null}
    </View>
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
  scrollerWrap: { flex: 1, minWidth: 0, position: "relative" },
  scrollerContent: { alignItems: "center", gap: 7, paddingRight: 2 },
  fade: { position: "absolute", top: 0, bottom: 0, width: FADE_WIDTH },
  fadeLeft: { left: 0 },
  fadeRight: { right: 0 },
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
