import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "AutoPR",
  slug: "autopr",
  scheme: "autopr",
  version: "0.1.0",
  orientation: "portrait",
  platforms: ["ios", "android"],
  userInterfaceStyle: "automatic",
  ios: {
    supportsTablet: true,
  },
  android: {
    predictiveBackGestureEnabled: true,
  },
  plugins: [
    "expo-secure-store",
    "expo-web-browser",
    [
      "expo-image-picker",
      {
        photosPermission: "AutoPR uses selected photos only when you attach them to an agent task.",
      },
    ],
  ],
};

export default config;
