export const mobileConfig = {
  convexUrl: process.env.EXPO_PUBLIC_CONVEX_URL?.trim() ?? "",
  webUrl: (process.env.EXPO_PUBLIC_WEB_URL?.trim() ?? "").replace(/\/+$/, ""),
} as const;

export function configError() {
  const missing = [];
  if (!mobileConfig.convexUrl) missing.push("EXPO_PUBLIC_CONVEX_URL");
  if (!mobileConfig.webUrl) missing.push("EXPO_PUBLIC_WEB_URL");
  return missing.length > 0 ? `Missing ${missing.join(" and ")}.` : null;
}
