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
};

export default config;
