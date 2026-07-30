import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  DarkTheme as NavigationDarkTheme,
  DefaultTheme as NavigationLightTheme,
  NavigationContainer,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { GitPullRequest } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Platform, StatusBar, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { configError, mobileConfig } from "./config";
import { useAppTheme } from "./hooks/useAppTheme";
import { AddProjectScreen } from "./screens/AddProjectScreen";
import { BranchesScreen } from "./screens/BranchesScreen";
import { ChangesScreen } from "./screens/ChangesScreen";
import { EnvironmentScreen } from "./screens/EnvironmentScreen";
import { ProjectScreen } from "./screens/ProjectScreen";
import { ProjectsScreen } from "./screens/ProjectsScreen";
import { PullRequestsScreen } from "./screens/PullRequestsScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { SignInScreen } from "./screens/SignInScreen";
import { TerminalScreen } from "./screens/TerminalScreen";
import { ThreadScreen } from "./screens/ThreadScreen";
import { AppThemeProvider } from "./theme/ThemeProvider";
import type { RootStackParamList } from "./types";

const Stack = createNativeStackNavigator<RootStackParamList>();

function ConfigErrorScreen({ message }: { message: string }) {
  const theme = useAppTheme();
  return (
    <View style={[styles.center, { backgroundColor: theme.screen }]}>
      <View style={[styles.configMark, { backgroundColor: theme.dangerSoft }]}>
        <GitPullRequest color={theme.danger} size={27} />
      </View>
      <Text style={[styles.configTitle, { color: theme.ink }]}>Mobile configuration needed</Text>
      <Text style={[styles.configBody, { color: theme.muted }]}>
        {message} Add the values shown in apps/mobile/.env.example, then restart Expo.
      </Text>
    </View>
  );
}

function LoadingScreen() {
  const theme = useAppTheme();
  return (
    <View style={[styles.center, { backgroundColor: theme.screen }]}>
      <ActivityIndicator color={theme.accent} />
    </View>
  );
}

function useConvexAuthBridge() {
  const { session, isLoading, getAccessToken } = useAuth();
  const fetchAccessToken = useCallback(
    async ({ forceRefreshToken }: { forceRefreshToken?: boolean } = {}) =>
      await getAccessToken(Boolean(forceRefreshToken)),
    [getAccessToken],
  );
  return useMemo(() => ({
    isLoading,
    isAuthenticated: Boolean(session),
    fetchAccessToken,
  }), [fetchAccessToken, isLoading, session]);
}

function Navigator() {
  const theme = useAppTheme();
  const { session, isLoading } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (!session) return <SignInScreen />;

  const navigationTheme = theme.mode === "light"
    ? {
        ...NavigationLightTheme,
        colors: {
          ...NavigationLightTheme.colors,
          background: theme.screen,
          card: theme.surface,
          text: theme.ink,
          border: theme.line,
          primary: theme.accent,
        },
      }
    : {
        ...NavigationDarkTheme,
        colors: {
          ...NavigationDarkTheme.colors,
          background: theme.screen,
          card: theme.surface,
          text: theme.ink,
          border: theme.line,
          primary: theme.accent,
        },
      };

  return (
    <NavigationContainer theme={navigationTheme}>
      <Stack.Navigator
        screenOptions={{
          headerBackTitle: "",
          headerShadowVisible: false,
          headerStyle: { backgroundColor: theme.surface },
          headerTintColor: theme.ink,
          headerTitleStyle: {
            fontFamily: "Inter_700Bold",
            fontSize: 16,
          },
          contentStyle: { backgroundColor: theme.screen },
        }}
      >
        <Stack.Screen name="Projects" component={ProjectsScreen} options={{ headerShown: false }} />
        <Stack.Screen
          name="Project"
          component={ProjectScreen}
          options={({ route }) => ({ title: route.params.title ?? "Project" })}
        />
        <Stack.Screen
          name="Thread"
          component={ThreadScreen}
          options={({ route }) => ({ title: route.params.title ?? "Conversation" })}
        />
        <Stack.Screen
          name="Changes"
          component={ChangesScreen}
          options={{ title: "Changes", presentation: "fullScreenModal" }}
        />
        <Stack.Screen
          name="Terminal"
          component={TerminalScreen}
          options={{ title: "Terminal", presentation: "modal" }}
        />
        <Stack.Screen
          name="Environment"
          component={EnvironmentScreen}
          options={{
            title: "Environment",
            presentation: Platform.OS === "ios" ? "formSheet" : "card",
            sheetAllowedDetents: [0.55, 0.92],
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="Branches"
          component={BranchesScreen}
          options={{
            title: "Switch branch",
            presentation: Platform.OS === "ios" ? "formSheet" : "card",
            sheetAllowedDetents: [0.55, 0.92],
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="PullRequests"
          component={PullRequestsScreen}
          options={{ title: "Pull requests" }}
        />
        <Stack.Screen
          name="AddProject"
          component={AddProjectScreen}
          options={{
            title: "New project",
            presentation: Platform.OS === "ios" ? "formSheet" : "card",
            sheetAllowedDetents: [0.92],
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{
            title: "Settings",
            presentation: Platform.OS === "ios" ? "formSheet" : "card",
            sheetAllowedDetents: [0.7, 0.92],
            sheetGrabberVisible: true,
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

function ConnectedApp() {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
        refetchOnReconnect: true,
      },
    },
  }));
  const [convex] = useState(() => new ConvexReactClient(mobileConfig.convexUrl, {
    unsavedChangesWarning: false,
  }));

  return (
    <ConvexProviderWithAuth client={convex} useAuth={useConvexAuthBridge}>
      <QueryClientProvider client={queryClient}>
        <Navigator />
      </QueryClientProvider>
    </ConvexProviderWithAuth>
  );
}

function AppContent() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  const theme = useAppTheme();
  const setupError = configError();

  if (!fontsLoaded && !fontError) {
    return (
      <SafeAreaProvider>
        <LoadingScreen />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar
        barStyle={theme.mode === "dark" ? "light-content" : "dark-content"}
        backgroundColor={theme.surface}
      />
      {setupError ? (
        <ConfigErrorScreen message={setupError} />
      ) : (
        <AuthProvider>
          <ConnectedApp />
        </AuthProvider>
      )}
    </SafeAreaProvider>
  );
}

export default function App() {
  return (
    <AppThemeProvider>
      <AppContent />
    </AppThemeProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 30 },
  configMark: { width: 58, height: 58, borderRadius: 18, alignItems: "center", justifyContent: "center", marginBottom: 15 },
  configTitle: { fontFamily: "Inter_700Bold", fontSize: 20, textAlign: "center" },
  configBody: { maxWidth: 340, fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: 9 },
});
