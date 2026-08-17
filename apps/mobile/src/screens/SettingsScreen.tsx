import { api } from "@autopr/backend/convex/_generated/api";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Image } from "expo-image";
import * as WebBrowser from "expo-web-browser";
import { useMutation, useQuery } from "convex/react";
import { ChevronRight, FlaskConical, FolderGit2, LogOut, MoonStar, ReceiptText, Smartphone, Sun, Unplug, UserRound } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { webRequest } from "../api/web";
import { useAuth } from "../auth/AuthProvider";
import { GitHubIcon } from "../components/GitHubIcon";
import { OpenAIIcon } from "../components/OpenAIIcon";
import { SheetSectionTitle } from "../components/SheetList";
import { ErrorNotice, StatusPill } from "../components/ui";
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

/** Keeps the page short enough that sign out stays within easy reach. */
const BILLING_ROW_LIMIT = 5;

function costFor(row: {
  finalTotalPrice?: number;
  latestTotalPrice?: number;
}) {
  return row.finalTotalPrice ?? row.latestTotalPrice ?? 0;
}

export function SettingsScreen({ navigation }: Props) {
  const theme = useAppTheme();
  const insets = useSafeAreaInsets();
  const { preference, setPreference } = useAppThemePreference();
  const { session, signOut } = useAuth();
  const [failedProfilePictureUrl, setFailedProfilePictureUrl] = useState<string | null>(null);
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
    { invalidateQueryKeys: [["codex", "status"]] },
  );

  const openWebFlow = async (returnTo: string) => {
    await WebBrowser.openBrowserAsync(
      `${mobileConfig.webUrl}/api/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`,
    );
    await codex.refetch();
  };

  const fullName = [session?.user.firstName, session?.user.lastName].filter(Boolean).join(" ");
  const profilePictureUrl = session?.user.profilePictureUrl;
  const showProfilePicture = Boolean(
    profilePictureUrl && failedProfilePictureUrl !== profilePictureUrl,
  );
  const totalSpend = (costs ?? []).reduce((sum, row) => sum + costFor(row), 0);
  const readyProjects = (projects ?? []).filter((project) => project.sandboxStatus === "ready").length;
  const runningProjects = (projects ?? []).filter((project) => project.sandboxRuntimeStatus === "started").length;

  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { backgroundColor: theme.screen, paddingBottom: Math.max(insets.bottom, 12) + 28 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.profile, { backgroundColor: theme.surface, borderColor: theme.line }]}>
        <View style={[styles.avatar, { backgroundColor: theme.accentSoft }]}>
          {profilePictureUrl && showProfilePicture ? (
            <Image
              accessibilityLabel={fullName || session?.user.email || "User profile"}
              contentFit="cover"
              onError={() => setFailedProfilePictureUrl(profilePictureUrl)}
              source={{ uri: profilePictureUrl }}
              style={styles.avatarImage}
              transition={150}
            />
          ) : (
            <UserRound color={theme.accentOn} size={23} />
          )}
        </View>
        <View style={styles.profileCopy}>
          <Text style={[styles.profileName, { color: theme.ink }]}>{fullName || "AutoPR user"}</Text>
          <Text numberOfLines={1} style={[styles.profileEmail, { color: theme.muted }]}>{session?.user.email}</Text>
        </View>
      </View>

      <SheetSectionTitle>Connections</SheetSectionTitle>
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
            <OpenAIIcon size={19} />
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
            <GitHubIcon size={19} />
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

      <SheetSectionTitle>Overview</SheetSectionTitle>
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

      <SheetSectionTitle>Billing</SheetSectionTitle>
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
        ) : (
          <>
            {costs.slice(0, BILLING_ROW_LIMIT).map((row, index) => (
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
            {costs.length > BILLING_ROW_LIMIT ? (
              <View style={[styles.billingRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line }]}>
                <Text style={[styles.rowBody, { color: theme.muted, marginTop: 0 }]}>
                  +{costs.length - BILLING_ROW_LIMIT} earlier sandbox
                  {costs.length - BILLING_ROW_LIMIT === 1 ? "" : "es"} · ${totalSpend.toFixed(2)} total
                </Text>
              </View>
            ) : null}
          </>
        )}
      </View>

      <SheetSectionTitle>Appearance</SheetSectionTitle>
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

      <SheetSectionTitle>Experiments</SheetSectionTitle>
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
  content: { flexGrow: 1, paddingHorizontal: 16, paddingTop: 14, gap: 10 },
  profile: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 22, padding: 14, flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 6 },
  avatar: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  avatarImage: { width: "100%", height: "100%" },
  profileCopy: { flex: 1, minWidth: 0 },
  profileName: { fontFamily: "DMSans_700Bold", fontSize: 17, letterSpacing: -0.3 },
  profileEmail: { fontFamily: "DMSans_400Regular", fontSize: 13, marginTop: 3 },
  group: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 22, overflow: "hidden", marginBottom: 6 },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 },
  stat: { width: "48%", flexGrow: 1, minHeight: 74, borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, padding: 13, justifyContent: "space-between" },
  statLabel: { fontFamily: "DMSans_700Bold", fontSize: 10, letterSpacing: 0.9, textTransform: "uppercase" },
  statValue: { fontFamily: "DMSans_700Bold", fontSize: 20 },
  row: { minHeight: 62, paddingHorizontal: 14, paddingVertical: 11, flexDirection: "row", alignItems: "center", gap: 12 },
  rowIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  rowCopy: { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: "DMSans_700Bold", fontSize: 16, letterSpacing: -0.3 },
  rowBody: { fontFamily: "DMSans_400Regular", fontSize: 13, marginTop: 2 },
  billingRow: { minHeight: 54, paddingHorizontal: 14, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  billingValue: { fontFamily: "DMSans_500Medium", fontSize: 13, fontVariant: ["tabular-nums"] },
  appearanceGroup: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 22, padding: 14, gap: 13, marginBottom: 6 },
  appearanceHeading: { flexDirection: "row", alignItems: "center", gap: 12 },
  themePicker: { borderRadius: 16, padding: 3, flexDirection: "row", gap: 3 },
  themeOption: {
    flex: 1,
    minHeight: 36,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "transparent",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  themeOptionText: { fontFamily: "DMSans_500Medium", fontSize: 13 },
  signOut: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, marginTop: 8 },
  signOutText: { fontFamily: "DMSans_700Bold", fontSize: 15 },
});
