import { mobileConfig } from "../config";

export function trustedAttachmentImageUrl(
  value: string,
  trustedOrigin = mobileConfig.attachmentOrigin,
) {
  if (!trustedOrigin) return null;

  try {
    const url = new URL(value);
    const allowed = new URL(trustedOrigin);
    return url.protocol === "https:"
      && allowed.protocol === "https:"
      && url.origin === allowed.origin
      ? value
      : null;
  } catch {
    return null;
  }
}
