const attachmentOriginValue = process.env.EXPO_PUBLIC_ATTACHMENT_ORIGIN?.trim() ?? "";

function normalizedHttpsOrigin(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.origin : "";
  } catch {
    return "";
  }
}

export const mobileConfig = {
  convexUrl: process.env.EXPO_PUBLIC_CONVEX_URL?.trim() ?? "",
  webUrl: (process.env.EXPO_PUBLIC_WEB_URL?.trim() ?? "").replace(/\/+$/, ""),
  attachmentOrigin: normalizedHttpsOrigin(attachmentOriginValue),
} as const;

export function configError() {
  const missing = [];
  if (!mobileConfig.convexUrl) missing.push("EXPO_PUBLIC_CONVEX_URL");
  if (!mobileConfig.webUrl) missing.push("EXPO_PUBLIC_WEB_URL");
  if (!attachmentOriginValue) missing.push("EXPO_PUBLIC_ATTACHMENT_ORIGIN");
  if (attachmentOriginValue && !mobileConfig.attachmentOrigin) {
    return "EXPO_PUBLIC_ATTACHMENT_ORIGIN must be a valid HTTPS origin.";
  }
  return missing.length > 0 ? `Missing ${missing.join(" and ")}.` : null;
}
