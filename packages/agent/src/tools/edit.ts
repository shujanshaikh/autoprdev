import { tool } from "ai";
import { z } from "zod";

import { getSandboxContext, type SandboxSessionOptions } from "../sandbox";
import {
  downloadRemoteFileChunk,
  ensureRemoteParentDirectory,
  resolveJailedSandboxPath,
} from "../sandbox/execute";
import { createFileMutationQueueKey, withFileMutationQueue } from "./file-mutation-queue";
import { createBoundedToolDiff } from "./diff";
import { formatSize, isProbablyBinary, toTextModelOutput } from "./format";
import { requireArray, requireString } from "./validation";

// Exact-match editing needs the whole original file in memory, so refuse
// files beyond a generous cap instead of buffering unbounded downloads.
const MAX_EDIT_FILE_BYTES = 5 * 1024 * 1024;
const MAX_EDIT_INPUT_BYTES = 10 * 1024 * 1024;
const FILE_MUTATION_WAIT_TIMEOUT_MS = 30_000;
const FILE_MUTATION_RUN_TIMEOUT_MS = 120_000;

const editInputSchema = z.object({
  path: z
    .string()
    .max(4_096)
    .optional()
    .describe("Required. Path to the file to edit. Relative paths resolve from the sandbox workdir."),
  edits: z
    .array(
      z.object({
        oldText: z
          .string()
          .optional()
          .describe("Required. Exact original text to replace. It must match exactly once in the original file."),
        newText: z.string().optional().describe("Required. Replacement text for that exact match."),
      }),
    )
    .min(1)
    .max(50)
    .refine(
      (edits) => edits.reduce(
        (bytes, edit) => bytes + Buffer.byteLength(edit.oldText ?? "") + Buffer.byteLength(edit.newText ?? ""),
        0,
      ) <= MAX_EDIT_INPUT_BYTES,
      "Edit text must total at most 10 MiB.",
    )
    .optional()
    .describe("Required. One or more exact text replacements. All matches are applied against the original file."),
});

type EditInput = z.infer<typeof editInputSchema>;

function stripBom(text: string): { bom: string; text: string } {
  return text.startsWith("\uFEFF") ? { bom: "\uFEFF", text: text.slice(1) } : { bom: "", text };
}

