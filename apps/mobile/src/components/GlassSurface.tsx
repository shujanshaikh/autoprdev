import { requireOptionalNativeModule } from "expo";
import { GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import type { PropsWithChildren } from "react";
import { Platform, View, type ViewProps, type ViewStyle } from "react-native";

import { useAppTheme } from "../hooks/useAppTheme";

const hasNativeGlassModule =
  Platform.OS === "ios" && requireOptionalNativeModule("ExpoGlassEffect") !== null;

type Props = PropsWithChildren<ViewProps & {
  radius?: number;
  interactive?: boolean;
  /**
   * Floating surfaces such as menus let more of the screen through, where a
   * composer needs to stay readable over a scrolling thread.
   */
  translucent?: boolean;
}>;

export function GlassSurface({
  children,
  radius = 24,
  interactive = false,
  translucent = false,
  style,
  ...props
}: Props) {
  const theme = useAppTheme();
  const supportsNativeGlass = hasNativeGlassModule && isGlassEffectAPIAvailable();
  const dark = theme.mode === "dark";
  const chrome: ViewStyle = {
    borderRadius: radius,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: dark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.07)",
  };

  if (supportsNativeGlass) {
    // No fill: the whole point of the glass layer is that the content behind it
    // shows through. Painting a background here — as this did — turned every
    // glass surface into a flat panel.
    return (
      <GlassView
        {...props}
        glassEffectStyle="regular"
        isInteractive={interactive}
        tintColor={translucent
          ? (dark ? "#1E1E2033" : "#FAFAFC38")
          : (dark ? "#181818B8" : "#FFFFFFA8")}
        colorScheme={theme.mode}
        style={[chrome, style]}
      >
        {children}
      </GlassView>
    );
  }

  const fallbackBackground = translucent
    ? dark ? "rgba(30,30,32,0.88)" : "rgba(250,250,252,0.9)"
    : dark ? "rgba(24,24,24,0.94)" : "rgba(255,255,255,0.94)";

  return (
    <View {...props} style={[chrome, { backgroundColor: fallbackBackground }, style]}>
      {children}
    </View>
  );
}
