import { describe, expect, it, vi } from "vitest";

import { withEphemeralGitAuth } from "./sandbox-git-auth";

describe("withEphemeralGitAuth", () => {
  it("keeps the token out of the Git process environment and removes the helper", async () => {
    const uploaded = new Map<string, string>();
    const deleted: Array<{ path: string; recursive?: boolean }> = [];
    const sandbox = {
      process: {
        executeCommand: vi.fn().mockResolvedValue({ exitCode: 0 }),
      },
      fs: {
        uploadFile: vi.fn(async (content: Uint8Array, path: string) => {
          uploaded.set(path, Buffer.from(content).toString("utf8"));
        }),
        deleteFile: vi.fn(async (path: string, recursive?: boolean) => {
          deleted.push({ path, recursive });
        }),
      },
    };
    const token = "test-token-must-not-be-in-proc-environ";

    const env = await withEphemeralGitAuth(
      /* SAFETY: This deliberately partial fixture implements exactly the owner-contract members exercised by this isolated test. */ sandbox as never,
      token,
      async (gitEnv) => gitEnv,
    );

    expect(JSON.stringify(env)).not.toContain(token);
    expect(env).toMatchObject({
      GIT_TERMINAL_PROMPT: "0",
    });
    expect(env).not.toHaveProperty("GIT_ASKPASS_REQUIRE");
    expect([...uploaded.values()]).toContain(token);
    expect(deleted).toEqual([{
      path: expect.stringMatching(/^\/tmp\/autopr-git-auth-/),
      recursive: true,
    }]);
  });

  it("reports a recursive credential-cleanup failure", async () => {
    const sandbox = {
      process: { executeCommand: vi.fn().mockResolvedValue({ exitCode: 0 }) },
      fs: {
        uploadFile: vi.fn().mockResolvedValue(undefined),
        deleteFile: vi.fn().mockRejectedValue(new Error("cleanup denied")),
      },
    };

    await expect(withEphemeralGitAuth(
      /* SAFETY: This deliberately partial fixture implements exactly the owner-contract members exercised by this isolated test. */ sandbox as never,
      "secret-token",
      async () => "done",
    )).rejects.toThrow("Could not remove temporary Git credentials");
    expect(sandbox.fs.deleteFile).toHaveBeenCalledWith(
      expect.stringMatching(/^\/tmp\/autopr-git-auth-/),
      true,
    );
  });
});
