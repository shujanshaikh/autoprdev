import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  DarkTheme as NavigationDarkTheme,
  DefaultTheme as NavigationLightTheme,
  NavigationContainer,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { GitPullRequest, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, AppState, Platform, Pressable, StatusBar, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { configError, mobileConfig } from "./config";
import { useAppTheme } from "./hooks/useAppTheme";
import { AddProjectScreen } from "./screens/AddProjectScreen";
import { BranchesScreen } from "./screens/BranchesScreen";
import { ChangesScreen } from "./screens/ChangesScreen";
import { EnvironmentScreen } from "./screens/EnvironmentScreen";
import { GitActionsScreen } from "./screens/GitActionsScreen";
import { NewTaskScreen } from "./screens/NewTaskScreen";
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
      <ActivityIndicator color={theme.accentOn} />
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
          headerBackButtonDisplayMode: "minimal",
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
          name="NewTask"
          component={NewTaskScreen}
          options={{
            title: "New task",
            presentation: Platform.OS === "ios" ? "formSheet" : "card",
            sheetAllowedDetents: [0.55, 0.92],
            sheetGrabberVisible: true,
          }}
        />
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
          options={({ navigation }) => ({
            title: "Changes",
            presentation: "fullScreenModal",
            headerLeft: () => (
              <Pressable
                accessibilityLabel="Close changes"
                onPress={() => navigation.goBack()}
                style={({ pressed }) => [styles.closeButton, { opacity: pressed ? 0.55 : 1 }]}
              >
                <X color={theme.ink} size={20} />
              </Pressable>
            ),
          })}
        />
        <Stack.Screen
          name="GitActions"
          component={GitActionsScreen}
          options={{
            title: "Git actions",
            presentation: Platform.OS === "ios" ? "formSheet" : "card",
            sheetAllowedDetents: [0.7, 0.92],
            sheetGrabberVisible: true,
          }}
        />
        <Stack.Screen
          name="Terminal"
          component={TerminalScreen}
          options={({ navigation }) => ({
            title: "Terminal",
            presentation: "fullScreenModal",
            headerLeft: () => (
              <Pressable
                accessibilityLabel="Close terminal"
                onPress={() => navigation.goBack()}
                style={({ pressed }) => [styles.closeButton, { opacity: pressed ? 0.55 : 1 }]}
              >
                <X color={theme.ink} size={20} />
              </Pressable>
            ),
          })}
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

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      focusManager.setFocused(state === "active");
    });
    focusManager.setFocused(AppState.currentState === "active");
    return () => {
      subscription.remove();
      focusManager.setFocused(undefined);
    };
  }, []);

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
    <GestureHandlerRootView style={styles.app}>
      <AppThemeProvider>
        <AppContent />
      </AppThemeProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1 },
  closeButton: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 30 },
  configMark: { width: 58, height: 58, borderRadius: 18, alignItems: "center", justifyContent: "center", marginBottom: 15 },
  configTitle: { fontFamily: "Inter_700Bold", fontSize: 20, textAlign: "center" },
  configBody: { maxWidth: 340, fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: 9 },
});
