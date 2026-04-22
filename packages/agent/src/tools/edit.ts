import { tool } from "ai";
import { z } from "zod";

import { getSandboxContext, type SandboxSessionOptions } from "../sandbox";
import { ensureRemoteParentDirectory, resolveSandboxPath } from "../sandbox/execute";
import { toTextModelOutput } from "./format";

const editInputSchema = z.object({
  path: z.string().describe("Path to the file to edit. Relative paths resolve from the sandbox workdir."),
  edits: z
    .array(
      z.object({
        oldText: z.string().describe("Exact original text to replace. It must match exactly once in the original file."),
        newText: z.string().describe("Replacement text for that exact match."),
      }),
    )
    .min(1)
    .describe("One or more exact text replacements. All matches are applied against the original file."),
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
    const firstIndex = originalText.indexOf(edit.oldText);

    if (firstIndex === -1) {
      throw new Error(`Edit ${index + 1} did not match any text in ${displayPath}.`);
    }

    const secondIndex = originalText.indexOf(edit.oldText, firstIndex + edit.oldText.length);
    if (secondIndex !== -1) {
      throw new Error(`Edit ${index + 1} matched more than once in ${displayPath}.`);
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
  "use step";

  const context = await getSandboxContext(sandboxOptions);
  const remotePath = resolveSandboxPath(input.path, context.workDir);
  const originalBuffer = Buffer.from(await context.sandbox.fs.downloadFile(remotePath));
  const originalText = originalBuffer.toString("utf8");
  const { bom, text: withoutBom } = stripBom(originalText);
  const lineEnding = detectLineEnding(withoutBom);
  const normalizedOriginal = normalizeLineEndings(withoutBom);
  const normalizedEdits = input.edits.map((edit) => ({
    oldText: normalizeLineEndings(edit.oldText),
    newText: normalizeLineEndings(edit.newText),
  }));
  const normalizedNext = applyExactEdits(normalizedOriginal, normalizedEdits, remotePath);
  const nextText = bom + restoreLineEndings(normalizedNext, lineEnding);
  const nextBuffer = Buffer.from(nextText, "utf8");

  await ensureRemoteParentDirectory(remotePath, sandboxOptions);
  await context.sandbox.fs.uploadFile(nextBuffer, remotePath);

  return {
    content: `Applied ${input.edits.length} exact replacement(s) to ${remotePath}.`,
    details: {
      path: remotePath,
      replacements: input.edits.length,
      bytesWritten: nextBuffer.length,
      diff: {
        renderer: "pierre",
        fileName: remotePath,
        oldContent: originalText,
        newContent: nextText,
      },
    },
  };
}

export function createDaytonaEditTool(sandboxOptions: SandboxSessionOptions) {
  return tool({
    title: "edit",
    description:
      "Edit a single file using exact text replacements. Each oldText must match exactly once in the original file.",
    inputSchema: editInputSchema,
    toModelOutput: ({ output }) => toTextModelOutput(output),
    execute: (input) => executeDaytonaEdit(input, sandboxOptions),
  });
}
