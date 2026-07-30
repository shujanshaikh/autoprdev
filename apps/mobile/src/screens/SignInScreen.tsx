import { GitPullRequest, ShieldCheck, Sparkles } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "../auth/AuthProvider";
import { ErrorNotice, PrimaryButton, SecondaryButton } from "../components/ui";
import { useAppTheme } from "../hooks/useAppTheme";

export function SignInScreen() {
  const theme = useAppTheme();
  const { signIn, authError } = useAuth();
  const [mode, setMode] = useState<"sign-in" | "sign-up" | null>(null);

  const authenticate = async (nextMode: "sign-in" | "sign-up") => {
    setMode(nextMode);
    try {
      await signIn(nextMode);
    } finally {
      setMode(null);
    }
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.screen }]}>
      <View style={styles.top}>
        <View style={[styles.mark, { backgroundColor: theme.accent }]}>
          <GitPullRequest color={theme.accentInk} size={26} strokeWidth={2.4} />
        </View>
        <Text style={[styles.wordmark, { color: theme.ink }]}>AutoPR</Text>
      </View>

      <View style={styles.hero}>
        <View style={[styles.eyebrow, { backgroundColor: theme.accentSoft }]}>
          <Sparkles color={theme.accent} size={13} />
          <Text style={[styles.eyebrowText, { color: theme.accent }]}>YOUR AGENTS, IN YOUR POCKET</Text>
        </View>
        <Text style={[styles.title, { color: theme.ink }]}>Review the work.{`\n`}Ship the change.</Text>
        <Text style={[styles.body, { color: theme.muted }]}>
          Start coding tasks, follow live progress, inspect every diff, and open pull requests from mobile.
        </Text>
      </View>

      <View style={styles.actions}>
        {authError ? <ErrorNotice message={authError} /> : null}
        <PrimaryButton
          label="Sign in with AuthKit"
          loading={mode === "sign-in"}
          onPress={() => void authenticate("sign-in")}
        />
        <SecondaryButton
          label="Create an account"
          disabled={mode !== null}
          onPress={() => void authenticate("sign-up")}
        />
        <View style={styles.security}>
          <ShieldCheck color={theme.faint} size={14} />
          <Text style={[styles.securityText, { color: theme.faint }]}>
            Tokens stay in your device keychain. Authentication is handled by your AutoPR web backend.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 24, paddingBottom: 18 },
  top: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 12 },
  mark: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  wordmark: { fontFamily: "Inter_700Bold", fontSize: 20, letterSpacing: -0.5 },
  hero: { flex: 1, justifyContent: "center", paddingBottom: 40 },
  eyebrow: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginBottom: 21,
  },
  eyebrowText: { fontFamily: "Inter_700Bold", fontSize: 10, letterSpacing: 0.65 },
  title: { fontFamily: "Inter_700Bold", fontSize: 43, lineHeight: 48, letterSpacing: -1.9 },
  body: { fontFamily: "Inter_400Regular", fontSize: 16, lineHeight: 25, marginTop: 18, maxWidth: 360 },
  actions: { gap: 10 },
  security: { flexDirection: "row", alignItems: "flex-start", gap: 7, paddingHorizontal: 8, marginTop: 4 },
  securityText: { flex: 1, fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 16 },
});
