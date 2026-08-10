import { describe, expect, it } from "vitest";

import { createBoundedToolDiff } from "./diff";

describe("bounded tool diffs", () => {
  it("keeps a useful patch for normal edits", () => {
    const diff = createBoundedToolDiff({
      path: "/workspace/a.ts",
      before: "const a = 1;\n",
      after: "const a = 2;\n",
      status: "modified",
    });

    expect(diff.patchOmitted).toBeUndefined();
    expect(diff.patch).toContain("-const a = 1;");
    expect(diff.patch).toContain("+const a = 2;");
  });

  it("omits patches for oversized source content", () => {
    const diff = createBoundedToolDiff({
      path: "/workspace/large.txt",
      before: "x".repeat(1024 * 1024 + 1),
      after: "y".repeat(1024 * 1024 + 1),
      status: "modified",
    });

    expect(diff).toMatchObject({
      patch: "",
      patchOmitted: true,
      patchOmittedReason: "source_too_large",
    });
  });
});
