import { randomUUID } from "node:crypto";
import { truncateToolOutput } from "./format";

/** Saves redacted output outside the repository; bash can read or search the artifact. */
export async function preserveLargeOutput(
  text: string,
  upload: (content: Uint8Array, path: string) => Promise<unknown>,
) {
  const bounded = truncateToolOutput(text, { direction: "tail" });
  if (!bounded.truncated) return bounded;
  const path = `/tmp/autopr-output-${randomUUID()}.log`;
  try {
    await upload(Buffer.from(text, "utf8"), path);
    const preview = truncateToolOutput(text, { direction: "tail", maxBytes: 4_000, maxLines: 80 });
    return {
      ...preview,
      text: `Full output: ${path} (${bounded.totalBytes} bytes, ${bounded.totalLines} lines). Use bash with tail or sed to inspect it.\n\n${preview.text}`,
      artifactPath: path,
    };
  } catch {
    // Preserve evidence if artifact storage is unavailable.
    return { ...bounded, text, truncated: false, truncatedBy: null,
      outputBytes: bounded.totalBytes, outputLines: bounded.totalLines };
  }
}
