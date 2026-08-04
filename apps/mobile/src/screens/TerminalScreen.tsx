import { api } from "@autopr/backend/convex/_generated/api";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useAction } from "convex/react";
import { ExternalLink, RefreshCw } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TurboModuleRegistry,
  View,
} from "react-native";

import { useAppTheme } from "../hooks/useAppTheme";
import type { RootStackParamList } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "Terminal">;

// JavaScript dependencies can update independently from an installed native
// development client. Avoid evaluating react-native-webview when that binary
// does not contain its TurboModule; a future rebuilt client will use the
// embedded view automatically.
type WebViewComponent = typeof import("react-native-webview")["WebView"];

const WebView = TurboModuleRegistry.get("RNCWebViewModule")
  ? (require("react-native-webview").WebView as WebViewComponent)
  : undefined;

export function TerminalScreen({ route }: Props) {
  const { projectId, title } = route.params;
  const theme = useAppTheme();
  const getTerminalPreview = useAction(api.projectActions.getTerminalPreview);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [openingBrowser, setOpeningBrowser] = useState(false);

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
        if (!WebView) setLoading(false);
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

  const openTerminalInBrowser = useCallback(async () => {
    if (!previewUrl || openingBrowser) return;

    setOpeningBrowser(true);
    setError(undefined);
    try {
      await Linking.openURL(previewUrl);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not open the terminal in your browser.",
      );
    } finally {
      setOpeningBrowser(false);
    }
  }, [openingBrowser, previewUrl]);

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

      {previewUrl && WebView ? (
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
      ) : previewUrl ? (
        <View style={styles.browserSurface}>
          <Text style={[styles.browserTitle, { color: theme.codeInk }]}>Terminal ready</Text>
          <Text
            style={[styles.browserDescription, { color: theme.codeMuted }]}
          >
            This development client does not include the embedded browser module. Open the secure
            terminal in your device browser instead.
          </Text>
          <Pressable
            accessibilityLabel="Open terminal in browser"
            accessibilityRole="button"
            accessibilityState={{ disabled: openingBrowser }}
            disabled={openingBrowser}
            onPress={() => void openTerminalInBrowser()}
            style={({ pressed }) => [
              styles.browserButton,
              {
                backgroundColor: theme.accent,
                opacity: pressed || openingBrowser ? 0.65 : 1,
              },
            ]}
          >
            {openingBrowser ? (
              <ActivityIndicator color={theme.accentOn} size="small" />
            ) : (
              <ExternalLink color={theme.accentOn} size={16} />
            )}
            <Text
              style={[styles.browserButtonText, { color: theme.accentOn }]}
            >
              {openingBrowser ? "Opening…" : "Open terminal"}
            </Text>
          </Pressable>
        </View>
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
  browserSurface: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 10,
  },
  browserTitle: { fontFamily: "DMSans_700Bold", fontSize: 18 },
  browserDescription: {
    maxWidth: 360,
    textAlign: "center",
    fontFamily: "DMSans_400Regular",
    fontSize: 13,
    lineHeight: 19,
  },
  browserButton: {
    minHeight: 44,
    marginTop: 8,
    paddingHorizontal: 18,
    borderRadius: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  browserButtonText: { fontFamily: "DMSans_700Bold", fontSize: 13 },
  webview: { flex: 1, backgroundColor: "transparent" },
});
