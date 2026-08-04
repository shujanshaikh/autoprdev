import { describe, expect, it, vi } from "vitest";

import { withEphemeralGitAuth } from "./sandbox-git-auth";

describe("withEphemeralGitAuth", () => {
  it("keeps the token out of the Git process environment and removes the helper", async () => {
    const uploaded = new Map<string, string>();
    const deleted: string[] = [];
    const sandbox = {
      process: {
        executeCommand: vi.fn().mockResolvedValue({ exitCode: 0 }),
      },
      fs: {
        uploadFile: vi.fn(async (content: Uint8Array, path: string) => {
          uploaded.set(path, Buffer.from(content).toString("utf8"));
        }),
        deleteFile: vi.fn(async (path: string) => {
          deleted.push(path);
        }),
      },
    };
    const token = "test-token-must-not-be-in-proc-environ";

    const env = await withEphemeralGitAuth(
      sandbox as never,
      token,
      async (gitEnv) => gitEnv,
    );

    expect(JSON.stringify(env)).not.toContain(token);
    expect(env).toMatchObject({
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS_REQUIRE: "force",
    });
    expect([...uploaded.values()]).toContain(token);
    expect(deleted).toEqual([expect.stringMatching(/^\/tmp\/autopr-git-auth-/)]);
  });
});
