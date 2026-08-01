import { useCallback, useRef, useState, type ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";

/**
 * A screen body that lifts its content clear of the keyboard.
 *
 * `KeyboardAvoidingView` compares its own parent-relative layout against the
 * keyboard's window position, so on a screen that starts below an opaque
 * navigation header it pads short by exactly the header's height. Measuring
 * where this wrapper actually sits in the window recovers that difference,
 * without hard-coding a header height or reaching for a navigation-internal
 * hook.
 */
export function KeyboardAvoidingScreen({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const wrapperRef = useRef<View>(null);
  const [offset, setOffset] = useState(0);

  const onLayout = useCallback((_event: LayoutChangeEvent) => {
    if (Platform.OS !== "ios") return;
    wrapperRef.current?.measureInWindow((_x, windowY) => {
      const next = Math.max(0, Math.round(windowY));
      setOffset((current) => (Math.abs(current - next) < 1 ? current : next));
    });
  }, []);

  return (
    <View onLayout={onLayout} ref={wrapperRef} style={style}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={offset}
        style={styles.fill}
      >
        {children}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
