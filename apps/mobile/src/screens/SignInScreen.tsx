import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "../auth/AuthProvider";
import { ErrorNotice } from "../components/ui";
import { useAppTheme } from "../hooks/useAppTheme";

export function SignInScreen() {
  const theme = useAppTheme();
  const { signIn, authError } = useAuth();
  const [isOpening, setIsOpening] = useState(false);

  const authenticate = async () => {
    setIsOpening(true);
    try {
      await signIn({ provider: "authkit", screenHint: "sign-in" });
    } finally {
      setIsOpening(false);
    }
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.screen }]}>
      <View style={styles.content}>
        <View style={styles.welcome}>
          <Text style={[styles.wordmark, { color: theme.ink }]}>AutoPR</Text>
          <View style={styles.headline}>
            <Text style={[styles.title, { color: theme.ink }]}>Welcome to AutoPR</Text>
            <Text style={[styles.subtitle, { color: theme.muted }]}>
              Build, review, and ship from anywhere.
            </Text>
          </View>
        </View>

        <View style={styles.actions}>
          {authError ? <ErrorNotice message={authError} /> : null}
          <Pressable
            accessibilityLabel="Continue to sign in"
            accessibilityRole="button"
            accessibilityState={{ busy: isOpening, disabled: isOpening }}
            disabled={isOpening}
            onPress={() => void authenticate()}
            style={({ pressed }) => [
              styles.continueButton,
              {
                backgroundColor: theme.ink,
                opacity: isOpening ? 0.55 : pressed ? 0.82 : 1,
              },
            ]}
          >
            {isOpening ? (
              <ActivityIndicator color={theme.screen} size="small" />
            ) : (
              <Text style={[styles.continueText, { color: theme.screen }]}>Continue</Text>
            )}
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 24 },
  content: { flex: 1, width: "100%", maxWidth: 440, alignSelf: "center" },
  welcome: { flex: 1, justifyContent: "center", paddingBottom: 18 },
  wordmark: { fontFamily: "DMSans_500Medium", fontSize: 18, lineHeight: 24, letterSpacing: -0.7 },
  headline: { marginTop: 26, gap: 2 },
  title: { fontFamily: "DMSans_400Regular", fontSize: 32, lineHeight: 40, letterSpacing: -1.25 },
  subtitle: { fontFamily: "DMSans_400Regular", fontSize: 25, lineHeight: 33, letterSpacing: -0.85 },
  actions: { gap: 12, paddingBottom: 18 },
  continueButton: {
    minHeight: 58,
    borderRadius: 999,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  continueText: { fontFamily: "DMSans_500Medium", fontSize: 16, letterSpacing: -0.25 },
});
