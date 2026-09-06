import { getFunctionName, type FunctionArgs } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSandbox: vi.fn(),
  createSecret: vi.fn(),
  destroySecret: vi.fn(),
}));

vi.mock("@autopr/agent/sandbox", () => ({
  createSandbox: mocks.createSandbox,
  deleteSandbox: vi.fn(),
  E2B_ENV_MANIFEST: "/home/autopr/.autopr/environment.json",
  E2B_SANDBOX_WORKDIR: "/home/autopr",
}));
vi.mock("e2b", () => ({
  Sandbox: {},
  Secret: { create: mocks.createSecret, destroy: mocks.destroySecret },
}));

import {
  importSandboxEnvironmentVariables as importAction,
  removeSandboxEnvironmentVariable as removeAction,
} from "@autopr/backend/convex/projectActions";

import type { api } from "@autopr/backend/convex/_generated/api";

// Exercise the registered actions with mocked provider and persistence boundaries.
const importSandboxEnvironmentVariables = importAction as unknown as {
  _handler: (ctx: unknown, args: FunctionArgs<typeof api.projectActions.importSandboxEnvironmentVariables>) => Promise<unknown>;
};
const removeSandboxEnvironmentVariable = removeAction as unknown as {
  _handler: (ctx: unknown, args: FunctionArgs<typeof api.projectActions.removeSandboxEnvironmentVariable>) => Promise<unknown>;
};

function environmentContext() {
  const project = {
    sandboxId: "sandbox-1",
    sandboxProvider: "e2b",
    repoFullName: "owner/repo",
    sandboxSecrets: [{ envName: "TOKEN", secretId: "old-secret", secretName: "old-token", hosts: [], updatedAt: 0 }],
    sandboxEnvironmentVariables: [],
  };
  const runMutation = vi.fn(async (reference: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(reference);
    if (name.includes("acquireSandboxEnvironmentUpdate")) return project;
    if (name.includes("renewSandboxEnvironmentUpdate")) return true;
    return null;
  });
  return {
    auth: { getUserIdentity: async () => ({ subject: "author-1" }) },
    runQuery: vi.fn(async () => project),
    runMutation,
  };
}

describe("E2B environment updates", () => {
  beforeEach(() => vi.resetAllMocks());

  it("cleans up a late successful secret creation after another creation fails", async () => {
    const ctx = environmentContext();
    let resolveSecret!: (secret: { secretId: string; name: string }) => void;
    const lateSecret = new Promise<{ secretId: string; name: string }>((resolve) => { resolveSecret = resolve; });
    mocks.createSecret
      .mockRejectedValueOnce(new Error("provider rejected first secret"))
      .mockReturnValueOnce(lateSecret);

    const imported = importSandboxEnvironmentVariables._handler(ctx, {
      projectId: "project-1",
      entries: [{ envName: "FIRST", value: "first-value" }, { envName: "SECOND", value: "second-value" }],
    });
    const rejected = expect(imported).rejects.toThrow("provider rejected first secret");
    await vi.waitFor(() => expect(mocks.createSecret).toHaveBeenCalledTimes(2));
    expect(mocks.destroySecret).not.toHaveBeenCalled();
    resolveSecret({ secretId: "late-secret", name: "late-name" });
    await rejected;

    expect(mocks.destroySecret).toHaveBeenCalledWith("late-secret");
    expect(mocks.createSandbox).not.toHaveBeenCalled();
  });

  it("restores the manifest and preserves the secret when the database removal fails", async () => {
    const ctx = environmentContext();
    const originalMutation = ctx.runMutation.getMockImplementation()!;
    ctx.runMutation.mockImplementation(async (reference) => {
      if (getFunctionName(reference).includes("removeSandboxEnvironmentVariableInternal")) {
        throw new Error("database unavailable");
      }
      return originalMutation(reference);
    });
    const uploadFile = vi.fn(async (_bytes: Uint8Array, _path: string) => undefined);
    mocks.createSandbox.mockResolvedValue({ fs: { uploadFile } });

    await expect(removeSandboxEnvironmentVariable._handler(ctx, {
      projectId: "project-1", envName: "TOKEN",
    })).rejects.toThrow("database unavailable");

    expect(mocks.destroySecret).not.toHaveBeenCalled();
    expect(uploadFile.mock.calls.map(([bytes]) => new TextDecoder().decode(bytes))).toEqual([
      "{}", JSON.stringify({ TOKEN: "old-token" }),
    ]);
  });

  it("keeps a failed provider deletion retryable by restoring the persisted secret reference", async () => {
    const ctx = environmentContext();
    const uploadFile = vi.fn(async (_bytes: Uint8Array, _path: string) => undefined);
    mocks.createSandbox.mockResolvedValue({ fs: { uploadFile } });
    mocks.destroySecret.mockRejectedValueOnce(new Error("provider unavailable"));

    await expect(removeSandboxEnvironmentVariable._handler(ctx, {
      projectId: "project-1", envName: "TOKEN",
    })).rejects.toThrow("provider unavailable");

    const mutationNames = ctx.runMutation.mock.calls.map(([reference]) => getFunctionName(reference));
    expect(mutationNames).toContain("projects:removeSandboxEnvironmentVariableInternal");
    expect(mutationNames).toContain("projects:upsertSandboxSecretsInternal");
    expect(uploadFile.mock.calls.map(([bytes]) => new TextDecoder().decode(bytes))).toEqual([
      "{}", JSON.stringify({ TOKEN: "old-token" }),
    ]);
  });
});
