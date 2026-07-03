import type { UIMessage } from "ai";

const MAX_MODEL_TOOL_TEXT_CHARS = 2_000;
const MAX_MODEL_DIFF_PATCH_CHARS = 60_000;
const MODEL_TOOL_TEXT_PREVIEW_CHARS = 400;

const FILE_MUTATION_TOOLS = new Set(["write", "edit"]);
const DETAIL_KEYS_FOR_MODEL = [
  "path",
  "bytesWritten",
  "contentBytes",
  "fileBytes",
  "mode",
  "previousExists",
  "unchanged",
  "replacements",
  "truncated",
  "diffTruncated",
];

type DiffCompactionOptions = {
  omitPatch: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactLongText(value: unknown, fieldName: string): unknown {
  if (typeof value !== "string" || value.length <= MAX_MODEL_TOOL_TEXT_CHARS) {
    return value;
  }

  const preview = value.slice(0, MODEL_TOOL_TEXT_PREVIEW_CHARS);
  return `${preview}\n\n[${fieldName} omitted from model prompt: ${value.length} characters]`;
}

function compactWriteInput(input: unknown): unknown {
  if (!isRecord(input)) {
    return input;
  }

  return {
    ...input,
    content: compactLongText(input.content, "write.content"),
  };
}

function compactEditInput(input: unknown): unknown {
  if (!isRecord(input) || !Array.isArray(input.edits)) {
    return input;
  }

  return {
    ...input,
    edits: input.edits.map((edit, index) => {
      if (!isRecord(edit)) {
        return edit;
      }

      return {
        ...edit,
        oldText: compactLongText(edit.oldText, `edit.edits[${index}].oldText`),
        newText: compactLongText(edit.newText, `edit.edits[${index}].newText`),
      };
    }),
  };
}

function compactToolInputForModel(toolName: string, input: unknown): unknown {
  if (toolName === "write") {
    return compactWriteInput(input);
  }

  if (toolName === "edit") {
    return compactEditInput(input);
  }

  return input;
}

function compactDiffForModel(diff: Record<string, unknown>, options: DiffCompactionOptions): Record<string, unknown> {
  const next: Record<string, unknown> = {};

  for (const key of ["renderer", "fileName", "status", "truncated"]) {
    if (key in diff) {
      next[key] = diff[key];
    }
  }

  for (const key of ["patch", "oldContent", "newContent"]) {
    const value = diff[key];
    if (typeof value === "string") {
      next[`${key}Chars`] = value.length;
      if (key !== "patch" || options.omitPatch) {
        next[`${key}Omitted`] = true;
      }
    }
  }

  const shouldKeepPatch =
    typeof diff.patch === "string" &&
    !options.omitPatch &&
    diff.patch.length <= MAX_MODEL_DIFF_PATCH_CHARS;

  if (shouldKeepPatch) {
    next.patch = diff.patch;
  } else if ("patch" in diff) {
    next.patch = "[diff omitted from model prompt; rendered in the UI]";
    next.patchOmitted = true;
  }

  return next;
}

function compactDetailsForModel(
  details: Record<string, unknown>,
  options: DiffCompactionOptions,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};

  for (const key of DETAIL_KEYS_FOR_MODEL) {
    if (key in details) {
      next[key] = details[key];
    }
  }

  if (isRecord(details.diff)) {
    next.diff = compactDiffForModel(details.diff, options);
  }

  return next;
}

function isContentDetailsOutput(value: unknown): value is { content: string; details: Record<string, unknown> } {
  return isRecord(value) && typeof value.content === "string" && isRecord(value.details);
}

function compactToolOutputValueForModel(
  toolName: string,
  value: unknown,
  options: DiffCompactionOptions,
): unknown {
  if (!FILE_MUTATION_TOOLS.has(toolName) || !isContentDetailsOutput(value)) {
    return value;
  }

  return {
    content: value.content,
    details: compactDetailsForModel(value.details, options),
  };
}

function compactToolResultOutputForModel(
  toolName: string,
  output: unknown,
  options: DiffCompactionOptions,
): unknown {
  if (!FILE_MUTATION_TOOLS.has(toolName)) {
    return output;
  }

  if (isRecord(output) && "value" in output && typeof output.type === "string") {
    return {
      ...output,
      value: compactToolOutputValueForModel(toolName, output.value, options),
    };
  }

  return compactToolOutputValueForModel(toolName, output, options);
}

function uiToolName(part: UIMessage["parts"][number]): string | undefined {
  if (part.type === "dynamic-tool" && "toolName" in part && typeof part.toolName === "string") {
    return part.toolName;
  }

  return part.type.startsWith("tool-") ? part.type.slice("tool-".length) : undefined;
}

export function compactAssistantPartsForModel(parts: UIMessage["parts"]): UIMessage["parts"] {
  return parts.map((part) => {
    const toolName = uiToolName(part);
    if (!toolName || !FILE_MUTATION_TOOLS.has(toolName)) {
      return part;
    }

    const nextPart: Record<string, unknown> = { ...part };
    if ("input" in part) {
      nextPart.input = compactToolInputForModel(toolName, part.input);
    }
    if ("output" in part) {
      nextPart.output = compactToolResultOutputForModel(toolName, part.output, { omitPatch: true });
    }

    return nextPart as UIMessage["parts"][number];
  });
}

function compactPromptPart(part: unknown): unknown {
  if (!isRecord(part)) {
    return part;
  }

  if (part.type === "tool-call" && typeof part.toolName === "string" && FILE_MUTATION_TOOLS.has(part.toolName)) {
    return {
      ...part,
      input: compactToolInputForModel(part.toolName, part.input),
    };
  }

  if (part.type === "tool-result" && typeof part.toolName === "string" && FILE_MUTATION_TOOLS.has(part.toolName)) {
    return {
      ...part,
      output: compactToolResultOutputForModel(part.toolName, part.output, { omitPatch: false }),
    };
  }

  return part;
}

function compactPromptMessage(message: unknown): unknown {
  if (!isRecord(message) || !Array.isArray(message.content)) {
    return message;
  }

  return {
    ...message,
    content: message.content.map(compactPromptPart),
  };
}

export function compactPromptMessagesForModel<MESSAGES>(messages: MESSAGES): MESSAGES {
  return Array.isArray(messages) ? (messages.map(compactPromptMessage) as MESSAGES) : messages;
}
