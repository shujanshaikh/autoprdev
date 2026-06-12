import { tool } from "ai";
import { createTwoFilesPatch } from "diff";
import { z } from "zod";

import { getSandboxContext, type SandboxSessionOptions } from "../sandbox";
import { ensureRemoteParentDirectory, resolveSandboxPath } from "../sandbox/execute";
import { toTextModelOutput } from "./format";
import { requireArray, requireString } from "./validation";

const editInputSchema = z.object({
  path: z
    .string()
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

  const path = requireString(input.path, "path", "edit");
  const edits = requireArray<{ oldText?: string; newText?: string }>(input.edits, "edits", "edit").map((edit, index) => ({
    oldText: requireString(edit.oldText, `edits[${index}].oldText`, "edit"),
    newText: requireString(edit.newText, `edits[${index}].newText`, "edit", { allowEmpty: true }),
  }));
  const context = await getSandboxContext(sandboxOptions);
  const remotePath = resolveSandboxPath(path, context.workDir);
  const originalBuffer = Buffer.from(await context.sandbox.fs.downloadFile(remotePath));
  const originalText = originalBuffer.toString("utf8");
  const { bom, text: withoutBom } = stripBom(originalText);
  const lineEnding = detectLineEnding(withoutBom);
  const normalizedOriginal = normalizeLineEndings(withoutBom);
  const normalizedEdits = edits.map((edit) => ({
    oldText: normalizeLineEndings(edit.oldText),
    newText: normalizeLineEndings(edit.newText),
  }));
  const normalizedNext = applyExactEdits(normalizedOriginal, normalizedEdits, remotePath);
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
      diff: {
        renderer: "pierre",
        fileName: remotePath,
        patch: createTwoFilesPatch(remotePath, remotePath, originalText, nextText, "before", "after"),
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
      "Edit one existing text file in the Daytona sandbox using exact text replacements. Use after reading the target file. Each oldText must match exactly once in the original file; combine nearby changes in one replacement and avoid overlapping edits. Mutates files, returns a diff, and should be retried only after inspecting any mismatch error.",
    inputSchema: editInputSchema,
    toModelOutput: ({ output }) => toTextModelOutput(output),
    execute: (input) => executeDaytonaEdit(input, sandboxOptions),
  });
}
