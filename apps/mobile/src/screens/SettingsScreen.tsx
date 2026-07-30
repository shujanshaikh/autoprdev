import { api } from "@autopr/backend/convex/_generated/api";
import * as WebBrowser from "expo-web-browser";
import { useMutation, useQuery } from "convex/react";
import {
  Bot,
  ChevronRight,
  FlaskConical,
  GitFork,
  LogOut,
  MoonStar,
  ReceiptText,
  UserRound,
} from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";

import { useAuth } from "../auth/AuthProvider";
import { ErrorNotice, SectionLabel, StatusPill } from "../components/ui";
import { mobileConfig } from "../config";
import { useAppTheme } from "../hooks/useAppTheme";
import { useWebQuery } from "../hooks/useWebQuery";

type CodexStatus = {
  connected: boolean;
  email?: string;
  plan?: string;
  models?: string[];
};

export function SettingsScreen() {
  const theme = useAppTheme();
  const { session, signOut } = useAuth();
  const userSettings = useQuery(api.userSettings.get, {});
  const costs = useQuery(api.sandboxCosts.summaryForCurrentUser, {});
  const setLabs = useMutation(api.userSettings.setDemoRecordingExperimentEnabled);
  const codex = useWebQuery<CodexStatus>(["codex", "status"], "/api/codex/status", {
    retry: false,
  });

  const openWebFlow = async (returnTo: string) => {
    await WebBrowser.openBrowserAsync(
      `${mobileConfig.webUrl}/api/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`,
    );
    await codex.refetch();
  };

  const fullName = [session?.user.firstName, session?.user.lastName].filter(Boolean).join(" ");

  return (
    <ScrollView contentContainerStyle={[styles.content, { backgroundColor: theme.screen }]}>
      <View style={[styles.profile, { backgroundColor: theme.surface, borderColor: theme.line }]}>
        <View style={[styles.avatar, { backgroundColor: theme.accentSoft }]}>
          <UserRound color={theme.accent} size={23} />
        </View>
        <View style={styles.profileCopy}>
          <Text style={[styles.profileName, { color: theme.ink }]}>{fullName || "AutoPR user"}</Text>
          <Text numberOfLines={1} style={[styles.profileEmail, { color: theme.muted }]}>{session?.user.email}</Text>
        </View>
      </View>

      <SectionLabel>Connections</SectionLabel>
      <View style={[styles.group, { backgroundColor: theme.surface, borderColor: theme.line }]}>
        <Pressable
          onPress={() => void openWebFlow("/api/chatgpt/login")}
          style={({ pressed }) => [styles.row, { backgroundColor: pressed ? theme.surfaceSoft : theme.surface }]}
        >
          <View style={[styles.rowIcon, { backgroundColor: theme.surfaceSoft }]}>
            <Bot color={theme.ink} size={18} />
          </View>
          <View style={styles.rowCopy}>
            <Text style={[styles.rowTitle, { color: theme.ink }]}>Codex</Text>
            <Text numberOfLines={1} style={[styles.rowBody, { color: theme.muted }]}>
              {codex.data?.connected ? codex.data.email ?? "Connected" : "Connect your ChatGPT subscription"}
            </Text>
          </View>
          <StatusPill label={codex.data?.connected ? "Connected" : "Connect"} tone={codex.data?.connected ? "success" : "warning"} />
          <ChevronRight color={theme.faint} size={17} />
        </Pressable>
        <Pressable
          onPress={() => void openWebFlow("/github-connect")}
          style={({ pressed }) => [
            styles.row,
            { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line },
            { backgroundColor: pressed ? theme.surfaceSoft : theme.surface },
          ]}
        >
          <View style={[styles.rowIcon, { backgroundColor: theme.surfaceSoft }]}>
            <GitFork color={theme.ink} size={18} />
          </View>
          <View style={styles.rowCopy}>
            <Text style={[styles.rowTitle, { color: theme.ink }]}>GitHub</Text>
            <Text style={[styles.rowBody, { color: theme.muted }]}>Repositories and pull requests</Text>
          </View>
          <ChevronRight color={theme.faint} size={17} />
        </Pressable>
      </View>
      {codex.error ? <ErrorNotice message={codex.error.message} /> : null}

      <SectionLabel>Usage</SectionLabel>
      <View style={[styles.group, { backgroundColor: theme.surface, borderColor: theme.line }]}>
        <View style={styles.row}>
          <View style={[styles.rowIcon, { backgroundColor: theme.surfaceSoft }]}>
            <ReceiptText color={theme.ink} size={18} />
          </View>
          <View style={styles.rowCopy}>
            <Text style={[styles.rowTitle, { color: theme.ink }]}>Sandbox usage</Text>
            <Text style={[styles.rowBody, { color: theme.muted }]}>
              {costs
                ? `$${costs.totalKnownCost.toFixed(2)} known · ${costs.pendingCount} pending`
                : "Loading usage…"}
            </Text>
          </View>
        </View>
      </View>

      <SectionLabel>Experiments</SectionLabel>
      <View style={[styles.group, { backgroundColor: theme.surface, borderColor: theme.line }]}>
        <View style={styles.row}>
          <View style={[styles.rowIcon, { backgroundColor: theme.surfaceSoft }]}>
            <FlaskConical color={theme.ink} size={18} />
          </View>
          <View style={styles.rowCopy}>
            <Text style={[styles.rowTitle, { color: theme.ink }]}>Demo recordings</Text>
            <Text style={[styles.rowBody, { color: theme.muted }]}>Allow tasks to capture a shareable walkthrough</Text>
          </View>
          <Switch
            value={Boolean(userSettings?.demoRecordingExperimentEnabled)}
            onValueChange={(value) => void setLabs({ enabled: value })}
            trackColor={{ false: theme.strongLine, true: theme.accent }}
          />
        </View>
        <View style={[styles.row, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line }]}>
          <View style={[styles.rowIcon, { backgroundColor: theme.surfaceSoft }]}>
            <MoonStar color={theme.ink} size={18} />
          </View>
          <View style={styles.rowCopy}>
            <Text style={[styles.rowTitle, { color: theme.ink }]}>Appearance</Text>
            <Text style={[styles.rowBody, { color: theme.muted }]}>Follows your device setting</Text>
          </View>
        </View>
      </View>

      <Pressable
        onPress={() => void signOut()}
        style={({ pressed }) => [
          styles.signOut,
          { backgroundColor: pressed ? theme.dangerSoft : theme.surface, borderColor: theme.line },
        ]}
      >
        <LogOut color={theme.danger} size={18} />
        <Text style={[styles.signOutText, { color: theme.danger }]}>Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, padding: 16, paddingBottom: 36, gap: 12 },
  profile: { borderWidth: 1, borderRadius: 17, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  avatar: { width: 48, height: 48, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  profileCopy: { flex: 1, minWidth: 0 },
  profileName: { fontFamily: "Inter_700Bold", fontSize: 15 },
  profileEmail: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 5 },
  group: { borderWidth: 1, borderRadius: 17, overflow: "hidden", marginBottom: 10 },
  row: { minHeight: 68, padding: 12, flexDirection: "row", alignItems: "center", gap: 11 },
  rowIcon: { width: 38, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  rowBody: { fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 5 },
  signOut: { borderRadius: 15, borderWidth: 1, minHeight: 50, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, marginTop: 6 },
  signOutText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
});
