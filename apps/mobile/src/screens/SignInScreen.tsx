import { GitPullRequest } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "../auth/AuthProvider";
import { ErrorNotice } from "../components/ui";
import { useAppTheme } from "../hooks/useAppTheme";

export function SignInScreen() {
  const theme = useAppTheme();
  const { signIn, authError } = useAuth();
  const [mode, setMode] = useState<"google" | "sign-in" | "sign-up" | null>(null);

  const authenticate = async (nextMode: "google" | "sign-in" | "sign-up") => {
    setMode(nextMode);
    try {
      await signIn(nextMode === "google"
        ? { provider: "google" }
        : { provider: "authkit", screenHint: nextMode });
    } finally {
      setMode(null);
    }
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.screen }]}>
      <View style={styles.content}>
        <View style={styles.brand}>
          <View style={[styles.mark, { backgroundColor: theme.accent }]}>
            <GitPullRequest color={theme.accentInk} size={25} strokeWidth={2.4} />
          </View>
          <Text style={[styles.wordmark, { color: theme.ink }]}>AutoPR</Text>
        </View>
        <Text style={[styles.title, { color: theme.ink }]}>Sign in to AutoPR</Text>
        <Text style={[styles.body, { color: theme.muted }]}>
          Continue to your projects, conversations, and live agent work.
        </Text>

        <View style={styles.actions}>
          {authError ? <ErrorNotice message={authError} /> : null}
          <Pressable
            accessibilityRole="button"
            disabled={mode !== null}
            onPress={() => void authenticate("google")}
            style={({ pressed }) => [
              styles.googleButton,
              {
                backgroundColor: theme.ink,
                opacity: mode !== null ? 0.5 : pressed ? 0.8 : 1,
              },
            ]}
          >
            {mode === "google" ? (
              <ActivityIndicator color={theme.screen} size="small" />
            ) : (
              <>
                <View style={[styles.googleMark, { backgroundColor: theme.surfaceRaised }]}>
                  <Text style={styles.googleLetter}>G</Text>
                </View>
                <Text style={[styles.googleText, { color: theme.screen }]}>Continue with Google</Text>
              </>
            )}
          </Pressable>

          <View style={styles.divider}>
            <View style={[styles.dividerLine, { backgroundColor: theme.line }]} />
            <Text style={[styles.dividerText, { color: theme.faint }]}>OR</Text>
            <View style={[styles.dividerLine, { backgroundColor: theme.line }]} />
          </View>

          <Pressable
            accessibilityRole="button"
            disabled={mode !== null}
            onPress={() => void authenticate("sign-in")}
            style={({ pressed }) => [
              styles.secondaryButton,
              {
                backgroundColor: pressed ? theme.surfaceSoft : theme.surface,
                borderColor: theme.line,
                opacity: mode !== null ? 0.5 : 1,
              },
            ]}
          >
            {mode === "sign-in"
              ? <ActivityIndicator color={theme.ink} size="small" />
              : <Text style={[styles.secondaryText, { color: theme.ink }]}>Continue another way</Text>}
          </Pressable>
        </View>

        <View style={styles.signupRow}>
          <Text style={[styles.signupCopy, { color: theme.muted }]}>New to AutoPR?</Text>
          <Pressable
            accessibilityRole="button"
            disabled={mode !== null}
            onPress={() => void authenticate("sign-up")}
            hitSlop={8}
          >
            <Text style={[styles.signupLink, { color: theme.ink }]}>
              {mode === "sign-up" ? "Opening…" : "Create account"}
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 24 },
  content: { flex: 1, width: "100%", maxWidth: 390, alignSelf: "center", justifyContent: "center", paddingBottom: 22 },
  brand: { alignItems: "center", gap: 12, marginBottom: 40 },
  mark: { width: 54, height: 54, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  wordmark: { fontFamily: "DMSans_700Bold", fontSize: 19, letterSpacing: -0.5 },
  title: { fontFamily: "DMSans_700Bold", fontSize: 27, lineHeight: 33, letterSpacing: -0.9, textAlign: "center" },
  body: { fontFamily: "DMSans_400Regular", fontSize: 14, lineHeight: 21, marginTop: 10, textAlign: "center" },
  actions: { gap: 10, marginTop: 30 },
  googleButton: { minHeight: 52, borderRadius: 12, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 11 },
  googleMark: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  googleLetter: { color: "#4285F4", fontFamily: "DMSans_700Bold", fontSize: 15 },
  googleText: { fontFamily: "DMSans_500Medium", fontSize: 14 },
  divider: { height: 30, flexDirection: "row", alignItems: "center", gap: 12 },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth },
  dividerText: { fontFamily: "DMSans_500Medium", fontSize: 9, letterSpacing: 1 },
  secondaryButton: { minHeight: 50, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  secondaryText: { fontFamily: "DMSans_500Medium", fontSize: 14 },
  signupRow: { marginTop: 25, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 5 },
  signupCopy: { fontFamily: "DMSans_400Regular", fontSize: 13 },
  signupLink: { fontFamily: "DMSans_500Medium", fontSize: 13, textDecorationLine: "underline" },
});
