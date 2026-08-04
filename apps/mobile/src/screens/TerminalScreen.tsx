import { api } from "@autopr/backend/convex/_generated/api";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAction } from "convex/react";
import { RefreshCw } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { WebView } from "react-native-webview";

import { useAppTheme } from "../hooks/useAppTheme";
import type { RootStackParamList } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "Terminal">;

export function TerminalScreen({ route }: Props) {
  const { projectId, title } = route.params;
  const theme = useAppTheme();
  const getTerminalPreview = useAction(api.projectActions.getTerminalPreview);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [connectionAttempt, setConnectionAttempt] = useState(0);

  const reconnect = useCallback(() => {
    setPreviewUrl(undefined);
    setLoading(true);
    setError(undefined);
    setConnectionAttempt((attempt) => attempt + 1);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);

    void getTerminalPreview({ projectId })
      .then((preview) => {
        if (!active) return;
        setPreviewUrl(preview.url);
      })
      .catch((cause) => {
        if (!active) return;
        setLoading(false);
        setError(cause instanceof Error ? cause.message : "Could not open the terminal.");
      });

    return () => {
      active = false;
    };
  }, [connectionAttempt, getTerminalPreview, projectId]);

  return (
    <View style={[styles.screen, { backgroundColor: theme.code }]}>
      <View style={[styles.sessionBar, { borderBottomColor: theme.codeLine }]}>
        <Text numberOfLines={1} style={[styles.sessionTitle, { color: theme.codeInk }]}>
          {title || "Workspace shell"}
        </Text>
        {loading ? <ActivityIndicator color={theme.accentOn} size="small" /> : null}
        <Pressable
          accessibilityLabel="Reconnect terminal"
          accessibilityRole="button"
          onPress={reconnect}
          style={({ pressed }) => [styles.refreshButton, { opacity: pressed ? 0.55 : 1 }]}
        >
          <RefreshCw color={theme.codeMuted} size={17} />
        </Pressable>
      </View>

      {error ? (
        <View
          accessibilityRole="alert"
          style={[styles.errorBar, { backgroundColor: theme.dangerSoft, borderBottomColor: theme.danger }]}
        >
          <Text numberOfLines={2} style={[styles.errorText, { color: theme.danger }]}>
            {error}
          </Text>
          <Pressable accessibilityRole="button" onPress={reconnect}>
            <Text style={[styles.reconnectText, { color: theme.danger }]}>Reconnect</Text>
          </Pressable>
        </View>
      ) : null}

      {previewUrl ? (
        <WebView
          cacheEnabled={false}
          incognito
          key={`${connectionAttempt}:${previewUrl}`}
          onError={() => {
            setLoading(false);
            setError("Terminal connection failed.");
          }}
          onLoadEnd={() => setLoading(false)}
          sharedCookiesEnabled={false}
          source={{ uri: previewUrl }}
          style={styles.webview}
          thirdPartyCookiesEnabled={false}
        />
      ) : (
        <View style={styles.loadingSurface}>
          {loading ? <Text style={[styles.loadingText, { color: theme.codeMuted }]}>Opening secure terminal…</Text> : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  sessionBar: {
    minHeight: 52,
    borderBottomWidth: 1,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sessionTitle: { minWidth: 0, flex: 1, fontFamily: "DMSans_500Medium", fontSize: 14 },
  refreshButton: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  errorBar: {
    minHeight: 43,
    borderBottomWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  errorText: { flex: 1, fontFamily: "DMSans_500Medium", fontSize: 10, lineHeight: 14 },
  reconnectText: { fontFamily: "DMSans_700Bold", fontSize: 10 },
  loadingSurface: { flex: 1, alignItems: "center", justifyContent: "center" },
  loadingText: { fontFamily: "DMSans_500Medium", fontSize: 12 },
  webview: { flex: 1, backgroundColor: "transparent" },
});
