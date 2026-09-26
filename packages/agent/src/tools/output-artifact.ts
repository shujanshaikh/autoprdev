import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { truncateToolOutput } from "./format";

/** Saves redacted output outside the repository, with worker storage for upload failures. */
export async function preserveLargeOutput(
  text: string,
  upload: (content: Uint8Array, path: string) => Promise<unknown>,
) {
  const bounded = truncateToolOutput(text, { direction: "tail" });
  if (!bounded.truncated) return bounded;
  const path = `/tmp/autopr-output-${randomUUID()}.log`;
  const preview = truncateToolOutput(text, { direction: "tail", maxBytes: 4_000, maxLines: 80 });
  let workerArtifactPath: string | undefined;
  let location: string;
  try {
    await upload(Buffer.from(text, "utf8"), path);
    location = `Full output: ${path}. Use bash with tail or sed to inspect it.`;
  } catch {
    let directory: string | undefined;
    try {
      directory = await mkdtemp(join(tmpdir(), "autopr-output-"));
      workerArtifactPath = join(directory, "output.log");
      await writeFile(workerArtifactPath, text, { encoding: "utf8", mode: 0o600 });
    } catch {
      if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
      throw new Error(
        `Unable to preserve ${bounded.totalBytes} bytes of tool output: sandbox upload and worker storage failed. Full output was not saved.\n\n${preview.text}`,
      );
    }
    location = `Sandbox output upload failed. Full output is retained on the agent worker at ${workerArtifactPath}. This is an operator recovery file, unavailable to sandbox tools; recover it before the worker is recycled.`;
  }
  const resultText = `${location}\n${bounded.totalBytes} bytes, ${bounded.totalLines} lines.\n\n${preview.text}`;
  return {
    ...preview,
    text: resultText,
    outputBytes: Buffer.byteLength(resultText, "utf8"),
    outputLines: resultText.split("\n").length,
    ...(workerArtifactPath ? { workerArtifactPath } : { artifactPath: path }),
  };
}
