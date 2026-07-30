import { GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import type { PropsWithChildren } from "react";
import { Platform, View, type ViewProps, type ViewStyle } from "react-native";

import { useAppTheme } from "../hooks/useAppTheme";

type Props = PropsWithChildren<ViewProps & {
  radius?: number;
  interactive?: boolean;
}>;

export function GlassSurface({ children, radius = 24, interactive = false, style, ...props }: Props) {
  const theme = useAppTheme();
  const supportsNativeGlass = Platform.OS === "ios" && isGlassEffectAPIAvailable();
  const chrome: ViewStyle = {
    borderRadius: radius,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.mode === "dark" ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.07)",
    backgroundColor: theme.mode === "dark" ? "rgba(24,24,24,0.94)" : "rgba(255,255,255,0.94)",
    shadowColor: theme.shadow,
    shadowOpacity: theme.mode === "dark" ? 0.3 : 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 7 },
    elevation: 9,
  };

  if (supportsNativeGlass) {
    return (
      <GlassView
        {...props}
        glassEffectStyle="regular"
        isInteractive={interactive}
        tintColor={theme.mode === "dark" ? "#181818B8" : "#FFFFFFA8"}
        colorScheme={theme.mode}
        style={[chrome, style]}
      >
        {children}
      </GlassView>
    );
  }

  return <View {...props} style={[chrome, style]}>{children}</View>;
}
