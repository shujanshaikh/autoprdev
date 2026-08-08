import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchThreadGitFileDiff } from "./thread-git-diff";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchThreadGitFileDiff", () => {
  it("loads a repository-relative file diff with an encoded path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      diff: {
        file: "src/file name.ts",
        patch: "patch",
        patchOmitted: false,
        status: "modified",
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchThreadGitFileDiff({
      projectId: "project",
      threadId: "thread",
      file: "src/file name.ts",
    })).resolves.toMatchObject({ file: "src/file name.ts", patch: "patch" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/project/project/thread/thread?gitDiff=src%2Ffile%20name.ts",
    );
  });

  it("surfaces the server error when the file is no longer changed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(
      { error: { message: "The file is no longer changed." } },
      { status: 404 },
    )));

    await expect(fetchThreadGitFileDiff({
      projectId: "project",
      threadId: "thread",
      file: "src/example.ts",
    })).rejects.toThrow("The file is no longer changed.");
  });
});
