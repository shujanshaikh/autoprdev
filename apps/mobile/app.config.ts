import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "AutoPR",
  slug: "autopr",
  scheme: "autopr",
  version: "0.1.0",
  icon: "./assets/icon.png",
  orientation: "portrait",
  platforms: ["ios", "android"],
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: "com.shujanshaikh.autopr",
    supportsTablet: true,
  },
  android: {
    package: "com.shujanshaikh.autopr",
    predictiveBackGestureEnabled: true,
  },
  plugins: [
    "expo-image",
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
