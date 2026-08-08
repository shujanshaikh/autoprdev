import { Alert, Linking } from "react-native";

import { externalUrlForOpen } from "./urls";

/**
 * Open an external URL after the scheme allow-list check. Returns false —
 * without opening anything — when the scheme is refused or the OS cannot
 * handle the URL.
 */
export async function openExternalUrl(raw: string): Promise<boolean> {
  const url = externalUrlForOpen(raw);
  if (!url) return false;
  try {
    await Linking.openURL(url.toString());
    return true;
  } catch {
    return false;
  }
}

/**
 * Agent-authored links get a confirmation step that displays the raw URL, so
 * lookalike hosts are visible to the user before anything opens.
 */
export function confirmOpenExternalUrl(raw: string): void {
  const url = externalUrlForOpen(raw);
  if (!url) {
    Alert.alert(
      "Link blocked",
      "This link can't be opened because it doesn't use an allowed scheme.",
    );
    return;
  }
  Alert.alert("Open link?", url.toString(), [
    { text: "Cancel", style: "cancel" },
    { text: "Open", onPress: () => void openExternalUrl(url.toString()) },
  ]);
}
