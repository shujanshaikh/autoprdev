import { mobileConfig } from "../config";

/**
 * Schemes the app will hand to the OS. Everything else — intent:, tel:,
 * javascript:, data:, arbitrary app schemes — is refused before Linking
 * sees it. Links rendered in chat are agent-influenceable (finding #11),
 * so this is the single gate every external open goes through.
 */
const OPENABLE_SCHEMES = new Set(["https:", "mailto:"]);

/**
 * Presigned R2 URLs (imageUploads.getUrl, agent-produced file parts) are
 * served from the Cloudflare R2 S3-API endpoint under this host suffix.
 */
const R2_HOST_SUFFIX = ".r2.cloudflarestorage.com";

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw.trim());
  } catch {
    return null;
  }
}

/**
 * Parse `raw` and keep it only when its scheme is safe to hand to
 * `Linking.openURL`. Returns the normalized URL, or null when refused.
 */
export function externalUrlForOpen(raw: string): URL | null {
  const url = parseUrl(raw);
  return url !== null && OPENABLE_SCHEMES.has(url.protocol) ? url : null;
}

function configuredHost(value: string): string | null {
  if (!value) return null;
  return parseUrl(value)?.hostname.toLowerCase() ?? null;
}

function convexSiteHost(convexHost: string | null): string | null {
  const suffix = ".convex.cloud";
  if (!convexHost || !convexHost.endsWith(suffix)) return null;
  return `${convexHost.slice(0, -suffix.length)}.convex.site`;
}

function extraTrustedHosts(): string[] {
  const raw: string = process.env.EXPO_PUBLIC_TRUSTED_FILE_HOSTS ?? "";
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

function hostMatches(hostname: string, entry: string): boolean {
  if (entry.startsWith(".")) {
    // Leading dot = suffix match; the dot itself blocks lookalikes such as
    // "evilr2.cloudflarestorage.com".
    return hostname === entry.slice(1) || hostname.endsWith(entry);
  }
  return hostname === entry;
}

/**
 * Origins whose images may load without a user gesture: the AutoPR web app,
 * the Convex deployment (cloud + site hosts), Cloudflare R2 presigned URLs,
 * and any deployment-specific hosts in EXPO_PUBLIC_TRUSTED_FILE_HOSTS (e.g. a
 * custom R2 domain or the Daytona preview proxy domain). Entries match the
 * host exactly, or as a suffix when they start with a dot.
 */
export function trustedImageHosts(): string[] {
  const convexHost = configuredHost(mobileConfig.convexUrl);
  return [
    configuredHost(mobileConfig.attachmentOrigin),
    configuredHost(mobileConfig.webUrl),
    convexHost,
    convexSiteHost(convexHost),
    R2_HOST_SUFFIX,
    ...extraTrustedHosts(),
  ].filter((host): host is string => host !== null);
}

/**
 * True when rendering the image would not silently reach a third party:
 * embedded data: images perform no network fetch at all, and first-party
 * https origins are served by this deployment.
 */
export function isFirstPartyImageUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed.toLowerCase().startsWith("data:image/")) return true;
  const url = parseUrl(trimmed);
  if (!url || url.protocol !== "https:") return false;
  const hostname = url.hostname.toLowerCase();
  return trustedImageHosts().some((entry) => hostMatches(hostname, entry));
}

/** Short label naming where an image would be loaded from, for gated copy. */
export function imageHostLabel(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.toLowerCase().startsWith("data:")) return "embedded data";
  return parseUrl(trimmed)?.hostname ?? "";
}
