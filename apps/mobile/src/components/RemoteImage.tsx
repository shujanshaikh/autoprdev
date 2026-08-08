import { Image, type ImageStyle } from "expo-image";
import { Image as ImageIcon } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, type StyleProp } from "react-native";

import { useAppTheme } from "../hooks/useAppTheme";
import { imageHostLabel, isFirstPartyImageUrl } from "../lib/urls";

type RemoteImageProps = {
  url: string;
  accessibilityLabel: string;
  style?: StyleProp<ImageStyle>;
};

/**
 * Message images are agent-influenceable: rendering a remote URL would fetch
 * it the moment the message appears (tracking, IP leak). First-party origins
 * (R2, the configured web/Convex hosts, embedded data) load immediately;
 * anything else waits behind an explicit tap.
 */
export function RemoteImage({ url, accessibilityLabel, style }: RemoteImageProps) {
  const theme = useAppTheme();
  const [loadRequested, setLoadRequested] = useState(false);

  if (loadRequested || isFirstPartyImageUrl(url)) {
    return <Image accessibilityLabel={accessibilityLabel} source={{ uri: url }} style={style} />;
  }

  const host = imageHostLabel(url);
  const label = host ? `Tap to load image from ${host}` : "Tap to load image";
  return (
    <Pressable
      accessibilityLabel={`${accessibilityLabel}. ${label}`}
      accessibilityRole="button"
      onPress={() => setLoadRequested(true)}
      style={[style, styles.gated, { borderColor: theme.line }]}
    >
      <ImageIcon color={theme.muted} size={18} />
      <Text numberOfLines={2} style={[styles.gatedLabel, { color: theme.muted }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  gated: {
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
    justifyContent: "center",
    padding: 14,
  },
  gatedLabel: {
    fontFamily: "DMSans_500Medium",
    fontSize: 11,
    textAlign: "center",
  },
});
