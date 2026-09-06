import { afterEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { Sandbox, SandboxNotFoundError } from "e2b";
import { syncOneSandboxCost } from "@autopr/backend/convex/sandboxCostActions";

vi.mock("e2b", () => ({
  Sandbox: { getInfo: vi.fn() },
  SandboxNotFoundError: class extends Error {},
}));

const sync = syncOneSandboxCost as unknown as {
  _handler: (ctx: unknown, args: { sandboxId: string; finalize: boolean }) => Promise<boolean>;
};

describe("E2B cost sync provider failures", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

  it.each([true, false])("treats only a confirmed sandbox 404 as deletion: %s", async (notFound) => {
    vi.stubEnv("E2B_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json([])));
    vi.mocked(Sandbox.getInfo).mockRejectedValue(notFound
      ? new SandboxNotFoundError("gone") : new Error("E2B request failed (500)"));
    const ctx = {
      runQuery: vi.fn().mockResolvedValue({ sandboxId: "sandbox-1", sandboxProvider: "e2b", status: "active" }),
      runMutation: vi.fn().mockResolvedValue(true),
    };
    expect(await sync._handler(ctx, { sandboxId: "sandbox-1", finalize: false })).toBe(notFound);
    const [reference, args] = ctx.runMutation.mock.calls[0]!;
    expect(getFunctionName(reference)).toBe(notFound
      ? "sandboxCosts:recordE2BUsageInternal" : "sandboxCosts:recordSyncFailureInternal");
    if (notFound) expect(args.snapshot).toBeNull();
    else expect(args.error).toContain("500");
  });
});
