import { api } from "@autopr/backend/convex/_generated/api";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as WebBrowser from "expo-web-browser";
import { useMutation, useQuery } from "convex/react";
import {
  Bot,
  ChevronRight,
  FlaskConical,
  FolderGit2,
  GitFork,
  LogOut,
  MoonStar,
  ReceiptText,
  Smartphone,
  Sun,
  Unplug,
  UserRound,
} from "lucide-react-native";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";

import { webRequest } from "../api/web";
import { useAuth } from "../auth/AuthProvider";
import { ErrorNotice, SectionLabel, StatusPill } from "../components/ui";
import { mobileConfig } from "../config";
import { useAppTheme, useAppThemePreference } from "../hooks/useAppTheme";
import { useWebMutation, useWebQuery } from "../hooks/useWebQuery";
import type { ThemePreference } from "../theme";
import type { RootStackParamList } from "../types";

type CodexStatus = {
  connected: boolean;
  email?: string;
  plan?: string;
  models?: string[];
};

type Props = NativeStackScreenProps<RootStackParamList, "Settings">;

function costFor(row: {
  finalTotalPrice?: number;
  latestTotalPrice?: number;
}) {
  return row.finalTotalPrice ?? row.latestTotalPrice ?? 0;
}

export function SettingsScreen({ navigation }: Props) {
  const theme = useAppTheme();
  const { preference, setPreference } = useAppThemePreference();
  const { session, signOut } = useAuth();
  const userSettings = useQuery(api.userSettings.get, {});
  const projects = useQuery(api.projects.list, {});
  const costs = useQuery(api.sandboxCosts.listForCurrentUser, {});
  const setLabs = useMutation(api.userSettings.setDemoRecordingExperimentEnabled);
  const codex = useWebQuery<CodexStatus>(["codex", "status"], "/api/codex/status", {
    retry: false,
  });
  const disconnectCodex = useWebMutation(
    async (_: void, token) => await webRequest<{ connected: boolean }>(
      "/api/codex/disconnect",
      token,
      { method: "POST" },
    ),
    { onSuccess: () => void codex.refetch() },
  );

  const openWebFlow = async (returnTo: string) => {
    await WebBrowser.openBrowserAsync(
      `${mobileConfig.webUrl}/api/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`,
    );
    await codex.refetch();
  };

  const fullName = [session?.user.firstName, session?.user.lastName].filter(Boolean).join(" ");
  const totalSpend = (costs ?? []).reduce((sum, row) => sum + costFor(row), 0);
  const readyProjects = (projects ?? []).filter((project) => project.sandboxStatus === "ready").length;
  const runningProjects = (projects ?? []).filter((project) => project.sandboxRuntimeStatus === "started").length;

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
          onPress={() => {
            if (!codex.data?.connected) {
              void openWebFlow("/api/chatgpt/login");
              return;
            }
            Alert.alert(
              "Codex is connected",
              codex.data.email ?? "Your ChatGPT subscription is available to AutoPR.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Disconnect",
                  style: "destructive",
                  onPress: () => disconnectCodex.mutate(),
                },
              ],
            );
          }}
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
          {codex.data?.connected
            ? <Unplug color={theme.faint} size={16} />
            : <ChevronRight color={theme.faint} size={17} />}
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
      {disconnectCodex.error ? <ErrorNotice message={disconnectCodex.error.message} /> : null}

      <SectionLabel>Overview</SectionLabel>
      <View style={styles.stats}>
        {[
          ["Projects", projects?.length ?? "—"],
          ["Ready", projects ? readyProjects : "—"],
          ["Running", projects ? runningProjects : "—"],
          ["Spend", costs ? `$${totalSpend.toFixed(2)}` : "—"],
        ].map(([label, value]) => (
          <View key={label} style={[styles.stat, { backgroundColor: theme.surface, borderColor: theme.line }]}>
            <Text style={[styles.statLabel, { color: theme.faint }]}>{label}</Text>
            <Text style={[styles.statValue, { color: theme.ink }]}>{value}</Text>
          </View>
        ))}
      </View>

      <View style={[styles.group, { backgroundColor: theme.surface, borderColor: theme.line }]}>
        {projects === undefined ? (
          <View style={styles.row}>
            <Text style={[styles.rowBody, { color: theme.muted }]}>Loading projects…</Text>
          </View>
        ) : projects.slice(0, 8).map((project, index) => (
          <Pressable
            key={project.projectId}
            onPress={() => {
              navigation.replace("Project", { projectId: project.projectId, title: project.repoName });
            }}
            style={({ pressed }) => [
              styles.row,
              index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line },
              { backgroundColor: pressed ? theme.surfaceSoft : theme.surface },
            ]}
          >
            <View style={[styles.rowIcon, { backgroundColor: theme.surfaceSoft }]}>
              <FolderGit2 color={theme.ink} size={18} />
            </View>
            <View style={styles.rowCopy}>
              <Text numberOfLines={1} style={[styles.rowTitle, { color: theme.ink }]}>{project.repoFullName}</Text>
              <Text numberOfLines={1} style={[styles.rowBody, { color: theme.muted }]}>
                {project.currentBranch ?? project.repoBranch ?? project.defaultBranch ?? "branch"}
              </Text>
            </View>
            <StatusPill
              label={project.sandboxRuntimeStatus ?? project.sandboxStatus}
              tone={project.sandboxStatus === "ready" ? "success" : project.sandboxStatus === "failed" ? "danger" : "warning"}
            />
            <ChevronRight color={theme.faint} size={16} />
          </Pressable>
        ))}
      </View>

      <SectionLabel>Billing</SectionLabel>
      <View style={[styles.group, { backgroundColor: theme.surface, borderColor: theme.line }]}>
        {costs === undefined ? (
          <View style={styles.row}>
            <Text style={[styles.rowBody, { color: theme.muted }]}>Loading billing history…</Text>
          </View>
        ) : costs.length === 0 ? (
          <View style={styles.row}>
            <View style={[styles.rowIcon, { backgroundColor: theme.surfaceSoft }]}>
              <ReceiptText color={theme.ink} size={18} />
            </View>
            <View style={styles.rowCopy}>
              <Text style={[styles.rowTitle, { color: theme.ink }]}>No billing history yet</Text>
              <Text style={[styles.rowBody, { color: theme.muted }]}>Costs appear after a sandbox becomes ready.</Text>
            </View>
          </View>
        ) : costs.map((row, index) => (
          <View
            key={row._id}
            style={[
              styles.billingRow,
              index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line },
            ]}
          >
            <View style={styles.rowCopy}>
              <Text numberOfLines={1} style={[styles.rowTitle, { color: theme.ink }]}>
                {row.repoFullName ?? row.sandboxName ?? "Sandbox"}
              </Text>
              <Text style={[styles.rowBody, { color: theme.muted }]}>
                {row.status.replace(/_/g, " ")}
              </Text>
            </View>
            <Text style={[styles.billingValue, { color: theme.ink }]}>${costFor(row).toFixed(4)}</Text>
          </View>
        ))}
      </View>

      <SectionLabel>Appearance</SectionLabel>
      <View style={[styles.appearanceGroup, { backgroundColor: theme.surface, borderColor: theme.line }]}>
        <View style={styles.appearanceHeading}>
          <View style={[styles.rowIcon, { backgroundColor: theme.surfaceSoft }]}>
            <MoonStar color={theme.ink} size={18} />
          </View>
          <View style={styles.rowCopy}>
            <Text style={[styles.rowTitle, { color: theme.ink }]}>Color mode</Text>
            <Text style={[styles.rowBody, { color: theme.muted }]}>
              Uses the same neutral and magenta palette as AutoPR web.
            </Text>
          </View>
        </View>
        <View style={[styles.themePicker, { backgroundColor: theme.surfaceSoft }]}>
          {([
            ["system", "System", Smartphone],
            ["light", "Light", Sun],
            ["dark", "Dark", MoonStar],
          ] as const satisfies ReadonlyArray<readonly [ThemePreference, string, typeof Sun]>).map(
            ([value, label, Icon]) => {
              const selected = preference === value;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  key={value}
                  onPress={() => void setPreference(value)}
                  style={[
                    styles.themeOption,
                    selected && {
                      backgroundColor: theme.surfaceRaised,
                      borderColor: theme.line,
                    },
                  ]}
                >
                  <Icon color={selected ? theme.ink : theme.muted} size={14} />
                  <Text style={[
                    styles.themeOptionText,
                    { color: selected ? theme.ink : theme.muted },
                  ]}>
                    {label}
                  </Text>
                </Pressable>
              );
            },
          )}
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
  profile: { borderWidth: 1, borderRadius: 10, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  avatar: { width: 48, height: 48, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  profileCopy: { flex: 1, minWidth: 0 },
  profileName: { fontFamily: "Inter_700Bold", fontSize: 15 },
  profileEmail: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 5 },
  group: { borderWidth: 1, borderRadius: 10, overflow: "hidden", marginBottom: 10 },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 },
  stat: { width: "48%", flexGrow: 1, minHeight: 72, borderWidth: 1, borderRadius: 10, padding: 11, justifyContent: "space-between" },
  statLabel: { fontFamily: "Inter_700Bold", fontSize: 9, letterSpacing: 0.8, textTransform: "uppercase" },
  statValue: { fontFamily: "Inter_700Bold", fontSize: 20 },
  row: { minHeight: 68, padding: 12, flexDirection: "row", alignItems: "center", gap: 11 },
  rowIcon: { width: 38, height: 38, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  rowBody: { fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 5 },
  billingRow: { minHeight: 58, paddingHorizontal: 12, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  billingValue: { fontFamily: "Inter_600SemiBold", fontSize: 12, fontVariant: ["tabular-nums"] },
  appearanceGroup: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 12, marginBottom: 10 },
  appearanceHeading: { flexDirection: "row", alignItems: "center", gap: 11 },
  themePicker: { borderRadius: 8, padding: 3, flexDirection: "row", gap: 3 },
  themeOption: {
    flex: 1,
    minHeight: 36,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "transparent",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  themeOptionText: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
  signOut: { borderRadius: 10, borderWidth: 1, minHeight: 50, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, marginTop: 6 },
  signOutText: { fontFamily: "Inter_600SemiBold", fontSize: 14 },
});
