import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { useMemo } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { darkTheme, lightTheme, type AppTheme } from "./theme";

const taskSteps = [
  { label: "Inspect", detail: "Repository mapped", state: "complete" },
  { label: "Implement", detail: "Agent editing 3 files", state: "active" },
  { label: "Validate", detail: "Waiting for checks", state: "pending" },
] as const;

const recentTasks = [
  { repository: "orbit/web", title: "Refresh expired auth sessions", status: "PR #184" },
  { repository: "orbit/api", title: "Fix timezone test in CI", status: "Merged" },
] as const;

function BrandMark({ theme }: { theme: AppTheme }) {
  return (
    <View style={[styles.brandTile, { backgroundColor: theme.accent }]}>
      <View style={styles.branchMark}>
        <View style={[styles.branchStem, { backgroundColor: theme.accentInk }]} />
        <View style={[styles.branchArm, { backgroundColor: theme.accentInk }]} />
        <View style={[styles.branchDot, styles.branchDotTop, { backgroundColor: theme.accentInk }]} />
        <View style={[styles.branchDot, styles.branchDotBottom, { backgroundColor: theme.accentInk }]} />
      </View>
    </View>
  );
}

function Kicker({ children, color }: { children: string; color: string }) {
  return (
    <Text style={[styles.kicker, { color }]}>
      <Text style={styles.kickerBracket}>[ </Text>
      {children}
      <Text style={styles.kickerBracket}> ]</Text>
    </Text>
  );
}

function Ruler({ color }: { color: string }) {
  return (
    <View accessible={false} style={styles.ruler}>
      {Array.from({ length: 36 }, (_, index) => (
        <View
          key={index}
          style={[
            styles.rulerTick,
            { backgroundColor: color, height: index % 6 === 0 ? 8 : 4 },
          ]}
        />
      ))}
    </View>
  );
}