function detectLineEnding(text: string): "\n" | "\r\n" {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function restoreLineEndings(text: string, lineEnding: "\n" | "\r\n"): string {
  return lineEnding === "\n" ? text : text.replace(/\n/g, "\r\n");
}

function applyExactEdits(
  originalText: string,
  edits: Array<{ oldText: string; newText: string }>,
  displayPath: string,
): string {
  const matches = edits.map((edit, index) => {
    if (edit.oldText === edit.newText) {
      throw new Error(`Edit ${index + 1} would not change ${displayPath}; oldText and newText are identical.`);
    }
    const firstIndex = originalText.indexOf(edit.oldText);

    if (firstIndex === -1) {
      throw new Error(
        `Edit ${index + 1} did not match ${displayPath}. Re-read the relevant lines and retry with exact current text, including whitespace.`,
      );
    }

    const secondIndex = originalText.indexOf(edit.oldText, firstIndex + edit.oldText.length);
    if (secondIndex !== -1) {
      throw new Error(
        `Edit ${index + 1} matched more than once in ${displayPath}. Include more surrounding lines so oldText is unique.`,
      );
    }

    return {
      start: firstIndex,
      end: firstIndex + edit.oldText.length,
      newText: edit.newText,
    };
  });

  matches.sort((left, right) => left.start - right.start);

  for (let index = 1; index < matches.length; index += 1) {
    if (matches[index - 1]!.end > matches[index]!.start) {
      throw new Error(`Edits overlap in ${displayPath}. Merge nearby edits into one replacement.`);
    }
  }

  let cursor = 0;
  let output = "";

  for (const match of matches) {
    output += originalText.slice(cursor, match.start);
    output += match.newText;
    cursor = match.end;
  }

  output += originalText.slice(cursor);
  return output;
}

async function executeDaytonaEdit(input: EditInput, sandboxOptions: SandboxSessionOptions) {
  const path = requireString(input.path, "path", "edit");
  const edits = requireArray<{ oldText?: string; newText?: string }>(input.edits, "edits", "edit").map((edit, index) => ({
    oldText: requireString(edit.oldText, `edits[${index}].oldText`, "edit"),
    newText: requireString(edit.newText, `edits[${index}].newText`, "edit", { allowEmpty: true }),
  }));
  const context = await getSandboxContext(sandboxOptions);
  const remotePath = await resolveJailedSandboxPath(path, {
    workDir: context.workDir,
    sandboxOptions,
  });

  return withFileMutationQueue(createFileMutationQueueKey(context.sandbox.id, remotePath), async () => {
    const chunk = await downloadRemoteFileChunk({
      remotePath,
      maxBytes: MAX_EDIT_FILE_BYTES,
      sandboxOptions,
    });
    if (chunk.totalBytes > MAX_EDIT_FILE_BYTES) {
      throw new Error(
        `Cannot edit ${remotePath}: the file is ${formatSize(chunk.totalBytes)}, over the ` +
          `${formatSize(MAX_EDIT_FILE_BYTES)} edit limit. Use write to replace it or bash for targeted changes.`,
      );
    }
    const originalText = chunk.content.toString("utf8");
    if (isProbablyBinary(chunk.content)) {
      throw new Error(`Cannot edit ${remotePath} as text because it appears to be binary.`);
    }
    const { bom, text: withoutBom } = stripBom(originalText);
    const lineEnding = detectLineEnding(withoutBom);
    const normalizedOriginal = normalizeLineEndings(withoutBom);
    const normalizedEdits = edits.map((edit) => ({
      oldText: normalizeLineEndings(edit.oldText),
      newText: normalizeLineEndings(edit.newText),
    }));
    const normalizedNext = applyExactEdits(normalizedOriginal, normalizedEdits, remotePath);
    if (normalizedNext === normalizedOriginal) {
      throw new Error(`The requested replacements did not change ${remotePath}.`);
    }
    const nextText = bom + restoreLineEndings(normalizedNext, lineEnding);
    const nextBuffer = Buffer.from(nextText, "utf8");

    await ensureRemoteParentDirectory(remotePath, sandboxOptions);
    await context.sandbox.fs.uploadFile(nextBuffer, remotePath);

    return {
      content: `Applied ${edits.length} exact replacement(s) to ${remotePath}.`,
      details: {
        path: remotePath,
        replacements: edits.length,
        bytesWritten: nextBuffer.length,
        diff: createBoundedToolDiff({
          path: remotePath,
          before: originalText,
          after: nextText,
          status: "modified",
        }),
      },
    };
  }, {
    waitTimeoutMs: FILE_MUTATION_WAIT_TIMEOUT_MS,
    runTimeoutMs: FILE_MUTATION_RUN_TIMEOUT_MS,
    createWaitTimeoutError: () => new Error(`Timed out waiting to edit ${remotePath}; another mutation is still running.`),
    createRunTimeoutError: () => new Error(`Timed out editing ${remotePath} in Daytona.`),
  });
}

export function createDaytonaEditTool(sandboxOptions: SandboxSessionOptions) {
  return tool({
    title: "edit",
    description:
      "Edit one existing non-binary file using up to 50 exact replacements matched against the same original content. Each oldText must be unique and change the file; combine nearby or overlapping changes. Preserves BOM/line endings, canonicalizes paths inside the workspace jail, serializes same-file mutations, and bounds stored diffs. Re-read after mismatch errors before retrying.",
    inputSchema: editInputSchema,
    toModelOutput: ({ output }) => toTextModelOutput(output),
    execute: (input) => executeDaytonaEdit(input, sandboxOptions),
  });
}
