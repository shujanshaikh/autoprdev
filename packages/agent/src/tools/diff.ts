import { createTwoFilesPatch } from "diff";

const MAX_DIFF_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_DIFF_PATCH_BYTES = 100 * 1024;

export type ToolFileStatus = "added" | "modified";

export interface ToolDiffPayload {
  renderer: "pierre";
  fileName: string;
  patch: string;
  patchOmitted?: boolean;
  patchOmittedReason?: "source_too_large" | "patch_too_large";
  status: ToolFileStatus;
}

/** Build a UI diff without allowing a large rewrite to dominate tool storage. */
export function createBoundedToolDiff(options: {
  path: string;
  before: string;
  after: string;
  status: ToolFileStatus;
}): ToolDiffPayload {
  const base = {
    renderer: "pierre" as const,
    fileName: options.path,
    status: options.status,
  };
  const sourceBytes = Buffer.byteLength(options.before, "utf8") + Buffer.byteLength(options.after, "utf8");
  if (sourceBytes > MAX_DIFF_SOURCE_BYTES) {
    return {
      ...base,
      patch: "",
      patchOmitted: true,
      patchOmittedReason: "source_too_large",
    };
  }

  const patch = createTwoFilesPatch(
    options.path,
    options.path,
    options.before,
    options.after,
    "before",
    "after",
  );
  if (Buffer.byteLength(patch, "utf8") > MAX_DIFF_PATCH_BYTES) {
    return {
      ...base,
      patch: "",
      patchOmitted: true,
      patchOmittedReason: "patch_too_large",
    };
  }

  return { ...base, patch };
}