function ProgressRail({ theme }: { theme: AppTheme }) {
  return (
    <View style={styles.progressList}>
      {taskSteps.map((step, index) => {
        const isComplete = step.state === "complete";
        const isActive = step.state === "active";
        const dotColor = isComplete
          ? theme.success
          : isActive
            ? theme.accent
            : theme.darkMuted;

        return (
          <View key={step.label} style={styles.progressRow}>
            <View style={styles.progressRail}>
              <View
                style={[
                  styles.progressDot,
                  {
                    backgroundColor: dotColor,
                    borderColor: isActive ? theme.accent : dotColor,
                  },
                  isActive && styles.progressDotActive,
                ]}
              />
              {index < taskSteps.length - 1 ? (
                <View style={[styles.progressLine, { backgroundColor: theme.darkLine }]} />
              ) : null}
            </View>
            <View style={styles.progressCopy}>
              <Text style={[styles.progressLabel, { color: theme.darkInk }]}>{step.label}</Text>
              <Text style={[styles.progressDetail, { color: theme.darkMuted }]}>{step.detail}</Text>
            </View>
            {isActive ? (
              <View style={[styles.livePill, { borderColor: theme.accent }]}>
                <Text style={[styles.livePillText, { color: theme.accent }]}>LIVE</Text>
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function HomeScreen() {
  const colorScheme = useColorScheme();
  const theme = colorScheme === "dark" ? darkTheme : lightTheme;
  const stylesWithTheme = useMemo(
    () => ({
      screen: { backgroundColor: theme.screen },
      header: { borderBottomColor: theme.line },
      bodyFrame: { borderColor: theme.line },
      card: { backgroundColor: theme.surface, borderColor: theme.line },
    }),
    [theme],
  );

  return (
    <SafeAreaView edges={["top", "left", "right"]} style={[styles.safeArea, stylesWithTheme.screen]}>
      <StatusBar
        backgroundColor={theme.screen}
        barStyle={theme.mode === "dark" ? "light-content" : "dark-content"}
      />
      <View style={[styles.header, stylesWithTheme.header]}>
        <View style={styles.wordmark}>
          <BrandMark theme={theme} />
          <Text style={[styles.wordmarkText, { color: theme.ink }]}>AutoPR</Text>
        </View>
        <View style={[styles.connectionPill, { borderColor: theme.line, backgroundColor: theme.surface }]}>
          <View style={[styles.connectionDot, { backgroundColor: theme.success }]} />
          <Text style={[styles.connectionText, { color: theme.muted }]}>READY</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.bodyFrame, stylesWithTheme.bodyFrame]}>
          <Ruler color={theme.line} />
          <View style={styles.hero}>
            <Kicker color={theme.muted}>MOBILE WORKSPACE</Kicker>
            <Text style={[styles.heroTitle, { color: theme.ink }]}>Turn tasks into{`\n`}pull requests.</Text>
            <Text style={[styles.heroCopy, { color: theme.muted }]}>
              Keep an eye on your agents, review their progress, and ship from wherever you are.
            </Text>
            <Pressable
              accessibilityHint="Shows the next step for connecting this starter app"
              accessibilityRole="button"
              onPress={() =>
                Alert.alert(
                  "Mobile shell ready",
                  "Connect authentication and your Convex backend when you are ready to make tasks live.",
                )
              }
              style={({ pressed }) => [
                styles.primaryButton,
                { backgroundColor: theme.accent, opacity: pressed ? 0.82 : 1 },
              ]}
            >
              <Text style={[styles.primaryButtonText, { color: theme.accentInk }]}>START A TASK</Text>
              <Text style={[styles.primaryButtonArrow, { color: theme.accentInk }]}>→</Text>
            </Pressable>
          </View>

          <View style={[styles.activeCard, { backgroundColor: theme.darkSurface }]}>
            <View style={styles.activeCardTopline}>
              <Kicker color={theme.darkMuted}>ACTIVE TASK</Kicker>
              <Text style={[styles.taskNumber, { color: theme.darkMuted }]}>TASK / 014</Text>
            </View>
            <Text style={[styles.activeTaskTitle, { color: theme.accentSecondary }]}>
              Add rate limiting to the upload endpoint
            </Text>
            <Text style={[styles.repositoryLabel, { color: theme.darkMuted }]}>orbit/api · autopr/rate-limit-upload</Text>
            <View style={[styles.cardDivider, { backgroundColor: theme.darkLine }]} />
            <ProgressRail theme={theme} />
          </View>

          <View style={styles.sectionHeading}>
            <Kicker color={theme.muted}>RECENT WORK</Kicker>
            <Text style={[styles.sectionCount, { color: theme.faint }]}>02</Text>
          </View>
          <View style={[styles.recentCard, stylesWithTheme.card]}>
            {recentTasks.map((task, index) => (
              <View key={task.title}>
                <View style={styles.recentRow}>
                  <View style={styles.recentCopy}>
                    <Text style={[styles.recentRepository, { color: theme.muted }]}>{task.repository}</Text>
                    <Text style={[styles.recentTitle, { color: theme.ink }]}>{task.title}</Text>
                  </View>
                  <View style={[styles.statusPill, { backgroundColor: theme.screenAlt }]}>
                    <Text style={[styles.statusText, { color: theme.ink }]}>{task.status}</Text>
                  </View>
                </View>
                {index < recentTasks.length - 1 ? (
                  <View style={[styles.recentDivider, { backgroundColor: theme.line }]} />
                ) : null}
              </View>
            ))}
          </View>

          <Text style={[styles.footnote, { color: theme.faint }]}>
            YOUR CODEX SUBSCRIPTION · ISOLATED DAYTONA RUNTIME · GITHUB NATIVE
          </Text>
          <Ruler color={theme.line} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function LoadingScreen() {
  const colorScheme = useColorScheme();
  const theme = colorScheme === "dark" ? darkTheme : lightTheme;

  return (
    <SafeAreaView style={[styles.loadingScreen, { backgroundColor: theme.screen }]}>
      <ActivityIndicator color={theme.accentInk} />
    </SafeAreaView>
  );
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  if (!fontsLoaded && !fontError) {
    return (
      <SafeAreaProvider>
        <LoadingScreen />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <HomeScreen />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  loadingScreen: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  header: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    height: 62,
    justifyContent: "space-between",
    paddingHorizontal: 20,
  },
  wordmark: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  brandTile: {
    alignItems: "center",
    borderRadius: 8,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  branchMark: {
    height: 19,
    position: "relative",
    width: 17,
  },
  branchStem: {
    borderRadius: 1,
    height: 15,
    left: 4,
    position: "absolute",
    top: 2,
    width: 2,
  },
  branchArm: {
    borderRadius: 1,
    height: 2,
    left: 5,
    position: "absolute",
    top: 5,
    transform: [{ rotate: "-28deg" }],
    width: 9,
  },
  branchDot: {
    borderRadius: 3,
    height: 6,
    position: "absolute",
    width: 6,
  },
  branchDotTop: {
    right: 0,
    top: 0,
  },
  branchDotBottom: {
    bottom: 0,
    left: 2,
  },
  wordmarkText: {
    fontFamily: "Inter_700Bold",
    fontSize: 18,
    letterSpacing: -0.5,
  },
  connectionPill: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  connectionDot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  connectionText: {
    fontFamily: "monospace",
    fontSize: 9,
    letterSpacing: 1.2,
  },
  scrollContent: {
    paddingBottom: 28,
  },
  bodyFrame: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    marginHorizontal: 12,
    paddingHorizontal: 18,
  },
  ruler: {
    alignItems: "flex-start",
    flexDirection: "row",
    height: 9,
    justifyContent: "space-between",
    overflow: "hidden",
  },
  rulerTick: {
    width: StyleSheet.hairlineWidth,
  },
  hero: {
    paddingBottom: 36,
    paddingTop: 42,
  },
  kicker: {
    fontFamily: "monospace",
    fontSize: 10,
    letterSpacing: 1.75,
  },
  kickerBracket: {
    opacity: 0.65,
  },
  heroTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 43,
    letterSpacing: -2.15,
    lineHeight: 43,
    marginTop: 17,
  },
  heroCopy: {
    fontFamily: "Inter_400Regular",
    fontSize: 16,
    lineHeight: 23,
    marginTop: 18,
    maxWidth: 340,
  },
  primaryButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 6,
    flexDirection: "row",
    gap: 24,
    marginTop: 26,
    minHeight: 48,
    paddingHorizontal: 18,
  },
  primaryButtonText: {
    fontFamily: "monospace",
    fontSize: 11,
    fontWeight: "500",
    letterSpacing: 1.3,
  },
  primaryButtonArrow: {
    fontFamily: "Inter_500Medium",
    fontSize: 20,
    lineHeight: 20,
  },
  activeCard: {
    borderRadius: 8,
    padding: 20,
  },
  activeCardTopline: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  taskNumber: {
    fontFamily: "monospace",
    fontSize: 9,
    letterSpacing: 1,
  },
  activeTaskTitle: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 25,
    letterSpacing: -0.8,
    lineHeight: 30,
    marginTop: 23,
  },
  repositoryLabel: {
    fontFamily: "monospace",
    fontSize: 10,
    lineHeight: 15,
    marginTop: 10,
  },
  cardDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 21,
  },
  progressList: {
    gap: 0,
  },
  progressRow: {
    flexDirection: "row",
    minHeight: 55,
  },
  progressRail: {
    alignItems: "center",
    marginRight: 12,
    width: 14,
  },
  progressDot: {
    borderRadius: 5,
    borderWidth: 1,
    height: 9,
    marginTop: 3,
    width: 9,
  },
  progressDotActive: {
    borderWidth: 3,
    height: 13,
    marginTop: 1,
    width: 13,
  },
  progressLine: {
    flex: 1,
    marginTop: 4,
    width: StyleSheet.hairlineWidth,
  },
  progressCopy: {
    flex: 1,
  },
  progressLabel: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
  },
  progressDetail: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    marginTop: 4,
  },
  livePill: {
    alignSelf: "flex-start",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  livePillText: {
    fontFamily: "monospace",
    fontSize: 8,
    letterSpacing: 1,
  },
  sectionHeading: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
    marginTop: 36,
  },
  sectionCount: {
    fontFamily: "monospace",
    fontSize: 10,
  },
  recentCard: {
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
    paddingHorizontal: 16,
  },
  recentRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    minHeight: 82,
    paddingVertical: 14,
  },
  recentCopy: {
    flex: 1,
  },
  recentRepository: {
    fontFamily: "monospace",
    fontSize: 9,
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  recentTitle: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    lineHeight: 19,
    marginTop: 6,
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  statusText: {
    fontFamily: "monospace",
    fontSize: 9,
  },
  recentDivider: {
    height: StyleSheet.hairlineWidth,
  },
  footnote: {
    fontFamily: "monospace",
    fontSize: 9,
    letterSpacing: 0.9,
    lineHeight: 15,
    paddingHorizontal: 8,
    paddingVertical: 28,
    textAlign: "center",
  },
});
